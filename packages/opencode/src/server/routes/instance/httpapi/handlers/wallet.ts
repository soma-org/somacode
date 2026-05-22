import { ensureEvmKeypair } from "@/wallet/keypair"
import { ensureAutoBridge } from "@/wallet/auto-bridge"
import { getSmartAccountAddress, signNonceForSmartAccount } from "@/wallet/smart-account"
import { runOnrampCheckout } from "@opencode-ai/core/util/wallet-checkout"
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
          return await runOnrampCheckout({
            publicKey: keypair.publicKey,
            address: smartAccountAddress,
            baseUrl: ctx.payload.baseUrl ?? ONRAMP_BASE_URL,
            gatewayUrl: ctx.payload.gatewayUrl ?? PAYMENT_GATEWAY_URL,
            sign: (nonce) => signNonceForSmartAccount(keypair.privateKey, nonce),
          })
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
