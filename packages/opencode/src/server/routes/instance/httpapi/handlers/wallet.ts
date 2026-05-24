import { ensureEvmKeypair } from "@/wallet/keypair"
import { ensureAutoBridge } from "@/wallet/auto-bridge"
import { getSmartAccountAddress, signNonceForSmartAccount } from "@/wallet/smart-account"
import { runOnrampCheckout } from "@opencode-ai/core/util/wallet-checkout"
import { setIntentToken } from "@opencode-ai/core/util/intent-token"
import { ONRAMP_BASE_URL, PAYMENT_GATEWAY_URL } from "@/config/endpoints"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { WalletCheckoutInput } from "../groups/wallet"

export const walletHandlers = HttpApiBuilder.group(RootHttpApi, "wallet", (handlers) =>
  Effect.gen(function* () {
    const checkout = Effect.fn("WalletHttpApi.checkout")(function* (ctx: { payload: typeof WalletCheckoutInput.Type }) {
      return yield* Effect.promise(async () => {
        try {
          const keypair = await ensureEvmKeypair()
          const smartAccountAddress = await getSmartAccountAddress(keypair.privateKey)
          void ensureAutoBridge()
          const result = await runOnrampCheckout({
            publicKey: keypair.publicKey,
            address: smartAccountAddress,
            baseUrl: ctx.payload.baseUrl ?? ONRAMP_BASE_URL,
            gatewayUrl: ctx.payload.gatewayUrl ?? PAYMENT_GATEWAY_URL,
            sign: (nonce) => signNonceForSmartAccount(keypair.privateKey, nonce),
          })
          if (!result.ok) return result
          // Cache the JWT in-process for future protected onramp calls.
          // Never include it in the HTTP response.
          setIntentToken(result.walletAddress, result.intentToken)
          return {
            ok: true as const,
            redirectUrl: result.redirectUrl,
            walletAddress: result.walletAddress,
            publicKey: result.publicKey,
            oneTimeCode: result.oneTimeCode,
            intentId: result.intentId,
          }
        } catch (err) {
          return {
            ok: false as const,
            reason: "unavailable" as const,
            message: err instanceof Error ? err.message : String(err),
          }
        }
      })
    })

    return handlers.handle("checkout", checkout)
  }),
)
