import { http, type Hex } from "viem"
import { createBundlerClient, createPaymasterClient } from "viem/account-abstraction"
import {
  buildBridgeCalls,
  SOMA_RECIPIENT,
  type BridgeResult,
} from "@opencode-ai/core/util/bridge"
import { authorizationHeader } from "@opencode-ai/core/util/intent-token"
import { createBaseSepoliaPublicClient, createSmartAccount } from "./smart-account"
import { BASE_BUNDLER_URL, BASE_PAYMASTER_URL } from "../config/endpoints"

export type ExecuteBridgeOptions = {
  privateKey: Hex
  amount: bigint
  somaRecipient?: Hex
  paymasterUrl?: string
  bundlerUrl?: string
  rpcUrl?: string
}

export async function executeBridge(options: ExecuteBridgeOptions): Promise<BridgeResult> {
  if (options.amount <= 0n) return { ok: false, reason: "invalid_amount" }

  const paymasterUrl = options.paymasterUrl?.trim() || BASE_PAYMASTER_URL
  if (!paymasterUrl) return { ok: false, reason: "missing_paymaster_url" }

  const bundlerUrl = options.bundlerUrl?.trim() || BASE_BUNDLER_URL || paymasterUrl

  try {
    const publicClient = createBaseSepoliaPublicClient(options.rpcUrl)
    const account = await createSmartAccount(options.privateKey, publicClient)

    // When the paymaster URL points at the somacode backend proxy, the request
    // must carry the intent_token JWT minted at /api/auth/register. CDP-direct
    // URLs ignore unknown auth headers, so attaching unconditionally is safe.
    const auth = authorizationHeader(account.address)
    const paymasterTransport = auth
      ? http(paymasterUrl, { fetchOptions: { headers: auth } })
      : http(paymasterUrl)
    const bundlerTransport = auth ? http(bundlerUrl, { fetchOptions: { headers: auth } }) : http(bundlerUrl)

    const paymaster = createPaymasterClient({ transport: paymasterTransport })
    const bundler = createBundlerClient({
      account,
      client: publicClient,
      transport: bundlerTransport,
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
