export const DEFAULT_MODELS_GRAPHQL_URL = "https://graphql.testnet.soma.org/graphql"

export type SupportedModel = {
  providerID: string
  modelID: string
  name: string
  free?: boolean
}

export type ModelsResult =
  | { ok: true; models: SupportedModel[] }
  | { ok: false; reason: "http_error" | "invalid_response" | "network_error" | "missing_url" }

const QUERY = `query AllModels($first: Int = 50) {
  offerings(first: $first) {
    edges {
      node {
        modelId
        provider
        promptMicrosPer1K
        completionMicrosPer1K
        cacheReadMicrosPer1K
        cacheWriteMicrosPer1K
        requestMicros
        ttftBoundMs
        ttotBoundMs
        active
        updatedAtMs
      }
    }
    pageInfo {
      hasNextPage
      endCursor
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

function offeringToModel(node: unknown): SupportedModel | null {
  if (!node || typeof node !== "object") return null
  const o = node as Record<string, unknown>
  if (typeof o.modelId !== "string" || typeof o.provider !== "string") return null
  if (o.active === false) return null

  const prompt = toBigInt(o.promptMicrosPer1K)
  const completion = toBigInt(o.completionMicrosPer1K)
  const request = toBigInt(o.requestMicros)
  const free = prompt === 0n && completion === 0n && request === 0n

  return {
    providerID: o.provider,
    modelID: o.modelId,
    name: o.modelId,
    free: free || undefined,
  }
}

export async function fetchSupportedModels(
  options: { url?: string; fetch?: typeof fetch } = {},
): Promise<ModelsResult> {
  const url = options.url ?? DEFAULT_MODELS_GRAPHQL_URL
  if (!url) return { ok: false, reason: "missing_url" }

  const f = options.fetch ?? fetch
  try {
    const res = await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { first: 50 } }),
    })
    if (!res.ok) return { ok: false, reason: "http_error" }

    const json = (await res.json().catch(() => undefined)) as
      | { data?: { offerings?: { edges?: Array<{ node?: unknown }> } } }
      | undefined

    const edges = json?.data?.offerings?.edges
    if (!Array.isArray(edges)) return { ok: false, reason: "invalid_response" }

    const models: SupportedModel[] = []
    for (const edge of edges) {
      const model = offeringToModel(edge?.node)
      if (model) models.push(model)
    }
    return { ok: true, models }
  } catch {
    return { ok: false, reason: "network_error" }
  }
}

export function modelKey(model: { providerID: string; modelID: string }): string {
  return `${model.providerID}:${model.modelID}`
}
