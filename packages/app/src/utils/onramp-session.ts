import {
  buildPaymentGatewayUrl as coreBuildPaymentGatewayUrl,
  subscribeToOnrampEvents as coreSubscribeToOnrampEvents,
  DEFAULT_ONRAMP_BASE_URL,
  DEFAULT_PAYMENT_GATEWAY_URL,
  type BuildGatewayUrlResult,
  type SubscribeOptions,
  type OnrampSubscription,
} from "@opencode-ai/core/util/onramp-session"

export {
  DEFAULT_ONRAMP_BASE_URL,
  DEFAULT_PAYMENT_GATEWAY_URL,
  isTerminalStatus,
  walletAddressesMatch,
  type BuildGatewayUrlFailureReason,
  type BuildGatewayUrlResult,
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

export function readPaymentGatewayUrl(): string {
  return ((import.meta.env.VITE_PAYMENT_GATEWAY_URL ?? "").trim() || DEFAULT_PAYMENT_GATEWAY_URL).replace(/\/+$/, "")
}

export function buildPaymentGatewayUrl(options: {
  walletAddress: string
  gatewayUrl?: string
}): BuildGatewayUrlResult {
  return coreBuildPaymentGatewayUrl({
    ...options,
    gatewayUrl: options.gatewayUrl ?? readPaymentGatewayUrl(),
  })
}

export function subscribeToOnrampEvents(options: SubscribeOptions): OnrampSubscription {
  return coreSubscribeToOnrampEvents({
    ...options,
    baseUrl: options.baseUrl ?? readOnrampBaseUrl(),
  })
}
