/**
 * In-memory store for `intent_token` JWTs returned by `/api/auth/register`.
 *
 * Storage policy:
 * - Memory only (no disk, no logs, no IPC to other hosts).
 * - Keyed by lowercased EVM wallet address (`sub` claim of the JWT).
 * - Auto-purges entries past their `exp`.
 *
 * Refresh policy:
 * - JWTs are valid for 1h from register.
 * - `getIntentToken` returns `undefined` once expired; callers should re-run the register flow.
 * - There is no server-side revocation; on logout, call `clearIntentToken(address)` to drop the cached copy.
 *
 * Never:
 * - Send the JWT to any host other than the somacode onramp backend.
 * - Log the JWT or the full Authorization header.
 * - Reuse a single JWT across multiple wallets.
 */

export type IntentToken = {
  /** Raw JWT string. */
  token: string
  /** Unix seconds (`exp` claim). */
  exp: number
  /** Lowercased wallet address (`sub` claim). */
  address: string
}

const store = new Map<string, IntentToken>()

function base64UrlDecode(input: string): string | null {
  try {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/")
    const padLen = (4 - (padded.length % 4)) % 4
    const full = padded + "=".repeat(padLen)
    // atob is available in browsers, Node 16+, Bun, Deno — every runtime soma targets.
    if (typeof atob === "function") return atob(full)
    return null
  } catch {
    return null
  }
}

/** Returns the `exp` claim (Unix seconds) of a JWT, or null if it can't be decoded. */
export function decodeJwtExp(token: string): number | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const payloadRaw = base64UrlDecode(parts[1]!)
  if (!payloadRaw) return null
  try {
    const payload = JSON.parse(payloadRaw) as { exp?: unknown }
    return typeof payload.exp === "number" ? payload.exp : null
  } catch {
    return null
  }
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase()
}

/**
 * Cache a freshly-minted JWT for the given wallet. Decodes `exp` from the token
 * itself; if `exp` is missing or unparseable, the token is dropped silently
 * (callers should treat that as a backend / token-format bug).
 */
export function setIntentToken(address: string, token: string): IntentToken | undefined {
  const exp = decodeJwtExp(token)
  if (exp === null) return undefined
  const entry: IntentToken = { token, exp, address: normalizeAddress(address) }
  store.set(entry.address, entry)
  return entry
}

/** Returns the cached JWT for `address`, or undefined if missing or expired. */
export function getIntentToken(address: string): IntentToken | undefined {
  const key = normalizeAddress(address)
  const entry = store.get(key)
  if (!entry) return undefined
  if (entry.exp * 1000 <= Date.now()) {
    store.delete(key)
    return undefined
  }
  return entry
}

export function clearIntentToken(address: string): void {
  store.delete(normalizeAddress(address))
}

/** `{ Authorization: "Bearer ..." }` headers for protected backend calls, or undefined if no live token. */
export function authorizationHeader(address: string): { Authorization: string } | undefined {
  const entry = getIntentToken(address)
  if (!entry) return undefined
  return { Authorization: `Bearer ${entry.token}` }
}
