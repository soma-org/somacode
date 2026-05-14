export const DEFAULT_MODELS_GRAPHQL_URL: string | undefined = undefined

export type SupportedModel = {
  providerID: string
  modelID: string
  name: string
  free?: boolean
}

export type ModelsResult =
  | { ok: true; models: SupportedModel[]; mock: boolean }
  | { ok: false; reason: "http_error" | "invalid_response" | "network_error" }

const QUERY = `query SupportedModels {
  supportedModels {
    providerID
    modelID
    name
    free
  }
}`

// Mock GraphQL response used when the endpoint is unset or unreachable.
// Shape matches the `data.supportedModels` field a real server would return.
const MOCK_RESPONSE: { data: { supportedModels: SupportedModel[] } } = {
  data: {
    supportedModels: [
      { providerID: "opencode", modelID: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { providerID: "opencode", modelID: "claude-opus-4-5", name: "Claude Opus 4.5" },
      { providerID: "opencode", modelID: "claude-haiku-4-5", name: "Claude Haiku 4.5", free: true },
      { providerID: "anthropic", modelID: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { providerID: "anthropic", modelID: "claude-opus-4-5", name: "Claude Opus 4.5" },
      { providerID: "openai", modelID: "gpt-5", name: "GPT-5" },
      { providerID: "openai", modelID: "gpt-5-mini", name: "GPT-5 Mini" },
      { providerID: "google", modelID: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { providerID: "google", modelID: "gemini-2.5-flash", name: "Gemini 2.5 Flash", free: true },
      { providerID: "openrouter", modelID: "x-ai/grok-4", name: "Grok 4" },
    ],
  },
}

function parseModels(value: unknown): SupportedModel[] | null {
  if (!Array.isArray(value)) return null
  const out: SupportedModel[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") return null
    const m = item as Record<string, unknown>
    if (typeof m.providerID !== "string" || typeof m.modelID !== "string") return null
    out.push({
      providerID: m.providerID,
      modelID: m.modelID,
      name: typeof m.name === "string" ? m.name : m.modelID,
      free: typeof m.free === "boolean" ? m.free : undefined,
    })
  }
  return out
}

export async function fetchSupportedModels(
  options: { url?: string; fetch?: typeof fetch } = {},
): Promise<ModelsResult> {
  const url = options.url ?? DEFAULT_MODELS_GRAPHQL_URL
  if (!url) return { ok: true, models: MOCK_RESPONSE.data.supportedModels, mock: true }

  const f = options.fetch ?? fetch
  try {
    const res = await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: QUERY }),
    })
    if (!res.ok) return { ok: false, reason: "http_error" }

    const json = (await res.json().catch(() => undefined)) as
      | { data?: { supportedModels?: unknown } }
      | undefined

    const models = parseModels(json?.data?.supportedModels)
    if (!models) return { ok: false, reason: "invalid_response" }
    return { ok: true, models, mock: false }
  } catch {
    return { ok: false, reason: "network_error" }
  }
}

export function modelKey(model: { providerID: string; modelID: string }): string {
  return `${model.providerID}:${model.modelID}`
}
