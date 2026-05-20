export const DEFAULT_ONRAMP_BASE_URL = "http://95.217.102.55:3010"
export const DEFAULT_PAYMENT_GATEWAY_URL = "http://localhost:8000"

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

export type AuthFailureReason = "nonce_failed" | "verify_failed"

export type AuthResult =
  | { ok: true; intent_id: string; intent_token: string }
  | { ok: false; reason: AuthFailureReason }

export type AuthOptions = {
  baseUrl?: string
  publicKey: string
  address: string
  sign: (nonce: string) => Promise<string> | string
  fetch?: typeof fetch
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

async function postVerify(
  baseUrl: string,
  payload: { publicKey: string; address: string; signature: string; nonce: string },
  f: typeof fetch,
): Promise<{ intent_id: string; intent_token: string } | null> {
  try {
    const res = await f(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    const body = (await res.json()) as unknown
    if (typeof body !== "object" || body === null) return null
    const { intent_id, intent_token } = body as Record<string, unknown>
    if (typeof intent_id !== "string" || typeof intent_token !== "string") return null
    if (!intent_id || !intent_token) return null
    return { intent_id, intent_token }
  } catch {
    return null
  }
}

export async function authenticateWallet(options: AuthOptions): Promise<AuthResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const f = options.fetch ?? fetch

  const nonce = await fetchNonce(baseUrl, f)
  if (!nonce) return { ok: false, reason: "nonce_failed" }

  let signature: string
  try {
    signature = await options.sign(nonce)
  } catch {
    return { ok: false, reason: "verify_failed" }
  }

  const verified = await postVerify(
    baseUrl,
    { publicKey: options.publicKey, address: options.address, signature, nonce },
    f,
  )
  if (!verified) return { ok: false, reason: "verify_failed" }

  return { ok: true, ...verified }
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
