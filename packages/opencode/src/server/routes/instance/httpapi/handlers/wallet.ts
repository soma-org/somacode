import { ensureEvmKeypair, signMessage } from "@/wallet/keypair"
import { runOnrampCheckout } from "@opencode-ai/core/util/wallet-checkout"
import { DEFAULT_PAYMENT_GATEWAY_URL } from "@opencode-ai/core/util/onramp-session"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { WalletCheckoutInput } from "../groups/wallet"

function readEnvBaseUrl(): string | undefined {
  return process.env.SOMACODE_ONRAMP_BASE_URL?.trim() || undefined
}

function readEnvGatewayUrl(): string {
  return (
    process.env.VITE_SOMACODE_PAYMENT_GATEWAY_URL?.trim() ||
    process.env.SOMACODE_PAYMENT_GATEWAY_URL?.trim() ||
    DEFAULT_PAYMENT_GATEWAY_URL
  )
}

export const walletHandlers = HttpApiBuilder.group(RootHttpApi, "wallet", (handlers) =>
  Effect.gen(function* () {
    const checkout = Effect.fn("WalletHttpApi.checkout")(function* (ctx: { payload: typeof WalletCheckoutInput.Type }) {
      return yield* Effect.promise(async () => {
        try {
          const keypair = await ensureEvmKeypair()
          return await runOnrampCheckout({
            publicKey: keypair.publicKey,
            address: keypair.address,
            baseUrl: ctx.payload.baseUrl ?? readEnvBaseUrl(),
            gatewayUrl: ctx.payload.gatewayUrl ?? readEnvGatewayUrl(),
            sign: (nonce) => signMessage(keypair.privateKey, nonce),
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
