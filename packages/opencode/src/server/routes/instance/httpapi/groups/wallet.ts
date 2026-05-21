import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

export const WalletCheckoutInput = Schema.Struct({
  baseUrl: Schema.optional(Schema.String),
  gatewayUrl: Schema.optional(Schema.String),
})

export const WalletCheckoutFailureReason = Schema.Union([
  Schema.Literal("unavailable"),
  Schema.Literal("nonce_failed"),
  Schema.Literal("register_failed"),
  Schema.Literal("missing_gateway_url"),
  Schema.Literal("missing_wallet_address"),
  Schema.Literal("missing_intent_id"),
])

export const WalletCheckoutSuccess = Schema.Struct({
  ok: Schema.Literal(true),
  redirectUrl: Schema.String,
  walletAddress: Schema.String,
  publicKey: Schema.String,
  oneTimeCode: Schema.String,
  intentId: Schema.String,
})

export const WalletCheckoutFailure = Schema.Struct({
  ok: Schema.Literal(false),
  reason: WalletCheckoutFailureReason,
  message: Schema.optional(Schema.String),
})

export const WalletCheckoutResult = Schema.Union([WalletCheckoutSuccess, WalletCheckoutFailure])

export const WalletPaths = {
  checkout: "/global/wallet/checkout",
} as const

export const WalletApi = HttpApi.make("wallet").add(
  HttpApiGroup.make("wallet")
    .add(
      HttpApiEndpoint.post("checkout", WalletPaths.checkout, {
        payload: WalletCheckoutInput,
        success: described(WalletCheckoutResult, "Onramp checkout intent created"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "wallet.checkout",
          summary: "Start an onramp checkout",
          description:
            "Sign in to the somacode onramp backend with the local ~/.soma/evm_keypair.json wallet, register a new payment intent, and return the payment gateway redirect URL plus a one-time code the user types into the gateway page.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "wallet", description: "Onramp wallet routes." })),
)
