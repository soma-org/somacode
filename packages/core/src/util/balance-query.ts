export const DEFAULT_INDEXER_URL = "https://graphql.testnet.soma.org/graphql"

const USDC_DECIMALS = 6n
const USDC_DENOMINATOR = 10n ** USDC_DECIMALS

export type BalanceResult =
  | { ok: true; walletUsdcMicros: bigint; usdcSpentMicros: bigint; address: string }
  | { ok: false; reason: "http_error" | "invalid_response" | "network_error" | "no_address" }

const BALANCE_QUERY = `query Bal($a: String!) { balance(address: $a) }`
const CHANNELS_QUERY = `query Ch($a: String!) { channels(payer: $a, first: 200) { edges { node { settledAmount } } } }`

const post = async (url: string, query: string, variables: Record<string, unknown>, f: typeof fetch) => {
  const res = await f(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`http ${res.status}`)
  const json = (await res.json()) as { data?: unknown; errors?: { message: string }[] }
  if (!json.data) throw new Error(json.errors?.[0]?.message ?? "no data")
  return json.data
}

export async function fetchBalance(options: { url?: string; address?: string; fetch?: typeof fetch } = {}): Promise<BalanceResult> {
  const url = options.url ?? DEFAULT_INDEXER_URL
  const address = options.address?.trim()
  if (!address) return { ok: false, reason: "no_address" }
  const f = options.fetch ?? fetch
  const result = await Promise.all([
    post(url, BALANCE_QUERY, { a: address }, f),
    post(url, CHANNELS_QUERY, { a: address }, f),
  ]).catch(() => undefined)
  if (!result) return { ok: false, reason: "network_error" }
  const balanceData = result[0] as { balance?: string | number | null }
  const channelsData = result[1] as { channels?: { edges?: { node?: { settledAmount?: string | number } }[] } }
  if (balanceData.balance === undefined || balanceData.balance === null) return { ok: false, reason: "invalid_response" }
  const walletUsdcMicros = BigInt(balanceData.balance)
  const edges = channelsData.channels?.edges ?? []
  const usdcSpentMicros = edges.reduce<bigint>(
    (sum, edge) => sum + (edge.node?.settledAmount !== undefined ? BigInt(edge.node.settledAmount) : 0n),
    0n,
  )
  return { ok: true, walletUsdcMicros, usdcSpentMicros, address }
}
