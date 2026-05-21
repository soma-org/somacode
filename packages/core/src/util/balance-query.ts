export const DEFAULT_BALANCE_GRAPHQL_URL = "https://graphqlzero.almansi.me/api"

export type BalanceResult =
  | { ok: true; usdcBalance: number; pointsBalance: number }
  | { ok: false; reason: "http_error" | "invalid_response" | "network_error" }

export async function fetchBalance(_options: { url?: string; fetch?: typeof fetch } = {}): Promise<BalanceResult> {
  return { ok: true, usdcBalance: 0, pointsBalance: 0 }
}
