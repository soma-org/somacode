import { onCleanup, onMount } from "solid-js"
import { usePoints } from "@/context/points"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

const POLL_INTERVAL_MS = 15_000

const parseBig = (v: unknown) => {
  if (typeof v === "string") {
    try {
      return BigInt(v)
    } catch {
      return 0n
    }
  }
  if (typeof v === "number") return BigInt(Math.max(0, Math.floor(v)))
  return 0n
}

export function useBalance() {
  const points = usePoints()
  const sdk = useGlobalSDK()
  const platform = usePlatform()
  const server = useServer()

  // /soma/status is served by the opencode server (port 4096 in dev), not the
  // Vite dev server (port 3000), so a bare fetch("/soma/status") would 404.
  // Use the global SDK's resolved server URL plus the same Basic-auth header
  // the SDK client carries (the route lives behind authOnlyRouterLayer).
  // Must use useGlobalSDK rather than useSDK here — BalanceLoader is mounted
  // above the per-directory SDKProvider in app.tsx.
  const fetchStatus = async () => {
    const base = sdk.url.replace(/\/+$/, "")
    const current = server.current
    const headers: Record<string, string> = {}
    if (current?.http.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: current.http.username,
        password: current.http.password,
      })}`
    }
    const res = await (platform.fetch ?? fetch)(`${base}/soma/status`, { headers }).catch(() => undefined)
    if (!res?.ok) return
    return (await res.json()) as {
      address?: string
      walletUsdcMicros?: string
      usdcSpentMicros?: string
      ready?: boolean
    }
  }

  const refresh = async () => {
    const status = await fetchStatus()
    if (!status) return
    if (status.address) points.setWalletAddress(status.address)
    points.setWalletUsdcMicros(parseBig(status.walletUsdcMicros))
    points.setUsdcSpentMicros(parseBig(status.usdcSpentMicros))
  }

  // A soma wallet is a 32-byte bytes32 (0x + 64 hex chars). Anything else is
  // stale — most commonly an EVM smart account address (0x + 40 hex chars)
  // persisted by an older build of the onramp dialog. Drop it so the next
  // /soma/status response can fill in the real soma address.
  const isSomaShape = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value)

  onMount(() => {
    const current = points.walletAddress()
    if (current && !isSomaShape(current)) points.setWalletAddress("")
    void refresh()
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    onCleanup(() => clearInterval(id))
  })
}
