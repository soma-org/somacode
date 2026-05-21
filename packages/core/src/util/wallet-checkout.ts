import {
  authenticateWallet,
  buildPaymentGatewayUrl,
  generateOneTimeCode,
  type AuthFailureReason,
  type BuildGatewayUrlFailureReason,
} from "./onramp-session"

export type OnrampCheckoutFailureReason = AuthFailureReason | BuildGatewayUrlFailureReason

export type OnrampCheckoutResult =
  | {
      ok: true
      redirectUrl: string
      walletAddress: string
      publicKey: string
      oneTimeCode: string
      intentId: string
    }
  | { ok: false; reason: OnrampCheckoutFailureReason; message?: string }

export type RunOnrampCheckoutOptions = {
  publicKey: string
  address: string
  /** Signs the nonce returned by `/api/nonce` and returns the signature as a hex string. */
  sign: (nonce: string) => Promise<string> | string
  baseUrl?: string
  gatewayUrl?: string
  fetch?: typeof fetch
  /** Client-generated one-time code. Defaults to a fresh `generateOneTimeCode()`. */
  oneTimeCode?: string
}

/**
 * Shared OTP / sign-in handshake used by every soma surface that needs to start a buy-USDC checkout
 * (TUI, Desktop main, opencode server). Callers load their EVM keypair from wherever they keep it
 * (filesystem, IPC, etc.) and hand the signer in.
 */
export async function runOnrampCheckout(options: RunOnrampCheckoutOptions): Promise<OnrampCheckoutResult> {
  const oneTimeCode = options.oneTimeCode ?? generateOneTimeCode()

  const auth = await authenticateWallet({
    baseUrl: options.baseUrl,
    publicKey: options.publicKey,
    address: options.address,
    oneTimeCode,
    sign: options.sign,
    fetch: options.fetch,
  })
  if (!auth.ok) return { ok: false, reason: auth.reason }

  const url = buildPaymentGatewayUrl({ intentId: auth.intent_id, gatewayUrl: options.gatewayUrl })
  if (!url.ok) return { ok: false, reason: url.reason }

  return {
    ok: true,
    redirectUrl: url.redirectUrl,
    walletAddress: options.address,
    publicKey: options.publicKey,
    oneTimeCode,
    intentId: auth.intent_id,
  }
}
