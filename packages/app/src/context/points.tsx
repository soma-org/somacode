import { createSimpleContext } from "@opencode-ai/ui/context"
import { makePersisted } from "@solid-primitives/storage"
import { createSignal } from "solid-js"

export const { use: usePoints, provider: PointsProvider } = createSimpleContext({
  name: "Points",
  init: () => {
    const storage = typeof globalThis.localStorage !== "undefined" ? globalThis.localStorage : undefined
    const [usdcSpentMicros, setUsdcSpentMicros] = makePersisted(createSignal(0n), {
      name: "somacode.usdc.spent_micros",
      storage,
      serialize: (v) => v.toString(),
      deserialize: (v) => BigInt(v),
    })
    const [walletAddress, setWalletAddress] = makePersisted(createSignal(""), {
      name: "somacode.wallet.address",
      storage,
    })
    const [walletUsdcMicros, setWalletUsdcMicros] = makePersisted(createSignal(0n), {
      name: "somacode.wallet.usdc_micros",
      storage,
      serialize: (v) => v.toString(),
      deserialize: (v) => BigInt(v),
    })
    return {
      usdcSpentMicros,
      setUsdcSpentMicros,
      walletAddress,
      setWalletAddress,
      walletUsdcMicros,
      setWalletUsdcMicros,
    }
  },
})
