import { createSignal } from "solid-js"
import { usePlatform } from "@/context/platform"
import { postUsdcCheckoutSession, type UsdcCheckoutResult } from "@/utils/usdc-checkout"

export function useStripe() {
  const platform = usePlatform()
  const [checkoutPending, setCheckoutPending] = createSignal(false)

  const buyUsdc = async (): Promise<UsdcCheckoutResult> => {
    setCheckoutPending(true)
    try {
      return await postUsdcCheckoutSession(platform.fetch ?? fetch)
    } finally {
      setCheckoutPending(false)
    }
  }

  return { checkoutPending, buyUsdc }
}
