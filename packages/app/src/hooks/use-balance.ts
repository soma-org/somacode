import { onCleanup, onMount } from "solid-js"
import { usePoints } from "@/context/points"

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

const fetchStatus = async () => {
  const res = await fetch("/soma/status").catch(() => undefined)
  if (!res?.ok) return
  return (await res.json()) as { address?: string; walletUsdcMicros?: string; usdcSpentMicros?: string; ready?: boolean }
}

export function useBalance() {
  const points = usePoints()

  const refresh = async () => {
    const status = await fetchStatus()
    if (!status) return
    if (status.address) points.setWalletAddress(status.address)
    points.setWalletUsdcMicros(parseBig(status.walletUsdcMicros))
    points.setUsdcSpentMicros(parseBig(status.usdcSpentMicros))
  }

  onMount(() => {
    void refresh()
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    onCleanup(() => clearInterval(id))
  })
}
