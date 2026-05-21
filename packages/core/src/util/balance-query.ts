export const DEFAULT_BALANCE_GRAPHQL_URL = "https://graphql.testnet.soma.org/graphql"

const USDC_DECIMALS = 6n
const USDC_DENOMINATOR = 10n ** USDC_DECIMALS

export type BalanceResult =
  | { ok: true; usdcBalance: number; pointsBalance: number }
  | { ok: false; reason: "http_error" | "invalid_response" | "network_error" }

const QUERY = `query UsdcView($addr: String!) {
  bridgeDeposits(recipient: $addr, afterNonce: -1, limit: 50) {
    amount
  }
  channels(payer: $addr, first: 50) {
    edges {
      node {
        token
        deposit
        settledAmount
      }
    }
  }
}`

function toBigInt(value: unknown): bigint {
  if (typeof value !== "string" && typeof value !== "number") return 0n
  try {
    return BigInt(value)
  } catch {
    return 0n
  }
}

function microsToUsdc(micros: bigint): number {
  if (micros <= 0n) return 0
  const whole = micros / USDC_DENOMINATOR
  const fraction = micros % USDC_DENOMINATOR
  return Number(whole) + Number(fraction) / Number(USDC_DENOMINATOR)
}

const ZERO: BalanceResult = { ok: true, usdcBalance: 0, pointsBalance: 0 }

export async function fetchBalance(
  options: { url?: string; fetch?: typeof fetch; address?: string } = {},
): Promise<BalanceResult> {
  const address = options.address?.trim()
  if (!address) return ZERO

  const url = options.url ?? DEFAULT_BALANCE_GRAPHQL_URL
  const f = options.fetch ?? fetch

  try {
    const res = await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { addr: address } }),
    })
    if (!res.ok) return ZERO

    const json = (await res.json().catch(() => undefined)) as
      | {
          data?: {
            bridgeDeposits?: Array<{ amount?: unknown }>
            channels?: { edges?: Array<{ node?: { token?: unknown; deposit?: unknown; settledAmount?: unknown } }> }
          }
        }
      | undefined
    if (!json?.data) return ZERO

    let inbound = 0n
    for (const d of json.data.bridgeDeposits ?? []) {
      inbound += toBigInt(d?.amount)
    }

    let locked = 0n
    for (const edge of json.data.channels?.edges ?? []) {
      const node = edge?.node
      if (!node || node.token !== "USDC") continue
      locked += toBigInt(node.deposit)
      locked += toBigInt(node.settledAmount)
    }

    const net = inbound > locked ? inbound - locked : 0n
    return { ok: true, usdcBalance: microsToUsdc(net), pointsBalance: 0 }
  } catch {
    return ZERO
  }
}
