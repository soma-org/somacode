/** Base URL for the embedded Soma localnet OpenAI-compatible API. */
export const SOMACODE_EMBEDDED_PROVIDER_BASE_URL = "http://127.0.0.1:9000"

/**
 * Resolves when the embedded stack responds on `/v1/models` (or auth errors that
 * still prove the HTTP server is up).
 */
export async function waitForSomacodeLocalnetReady(
  signal: AbortSignal,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? 120_000
  const intervalMs = options?.intervalMs ?? 800
  const deadline = Date.now() + timeoutMs
  const url = `${SOMACODE_EMBEDDED_PROVIDER_BASE_URL}/v1/models`
  while (Date.now() < deadline) {
    if (signal.aborted) return false
    try {
      const r = await fetch(url, { signal, method: "GET" })
      if (r.ok || r.status === 401 || r.status === 403) return true
    } catch {
      if (signal.aborted) return false
      // ECONNREFUSED, etc.
    }
    await Bun.sleep(intervalMs)
    if (signal.aborted) return false
  }
  return false
}
