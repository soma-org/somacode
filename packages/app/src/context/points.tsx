import { createSimpleContext } from "@opencode-ai/ui/context"
import { makePersisted } from "@solid-primitives/storage"
import { createSignal } from "solid-js"

export const { use: usePoints, provider: PointsProvider } = createSimpleContext({
  name: "Points",
  init: () => {
    const storage = typeof globalThis.localStorage !== "undefined" ? globalThis.localStorage : undefined
    const [balance, setBalance] = makePersisted(createSignal(0), {
      name: "opencode.points.balance",
      storage,
    })
    const [usdcBalance, setUsdcBalance] = makePersisted(createSignal(0), {
      name: "opencode.usdc.balance",
      storage,
    })
    const [walletAddress, setWalletAddress] = makePersisted(createSignal(""), {
      name: "opencode.wallet.address",
      storage,
    })
    return {
      balance,
      setBalance,
      usdcBalance,
      setUsdcBalance,
      walletAddress,
      setWalletAddress,
    }
  },
})
