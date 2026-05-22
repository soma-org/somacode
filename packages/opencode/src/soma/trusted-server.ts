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
  const results = await probeAll(providers)
  liveByAddress = new Map(results)
  cache = results
    .filter(([, live]) => live)
    .map(([address]) => ({ provider_address: address, authorized: true as const }))
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
