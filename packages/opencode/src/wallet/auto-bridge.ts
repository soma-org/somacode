import {
  subscribeToOnrampEvents,
  walletAddressesMatch,
  type OnrampSubscription,
  type OnrampTransactionDetails,
} from "@opencode-ai/core/util/onramp-session"
import { usdcToMicros } from "@opencode-ai/core/util/bridge"
import { ensureEvmKeypair, type EvmKeypair } from "./keypair"
import { getSmartAccountAddress } from "./smart-account"
import { executeBridge } from "./bridge"
import { ONRAMP_BASE_URL } from "../config/endpoints"

let subscription: OnrampSubscription | undefined
let starting: Promise<void> | undefined

async function start(): Promise<void> {
  let keypair: EvmKeypair
  let smartAccountAddress: string
  try {
    keypair = await ensureEvmKeypair()
    smartAccountAddress = await getSmartAccountAddress(keypair.privateKey)
  } catch (err) {
    console.error("[auto-bridge] failed to load keypair / derive smart account:", err)
    return
  }

  const handled = new Set<string>()

  subscription = subscribeToOnrampEvents({
    baseUrl: ONRAMP_BASE_URL,
    onEvent: (event) => {
      if (event.status !== "fulfillment_complete") return
      const details = event.session?.transaction_details
      if (!walletAddressesMatch(smartAccountAddress, details?.wallet_address)) return
      const sessionId = event.session?.id
      if (sessionId && handled.has(sessionId)) return
      if (sessionId) handled.add(sessionId)
      void runBridge(details, keypair.privateKey)
    },
    onError: () => {
      // SSE stream dropped; let the underlying transport reconnect on the next event.
      // If it stays down, the GUI's polling timeout surfaces the failure.
    },
  })
}

async function runBridge(
  _details: OnrampTransactionDetails | undefined,
  privateKey: EvmKeypair["privateKey"],
): Promise<void> {
  // Testing: bridge a fixed 0.1 USDC after onramp completes regardless of the
  // purchased amount. Matches the TUI dialog-onramp-checkout path so TUI and
  // web modes share the same on-chain behavior.
  const micros = usdcToMicros("0.1")

  const result = await executeBridge({ privateKey, amount: micros })
  if (!result.ok) {
    console.error("[auto-bridge] bridge failed:", result.reason, result.message ?? "")
    return
  }
  console.log("[auto-bridge] bridged 0.1 USDC, bundleId:", result.bundleId)
}

export function ensureAutoBridge(): Promise<void> {
  if (subscription) return Promise.resolve()
  if (starting) return starting
  starting = start().finally(() => {
    starting = undefined
  })
  return starting
}
