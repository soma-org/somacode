import {
  DEFAULT_ONRAMP_BASE_URL as ONRAMP_BASE_URL_FALLBACK,
  DEFAULT_PAYMENT_GATEWAY_URL as PAYMENT_GATEWAY_URL_FALLBACK,
} from "../config/endpoints.ts"

export const DEFAULT_ONRAMP_BASE_URL = ONRAMP_BASE_URL_FALLBACK
export const DEFAULT_PAYMENT_GATEWAY_URL = PAYMENT_GATEWAY_URL_FALLBACK

export type OnrampStatus =
  | "initialized"
  | "requires_payment"
  | "fulfillment_processing"
  | "fulfillment_complete"
  | "rejected"

export type OnrampTransactionDetails = {
  source_currency?: string
  source_amount?: string
  destination_currency?: string
  destination_network?: string
  destination_amount?: string
  wallet_address?: string
}

export type OnrampSession = {
  id: string
  status: OnrampStatus
  transaction_details?: OnrampTransactionDetails
}

export type OnrampEvent = {
  status: OnrampStatus
  session: OnrampSession
}

export type BuildGatewayUrlFailureReason = "missing_gateway_url" | "missing_wallet_address" | "missing_intent_id"

export type BuildGatewayUrlResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; reason: BuildGatewayUrlFailureReason }

export function isTerminalStatus(status: OnrampStatus): boolean {
  return status === "fulfillment_complete" || status === "rejected"
}

function normalizeBaseUrl(input?: string): string {
  return (input ?? DEFAULT_ONRAMP_BASE_URL).trim().replace(/\/+$/, "")
}

function normalizeGatewayUrl(input?: string): string {
  return (input ?? DEFAULT_PAYMENT_GATEWAY_URL).trim().replace(/\/+$/, "")
}

export type BuildGatewayUrlOptions =
  | { intentId: string; gatewayUrl?: string }
  | { walletAddress: string; gatewayUrl?: string }

export function buildPaymentGatewayUrl(options: BuildGatewayUrlOptions): BuildGatewayUrlResult {
  const base = normalizeGatewayUrl(options.gatewayUrl)
  if (!base) return { ok: false, reason: "missing_gateway_url" }

  if ("intentId" in options) {
    const intentId = options.intentId.trim()
    if (!intentId) return { ok: false, reason: "missing_intent_id" }
    return { ok: true, redirectUrl: `${base}?intent_id=${encodeURIComponent(intentId)}` }
  }

  const walletAddress = options.walletAddress.trim()
  if (!walletAddress) return { ok: false, reason: "missing_wallet_address" }
  return { ok: true, redirectUrl: `${base}?wallet=${encodeURIComponent(walletAddress)}` }
}

export type AuthFailureReason = "nonce_failed" | "register_failed"

export type AuthResult =
  | { ok: true; intent_id: string; intent_token: string }
  | { ok: false; reason: AuthFailureReason; message?: string }

export type AuthOptions = {
  baseUrl?: string
  publicKey: string
  address: string
  /** Client-generated one-time code (XXXX-XXXX) the user will type into the payment gateway. Backend stores a hash and checks it on /api/intent/redeem. */
  oneTimeCode: string
  sign: (nonce: string) => Promise<string> | string
  fetch?: typeof fetch
}

/** Generate a XXXX-XXXX one-time code (8 digits with dash). 10^8 = 100M space; combined with ≤5-min TTL and rate-limited redeem, that's enough for a user-typed handshake. */
export function generateOneTimeCode(): string {
  const buf = new Uint8Array(4)
  // Prefer Web Crypto if available (browser, modern Node, Bun), fall back to Math.random.
  const g = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => void } }).crypto
  if (g?.getRandomValues) {
    g.getRandomValues(buf)
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  const a = (((buf[0]! << 8) | buf[1]!) % 10000).toString().padStart(4, "0")
  const b = (((buf[2]! << 8) | buf[3]!) % 10000).toString().padStart(4, "0")
  return `${a}-${b}`
}

async function fetchNonce(baseUrl: string, f: typeof fetch): Promise<string | null> {
  try {
    const res = await f(`${baseUrl}/api/nonce`, {
      method: "GET",
      headers: { Accept: "application/json" },
    })
    if (!res.ok) return null
    const body = (await res.json()) as unknown
    if (typeof body !== "object" || body === null) return null
    const nonce = (body as Record<string, unknown>).nonce
    return typeof nonce === "string" && nonce.length > 0 ? nonce : null
  } catch {
    return null
  }
}

type RegisterResult =
  | { ok: true; intent_id: string; intent_token: string }
  | { ok: false; status: number; code?: string; message?: string }

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined
}

function asNonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined
}

async function postRegister(
  baseUrl: string,
  payload: { publicKey: string; address: string; signature: string; nonce: string; otp: string },
  f: typeof fetch,
): Promise<RegisterResult> {
  let res: Response
  try {
    res = await f(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[wallet-auth] /api/auth/register fetch failed:", message)
    return { ok: false, status: 0, message: `network error: ${message}` }
  }

  const raw = await res.text().catch(() => "")
  let parsed: unknown
  try {
    parsed = raw ? JSON.parse(raw) : undefined
  } catch {
    parsed = undefined
  }
  const record = asRecord(parsed)

  if (!res.ok) {
    const code = record ? asNonEmptyString(record.code) : undefined
    const message = record ? asNonEmptyString(record.message) : undefined
    console.error("[wallet-auth] /api/auth/register rejected:", {
      status: res.status,
      code,
      message,
      raw: raw.slice(0, 500),
    })
    return { ok: false, status: res.status, code, message }
  }

  if (!record) {
    console.error("[wallet-auth] /api/auth/register: non-JSON success body:", {
      status: res.status,
      raw: raw.slice(0, 500),
    })
    return { ok: false, status: res.status, message: "non-JSON response body" }
  }

  const intent_id = asNonEmptyString(record.intent_id)
  if (!intent_id) {
    const keys = Object.keys(record)
    console.error("[wallet-auth] /api/auth/register: success body missing intent_id:", {
      status: res.status,
      keys,
      body: record,
    })
    return {
      ok: false,
      status: res.status,
      message: `success body missing intent_id; got keys: [${keys.join(", ")}]`,
    }
  }

  const intent_token = asNonEmptyString(record.intent_token)
  if (!intent_token) {
    const keys = Object.keys(record)
    console.error("[wallet-auth] /api/auth/register: success body missing intent_token:", {
      status: res.status,
      keys,
    })
    return {
      ok: false,
      status: res.status,
      message: `success body missing intent_token; got keys: [${keys.join(", ")}]`,
    }
  }

  return { ok: true, intent_id, intent_token }
}

export async function authenticateWallet(options: AuthOptions): Promise<AuthResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const f = options.fetch ?? fetch

  const nonce = await fetchNonce(baseUrl, f)
  if (!nonce) return { ok: false, reason: "nonce_failed" }

  let signature: string
  try {
    signature = await options.sign(nonce)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[wallet-auth] sign(nonce) threw:", message)
    return { ok: false, reason: "register_failed", message: `sign failed: ${message}` }
  }

  const registered = await postRegister(
    baseUrl,
    {
      publicKey: options.publicKey,
      address: options.address,
      signature,
      nonce,
      otp: options.oneTimeCode,
    },
    f,
  )
  if (!registered.ok) {
    const detail = registered.code
      ? `${registered.code}: ${registered.message ?? "(no message)"}`
      : registered.message
    return { ok: false, reason: "register_failed", message: detail }
  }

  return { ok: true, intent_id: registered.intent_id, intent_token: registered.intent_token }
}

export function walletAddressesMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export type SubscribeOptions = {
  /** Optional session id. When omitted, subscribes to the global `/api/events` stream and the caller is responsible for filtering events (typically by `transaction_details.wallet_address`). */
  sessionId?: string
  baseUrl?: string
  fetch?: typeof fetch
  onEvent: (event: OnrampEvent) => void
  onError?: () => void
  onOpen?: () => void
}

export type OnrampSubscription = {
  close(): void
}

function parseEventData(raw: string): OnrampEvent | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== "object" || parsed === null) return null
    const obj = parsed as Record<string, unknown>
    const status = typeof obj.status === "string" ? (obj.status as OnrampStatus) : undefined
    const session = (obj.session as OnrampSession | undefined) ?? undefined
    if (!status || !session) return null
    return { status, session }
  } catch {
    return null
  }
}

type EventSourceCtor = new (url: string) => EventSource

function getEventSourceCtor(): EventSourceCtor | undefined {
  return (globalThis as { EventSource?: EventSourceCtor }).EventSource
}

function subscribeViaEventSource(url: string, options: SubscribeOptions, Ctor: EventSourceCtor): OnrampSubscription {
  let source: EventSource | null = null
  let closed = false

  try {
    source = new Ctor(url)
  } catch {
    options.onError?.()
    return { close() {} }
  }

  const handle = (e: MessageEvent) => {
    if (closed) return
    const data = typeof e.data === "string" ? parseEventData(e.data) : null
    if (data) options.onEvent(data)
  }

  source.addEventListener("status", handle as EventListener)
  source.addEventListener("message", handle as EventListener)
  source.onopen = () => options.onOpen?.()
  source.onerror = () => {
    if (closed) return
    if (source && source.readyState !== 2 /* CLOSED */) return
    options.onError?.()
  }

  return {
    close() {
      if (closed) return
      closed = true
      source?.removeEventListener("status", handle as EventListener)
      source?.removeEventListener("message", handle as EventListener)
      source?.close()
    },
  }
}

function subscribeViaFetch(url: string, options: SubscribeOptions): OnrampSubscription {
  const controller = new AbortController()
  let closed = false
  const f = options.fetch ?? fetch

  const run = async () => {
    try {
      const res = await f(url, {
        method: "GET",
        headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        if (!closed) options.onError?.()
        return
      }
      options.onOpen?.()

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (!closed) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let idx: number
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          let dataLines: string[] = []
          for (const line of chunk.split(/\r?\n/)) {
            if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""))
          }
          if (dataLines.length === 0) continue
          const data = parseEventData(dataLines.join("\n"))
          if (data && !closed) options.onEvent(data)
        }
      }
    } catch {
      if (!closed) options.onError?.()
    }
  }

  void run()

  return {
    close() {
      if (closed) return
      closed = true
      controller.abort()
    },
  }
}

export function subscribeToOnrampEvents(options: SubscribeOptions): OnrampSubscription {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const url = options.sessionId
    ? `${baseUrl}/api/events/${encodeURIComponent(options.sessionId)}`
    : `${baseUrl}/api/events`

  const Ctor = getEventSourceCtor()
  if (Ctor) return subscribeViaEventSource(url, options, Ctor)
  return subscribeViaFetch(url, options)
}
