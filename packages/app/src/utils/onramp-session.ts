import {
  createOnrampSession as coreCreateOnrampSession,
  subscribeToOnrampEvents as coreSubscribeToOnrampEvents,
  DEFAULT_ONRAMP_BASE_URL,
  type CreateSessionResult,
  type SubscribeOptions,
  type OnrampSubscription,
} from "@opencode-ai/core/util/onramp-session"

export {
  DEFAULT_ONRAMP_BASE_URL,
  isTerminalStatus,
  type CreateSessionFailureReason,
  type CreateSessionResult,
  type OnrampEvent,
  type OnrampSession,
  type OnrampStatus,
  type OnrampSubscription,
  type OnrampTransactionDetails,
  type SubscribeOptions,
} from "@opencode-ai/core/util/onramp-session"

export function readOnrampBaseUrl(): string {
  return ((import.meta.env.VITE_ONRAMP_BASE_URL ?? "").trim() || DEFAULT_ONRAMP_BASE_URL).replace(/\/+$/, "")
}

export function createOnrampSession(options: {
  walletAddress: string
  baseUrl?: string
  fetch?: typeof fetch
}): Promise<CreateSessionResult> {
  return coreCreateOnrampSession({
    ...options,
    baseUrl: options.baseUrl ?? readOnrampBaseUrl(),
  })
}

export function subscribeToOnrampEvents(options: SubscribeOptions): OnrampSubscription {
  return coreSubscribeToOnrampEvents({
    ...options,
    baseUrl: options.baseUrl ?? readOnrampBaseUrl(),
  })
}
