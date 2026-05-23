import { INDEXER_URL } from "./config"

const query = async <T>(q: string, variables: Record<string, unknown> = {}): Promise<T> => {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: q, variables }),
  })
  const body = (await res.json()) as { data: T; errors?: { message: string; path?: string[] }[] }
  if (!body.data && body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join(", "))
  }
  return body.data
}

export interface Offering {
  provider: string
  modelId: string
  promptMicrosPer1K: bigint
  completionMicrosPer1K: bigint
  requestMicros: bigint
  ttftBoundMs: number
  ttotBoundMs: number
}

export interface Reputation {
  channelRenewalRate: number
  negativeRate30D: number | null
  ratingCount30D: bigint
}

export interface ProviderRecord {
  address: string
  endpoint: string
  reputation?: Reputation
}

export interface ScoredOffering extends Offering {
  endpoint: string
  reputation?: Reputation
  score: number
}

const OFFERINGS_QUERY = `
  query Offerings($first: Int) {
    offerings(active: true, first: $first) {
      edges { node {
        provider
        modelId
        promptMicrosPer1K
        completionMicrosPer1K
        requestMicros
        ttftBoundMs
        ttotBoundMs
      } }
    }
  }
`

const PROVIDERS_QUERY = `
  query Providers($first: Int) {
    providers(first: $first) {
      edges { node { address endpoint } }
    }
  }
`

const PROVIDER_REPUTATION_QUERY = `
  query ProviderRep($address: String!) {
    provider(address: $address) {
      reputation {
        channelRenewalRate
        negativeRate30D
        ratingCount30D
      }
    }
  }
`

const CHANNELS_QUERY = `
  query Channels($payer: String!, $first: Int) {
    channels(payer: $payer, first: $first) {
      edges { node {
        id payee modelId status deposit settledAmount closeRequestedAtMs
      } }
    }
  }
`

const ROUTING_WEIGHTS = { price: 1.0, renewal: 1.5, negativeRate: 5.0 } as const

const score = (o: Offering, rep?: Reputation) => {
  const price = Number(o.promptMicrosPer1K + o.completionMicrosPer1K)
  let s = -ROUTING_WEIGHTS.price * price
  if (rep) {
    s += ROUTING_WEIGHTS.renewal * rep.channelRenewalRate
    if (rep.negativeRate30D !== null) s -= ROUTING_WEIGHTS.negativeRate * rep.negativeRate30D
  }
  return s
}

type RawOffering = {
  provider: string
  modelId: string
  promptMicrosPer1K: string
  completionMicrosPer1K: string
  requestMicros: string
  ttftBoundMs: number
  ttotBoundMs: number
}

const offerings = async (): Promise<Offering[]> => {
  const data = await query<{ offerings: { edges: { node: RawOffering }[] } }>(OFFERINGS_QUERY, { first: 200 })
  return data.offerings.edges.map(({ node }) => ({
    provider: node.provider,
    modelId: node.modelId,
    promptMicrosPer1K: BigInt(node.promptMicrosPer1K),
    completionMicrosPer1K: BigInt(node.completionMicrosPer1K),
    requestMicros: BigInt(node.requestMicros),
    ttftBoundMs: node.ttftBoundMs,
    ttotBoundMs: node.ttotBoundMs,
  }))
}

const providersIndex = async (): Promise<Map<string, string>> => {
  const data = await query<{ providers: { edges: { node: { address: string; endpoint: string } }[] } }>(
    PROVIDERS_QUERY,
    { first: 200 },
  )
  return new Map(data.providers.edges.map(({ node }) => [node.address, node.endpoint]))
}

const reputationFor = async (address: string): Promise<Reputation | undefined> => {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: PROVIDER_REPUTATION_QUERY, variables: { address } }),
  })
  const body = (await res.json()) as {
    data: {
      provider: {
        reputation: { channelRenewalRate: number; negativeRate30D: number | null; ratingCount30D: string } | null
      } | null
    }
    errors?: unknown[]
  }
  const rep = body.data?.provider?.reputation
  if (!rep) return undefined
  return {
    channelRenewalRate: rep.channelRenewalRate,
    negativeRate30D: rep.negativeRate30D,
    ratingCount30D: BigInt(rep.ratingCount30D),
  }
}

// 8s is generous enough for trans-pacific VPN paths (the typical pathological
// case: a developer in CN routing through a VPN to a us-central provider). A
// tighter bound made the filter false-positive on a single slow probe and the
// caller would briefly publish an empty trusted-set — locking out all
// routing for ~60s until the next probe recovered. The throughput cost of
// the looser bound is bounded by `PROBE_CONCURRENCY` in `trusted-server.ts`.
const LIVENESS_TIMEOUT_MS = Number(process.env.SOMACODE_LIVENESS_TIMEOUT_MS) || 8_000

export const probeLive = async (endpoint: string): Promise<boolean> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LIVENESS_TIMEOUT_MS)
  const ok = await fetch(`${endpoint.replace(/\/$/, "")}/health`, { signal: controller.signal })
    .then((r) => r.ok)
    .catch(() => false)
  clearTimeout(timer)
  return ok
}

export interface LiveModel {
  modelId: string
  bestOffering: ScoredOffering
  liveProviders: number
}

export const liveModels = async (): Promise<LiveModel[]> => {
  const [allOfferings, endpoints] = await Promise.all([offerings(), providersIndex()])
  const distinctProviders = [...new Set(allOfferings.map((o) => o.provider))]
  const liveness = new Map(
    await Promise.all(
      distinctProviders.map(async (addr) => {
        const ep = endpoints.get(addr)
        return [addr, ep ? await probeLive(ep) : false] as const
      }),
    ),
  )
  const reps = new Map(
    await Promise.all(
      distinctProviders.map(async (addr) => [addr, await reputationFor(addr).catch(() => undefined)] as const),
    ),
  )
  const grouped = new Map<string, ScoredOffering[]>()
  for (const o of allOfferings) {
    if (!liveness.get(o.provider)) continue
    const endpoint = endpoints.get(o.provider)
    if (!endpoint) continue
    const reputation = reps.get(o.provider)
    const scored: ScoredOffering = { ...o, endpoint, reputation, score: score(o, reputation) }
    const list = grouped.get(o.modelId) ?? []
    list.push(scored)
    grouped.set(o.modelId, list)
  }
  return [...grouped.entries()]
    .map(([modelId, list]) => {
      const sorted = list.sort((a, b) => b.score - a.score)
      return { modelId, bestOffering: sorted[0], liveProviders: sorted.length }
    })
    .sort((a, b) => a.modelId.localeCompare(b.modelId))
}

export interface ChannelSummary {
  id: string
  payee: string
  modelId: string
  status: "OPEN" | "CLOSING" | "WITHDRAWN"
  deposit: bigint
  settledAmount: bigint
  closeRequestedAtMs: bigint | null
}

export const channelsForPayer = async (payer: string): Promise<ChannelSummary[]> => {
  const data = await query<{
    channels: {
      edges: {
        node: {
          id: string
          payee: string
          modelId: string
          status: "OPEN" | "CLOSING" | "WITHDRAWN"
          deposit: string
          settledAmount: string
          closeRequestedAtMs: string | null
        }
      }[]
    }
  }>(CHANNELS_QUERY, { payer, first: 200 })
  return data.channels.edges.map(({ node }) => ({
    id: node.id,
    payee: node.payee,
    modelId: node.modelId,
    status: node.status,
    deposit: BigInt(node.deposit),
    settledAmount: BigInt(node.settledAmount),
    closeRequestedAtMs: node.closeRequestedAtMs ? BigInt(node.closeRequestedAtMs) : null,
  }))
}

export const totalSettledMicros = async (payer: string) => {
  const channels = await channelsForPayer(payer)
  return channels.reduce((sum, c) => sum + c.settledAmount, 0n)
}
