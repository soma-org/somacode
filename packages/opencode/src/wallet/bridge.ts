import { createPublicClient, http, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createBundlerClient, createPaymasterClient, toCoinbaseSmartAccount } from "viem/account-abstraction"
import { baseSepolia } from "viem/chains"
import {
  buildBridgeCalls,
  SOMA_RECIPIENT,
  type BridgeResult,
} from "@opencode-ai/core/util/bridge"

export type ExecuteBridgeOptions = {
  privateKey: Hex
  amount: bigint
  somaRecipient?: Hex
  paymasterUrl?: string
  bundlerUrl?: string
  rpcUrl?: string
}

const DEFAULT_BASE_SEPOLIA_RPC = "https://sepolia.base.org"

export async function executeBridge(options: ExecuteBridgeOptions): Promise<BridgeResult> {
  if (options.amount <= 0n) return { ok: false, reason: "invalid_amount" }

  const paymasterUrl = options.paymasterUrl?.trim() || process.env.BASE_PAYMASTER_URL?.trim()
  if (!paymasterUrl) return { ok: false, reason: "missing_paymaster_url" }

  const bundlerUrl = options.bundlerUrl?.trim() || process.env.BASE_BUNDLER_URL?.trim() || paymasterUrl
  const rpcUrl = options.rpcUrl?.trim() || process.env.BASE_SEPOLIA_RPC_URL?.trim() || DEFAULT_BASE_SEPOLIA_RPC

  try {
    const owner = privateKeyToAccount(options.privateKey)
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    })

    const account = await toCoinbaseSmartAccount({
      client: publicClient,
      owners: [owner],
    })

    const paymaster = createPaymasterClient({ transport: http(paymasterUrl) })
    const bundler = createBundlerClient({
      account,
      client: publicClient,
      transport: http(bundlerUrl),
      paymaster,
    })

    const recipient = options.somaRecipient ?? SOMA_RECIPIENT
    const calls = buildBridgeCalls(options.amount, recipient)

    const userOpHash = await bundler.sendUserOperation({
      calls: calls.map((c) => ({ to: c.to, value: 0n, data: c.data })),
    })

    const receipt = await bundler.waitForUserOperationReceipt({ hash: userOpHash })
    if (!receipt.success) {
      return { ok: false, reason: "user_op_failed", message: "User operation reverted on-chain" }
    }

    return {
      ok: true,
      bundleId: userOpHash,
      txHash: receipt.receipt.transactionHash,
      amount: options.amount,
      somaRecipient: recipient,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/paymaster/i.test(message)) return { ok: false, reason: "paymaster_rejected", message }
    return { ok: false, reason: "network_error", message }
  }
}
