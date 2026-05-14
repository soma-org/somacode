export const DEFAULT_BALANCE_GRAPHQL_URL = "https://graphqlzero.almansi.me/api"

export type BalanceResult =
  | { ok: true; usdcBalance: number; pointsBalance: number }
  | { ok: false; reason: "http_error" | "invalid_response" | "network_error" }

const QUERY = `query Balance {
  usdc: post(id: "42") { id }
  points: post(id: "100") { id }
}`

function parseId(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export async function fetchBalance(options: { url?: string; fetch?: typeof fetch } = {}): Promise<BalanceResult> {
  const url = options.url ?? DEFAULT_BALANCE_GRAPHQL_URL
  const f = options.fetch ?? fetch

  try {
    const res = await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: QUERY }),
    })
    if (!res.ok) return { ok: false, reason: "http_error" }

    const json = (await res.json().catch(() => undefined)) as
      | { data?: { usdc?: { id?: unknown }; points?: { id?: unknown } } }
      | undefined

    const usdc = parseId(json?.data?.usdc?.id)
    const points = parseId(json?.data?.points?.id)
    if (usdc === null || points === null) return { ok: false, reason: "invalid_response" }

    return { ok: true, usdcBalance: usdc, pointsBalance: points }
  } catch {
    return { ok: false, reason: "network_error" }
  }
}
