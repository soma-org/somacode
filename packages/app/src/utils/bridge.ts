import { createBaseAccountSDK } from "@base-org/account"
import { numberToHex } from "viem"
import {
  BASE_SEPOLIA_CHAIN_ID,
  buildBridgeCalls,
  SOMA_RECIPIENT,
  type BridgeResult,
} from "@opencode-ai/core/util/bridge"

export type ExecuteBridgeOptions = {
  fromAddress: string
  amount: bigint
  somaRecipient?: `0x${string}`
  paymasterUrl?: string
}

let cachedSdk: ReturnType<typeof createBaseAccountSDK> | undefined
function getSdk() {
  if (cachedSdk) return cachedSdk
  cachedSdk = createBaseAccountSDK({
    appName: "Soma Code",
    appChainIds: [BASE_SEPOLIA_CHAIN_ID],
  })
  return cachedSdk
}

export async function executeBridge(options: ExecuteBridgeOptions): Promise<BridgeResult> {
  if (options.amount <= 0n) return { ok: false, reason: "invalid_amount" }

  const paymasterUrl =
    options.paymasterUrl?.trim() ||
    (import.meta.env.VITE_BASE_PAYMASTER_URL as string | undefined)?.trim()
  if (!paymasterUrl) return { ok: false, reason: "missing_paymaster_url" }

  try {
    const provider = getSdk().getProvider()
    const recipient = options.somaRecipient ?? SOMA_RECIPIENT
    const calls = buildBridgeCalls(options.amount, recipient)

    const result = (await provider.request({
      method: "wallet_sendCalls",
      params: [
        {
          version: "1.0",
          chainId: numberToHex(BASE_SEPOLIA_CHAIN_ID),
          from: options.fromAddress,
          calls,
          capabilities: {
            paymasterService: { url: paymasterUrl },
          },
        },
      ],
    })) as { id?: string } | string

    const bundleId = typeof result === "string" ? result : (result?.id ?? "")
    return {
      ok: true,
      bundleId,
      amount: options.amount,
      somaRecipient: recipient,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/paymaster/i.test(message)) return { ok: false, reason: "paymaster_rejected", message }
    return { ok: false, reason: "network_error", message }
  }
}
