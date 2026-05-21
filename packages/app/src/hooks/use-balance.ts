import { onMount } from "solid-js"
import { fetchBalance } from "@opencode-ai/core/util/balance-query"
import { usePlatform } from "@/context/platform"
import { usePoints } from "@/context/points"

const ENDPOINT = (import.meta.env.VITE_BALANCE_GRAPHQL_URL ?? "").trim() || undefined

export function useBalance() {
  const points = usePoints()
  const platform = usePlatform()

  onMount(() => {
    void fetchBalance({
      url: ENDPOINT,
      fetch: platform.fetch ?? fetch,
      address: points.walletAddress(),
    }).then((result) => {
      if (!result.ok) return
      points.setUsdcBalance(result.usdcBalance)
      points.setBalance(result.pointsBalance)
    })
  })
}
