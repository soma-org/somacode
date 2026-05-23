import { INDEXER_URL } from "./config"
import { probeLive } from "./indexer"

type BunServer = ReturnType<typeof Bun.serve>

const REFRESH_MS = 30_000
const PROVIDERS_QUERY = `{ providers(first: 200) { edges { node { address endpoint } } } }`

const fetchProviders = async (): Promise<{ address: string; endpoint: string }[]> => {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: PROVIDERS_QUERY }),
  })
  const body = (await res.json()) as {
    data: { providers: { edges: { node: { address: string; endpoint: string } }[] } }
  }
  return body.data.providers.edges.map((e) => e.node)
}

let cache: { provider_address: string; authorized: true }[] = []
let liveByAddress = new Map<string, boolean>()
let server: BunServer | undefined
let timer: Timer | undefined
let firstHitResolve: () => void = () => undefined
let firstHit = new Promise<void>((r) => (firstHitResolve = r))

// Consecutive-failure counter per address. A provider is dropped from the
// authorized cache only after `MIN_CONSECUTIVE_FAILURES` failed probes in
// a row; a single success resets the counter. Tolerates the kind of
// intermittent /health flake you get on a VPN-routed trans-pacific path
// where a single timeout doesn't mean the provider is down.
const MIN_CONSECUTIVE_FAILURES =
  Number(process.env.SOMACODE_LIVENESS_MIN_FAILURES) || 3
let consecutiveFailures = new Map<string, number>()

// Probe up to N providers in parallel — a `Promise.all` over the unbounded
// list can spawn hundreds of concurrent fetches, which on a slow indexer or
// against an unreachable provider endpoint starves the Bun event loop and
// makes /v1/providers/authorized briefly unresponsive for the proxy. The
// proxy then logs a transient "error sending request" warn. Concurrency=8 is
// fast enough for the active provider population and keeps the loop quiet.
const PROBE_CONCURRENCY = 8

const probeAll = async (providers: { address: string; endpoint: string }[]) => {
  const out: (readonly [string, boolean])[] = []
  let cursor = 0
  const worker = async () => {
    while (cursor < providers.length) {
      const i = cursor++
      const p = providers[i]
      out[i] = [p.address, await probeLive(p.endpoint)] as const
    }
  }
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, providers.length) }, worker))
  return out
}

const refresh = async () => {
  const providers = await fetchProviders().catch(() => [] as { address: string; endpoint: string }[])
  // If the indexer call itself fails we get an empty `providers` list — that's
  // a transient indexer outage, not a chain-wide provider death. Skip the
  // cache update entirely so the previous (possibly-non-empty) cache keeps
  // serving while the indexer recovers.
  if (providers.length === 0) {
    console.warn(
      `[soma trusted-server] indexer returned 0 providers; keeping previous cache (${cache.length} entries)`,
    )
    return
  }

  const results = await probeAll(providers)
  liveByAddress = new Map(results)

  // Update consecutive-failure counters: a success resets to 0; a failure
  // increments. A provider is considered "dead enough to exclude" only at
  // `MIN_CONSECUTIVE_FAILURES`; until then, it stays in the cache so a
  // single bad probe doesn't take it out of rotation. This is critical on
  // high-latency / lossy paths (e.g., CN-VPN → us-central) where a
  // healthy provider can routinely miss one /health probe.
  const nextCounters = new Map<string, number>()
  const liveSet = new Set<string>()
  for (const [addr, live] of results) {
    if (live) {
      nextCounters.set(addr, 0)
      liveSet.add(addr)
    } else {
      const prior = consecutiveFailures.get(addr) ?? 0
      nextCounters.set(addr, prior + 1)
    }
  }
  consecutiveFailures = nextCounters

  // A provider qualifies if it just answered, OR if its failure streak is
  // still under the grace threshold AND it was in the previous cache.
  const previouslyAuthorized = new Set(cache.map((c) => c.provider_address))
  const nextCache: { provider_address: string; authorized: true }[] = []
  for (const { address } of providers) {
    if (liveSet.has(address)) {
      nextCache.push({ provider_address: address, authorized: true as const })
      continue
    }
    const fails = nextCounters.get(address) ?? 0
    if (fails < MIN_CONSECUTIVE_FAILURES && previouslyAuthorized.has(address)) {
      nextCache.push({ provider_address: address, authorized: true as const })
    }
  }

  // Sticky-cache guard: if the new cache is empty but we used to have
  // entries, prefer the old one and warn. Better to route to a stale
  // entry and let the Rust proxy surface a connection error than to
  // refuse every chat request for the next refresh interval.
  if (nextCache.length === 0 && cache.length > 0) {
    console.warn(
      `[soma trusted-server] all ${providers.length} providers failed liveness this round; keeping previous cache`,
    )
    return
  }
  cache = nextCache
}

export interface StatusProvider {
  address: () => string | undefined
  walletUsdcMicros: () => Promise<bigint>
  totalSettledMicros: () => Promise<bigint>
}

export interface TrustedServer {
  url: string
  live: () => Map<string, boolean>
  firstPoll: () => Promise<void>
  stop: () => void
}

export const startTrustedServer = async (status?: StatusProvider): Promise<TrustedServer> => {
  await refresh()
  timer = setInterval(() => void refresh().catch(() => undefined), REFRESH_MS)
  firstHit = new Promise<void>((r) => (firstHitResolve = r))
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const headers = { "access-control-allow-origin": "*", "content-type": "application/json" }
      const path = new URL(req.url).pathname
      if (path === "/v1/providers/authorized") {
        firstHitResolve()
        return new Response(JSON.stringify(cache), { headers })
      }
      if (path === "/status" && status) {
        const [walletUsdcMicros, totalSettledMicros] = await Promise.all([
          status.walletUsdcMicros().catch(() => 0n),
          status.totalSettledMicros().catch(() => 0n),
        ])
        const body = JSON.stringify({
          address: status.address() ?? "",
          walletUsdcMicros: walletUsdcMicros.toString(),
          usdcSpentMicros: totalSettledMicros.toString(),
          liveProviders: cache.length,
        })
        return new Response(body, { headers })
      }
      return new Response("not found", { status: 404 })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    live: () => new Map(liveByAddress),
    firstPoll: () => firstHit,
    stop: () => {
      if (timer) clearInterval(timer)
      timer = undefined
      server?.stop()
      server = undefined
    },
  }
}
