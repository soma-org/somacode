export type UsdcCheckoutFailureReason =
  | "missing_checkout_url"
  | "missing_stripe_key"
  | "http_error"
  | "invalid_response"
  | "network_error"

export type UsdcCheckoutResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; reason: UsdcCheckoutFailureReason }

export function readUsdcCheckoutUrl() {
  return (import.meta.env.VITE_USDC_CHECKOUT_URL ?? "").trim()
}

export function readStripeBearerAuthorization() {
  const key = (import.meta.env.VITE_STRIPE_TEST_KEY ?? "").trim()
  if (!key) return ""
  return `Bearer ${key}`
}

export function readRedirectUrlFromCheckoutResponse(data: unknown) {
  if (typeof data !== "object" || data === null) return ""
  const url = (data as Record<string, unknown>).redirect_url
  if (typeof url !== "string" || url.length === 0) return ""
  return url.trim()
}

export async function postUsdcCheckoutSession(fetchFn: typeof fetch): Promise<UsdcCheckoutResult> {
  const apiUrl = readUsdcCheckoutUrl()
  if (!apiUrl) return { ok: false, reason: "missing_checkout_url" }

  const authorization = readStripeBearerAuthorization()
  if (!authorization) return { ok: false, reason: "missing_stripe_key" }

  try {
    const res = await fetchFn(apiUrl, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        Authorization: authorization,
      },
    })

    if (!res?.ok) return { ok: false, reason: "http_error" }

    const data: unknown = await res.json().catch(() => undefined)
    const redirectUrl = readRedirectUrlFromCheckoutResponse(data)
    if (!redirectUrl) return { ok: false, reason: "invalid_response" }

    return { ok: true, redirectUrl }
  } catch {
    return { ok: false, reason: "network_error" }
  }
}
