export const DEFAULT_ONRAMP_BASE_URL = "http://192.168.5.130:3000"

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

export type CreateSessionFailureReason =
  | "missing_base_url"
  | "missing_wallet_address"
  | "http_error"
  | "invalid_response"
  | "network_error"

export type CreateSessionResult =
  | {
      ok: true
      sessionId: string
      redirectUrl: string
      clientSecret?: string
    }
  | { ok: false; reason: CreateSessionFailureReason }

export function readOnrampBaseUrl(): string {
  return ((import.meta.env.VITE_ONRAMP_BASE_URL ?? "").trim() || DEFAULT_ONRAMP_BASE_URL).replace(/\/+$/, "")
}

export function isTerminalStatus(status: OnrampStatus): boolean {
  return status === "fulfillment_complete" || status === "rejected"
}

export async function createOnrampSession(options: {
  walletAddress: string
  baseUrl?: string
  fetch?: typeof fetch
}): Promise<CreateSessionResult> {
  const walletAddress = options.walletAddress.trim()
  if (!walletAddress) return { ok: false, reason: "missing_wallet_address" }

  const baseUrl = (options.baseUrl ?? readOnrampBaseUrl()).replace(/\/+$/, "")
  if (!baseUrl) return { ok: false, reason: "missing_base_url" }

  const f = options.fetch ?? fetch

  try {
    const res = await f(`${baseUrl}/api/create-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ wallet_address: walletAddress }),
    })

    if (!res?.ok) return { ok: false, reason: "http_error" }

    const data: unknown = await res.json().catch(() => undefined)
    if (typeof data !== "object" || data === null) return { ok: false, reason: "invalid_response" }

    const record = data as Record<string, unknown>
    const sessionId = typeof record.session_id === "string" ? record.session_id.trim() : ""
    const redirectUrl = typeof record.redirect_url === "string" ? record.redirect_url.trim() : ""
    const clientSecret = typeof record.client_secret === "string" ? record.client_secret : undefined

    if (!sessionId || !redirectUrl) return { ok: false, reason: "invalid_response" }

    return { ok: true, sessionId, redirectUrl, clientSecret }
  } catch {
    return { ok: false, reason: "network_error" }
  }
}

export type SubscribeOptions = {
  sessionId: string
  baseUrl?: string
  onEvent: (event: OnrampEvent) => void
  /** Called only when the EventSource is permanently closed (readyState === CLOSED). Transient retries are swallowed. */
  onError?: (event: Event) => void
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

export function subscribeToOnrampEvents(options: SubscribeOptions): OnrampSubscription {
  const baseUrl = (options.baseUrl ?? readOnrampBaseUrl()).replace(/\/+$/, "")
  const url = `${baseUrl}/api/events/${encodeURIComponent(options.sessionId)}`

  let source: EventSource | null = null
  let closed = false

  try {
    source = new EventSource(url)
  } catch (err) {
    options.onError?.(new Event("error"))
    return { close() {} }
  }

  const handle = (e: MessageEvent) => {
    if (closed) return
    const data = typeof e.data === "string" ? parseEventData(e.data) : null
    if (data) options.onEvent(data)
  }

  source.addEventListener("status", handle)
  source.addEventListener("message", handle)
  source.onopen = () => options.onOpen?.()
  source.onerror = (e) => {
    if (closed) return
    if (source && source.readyState !== EventSource.CLOSED) return
    options.onError?.(e)
  }

  return {
    close() {
      if (closed) return
      closed = true
      source?.removeEventListener("status", handle)
      source?.removeEventListener("message", handle)
      source?.close()
    },
  }
}
