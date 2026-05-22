import { createPublicClient, http, type Hex, type PublicClient } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { toCoinbaseSmartAccount } from "viem/account-abstraction"
import { baseSepolia } from "viem/chains"

const DEFAULT_BASE_SEPOLIA_RPC = "https://sepolia.base.org"
// Coinbase Smart Wallet contract version. Pinning this here guarantees the on-ramp
// recipient address and the bridge user-op sender resolve to the same smart account.
const SMART_ACCOUNT_VERSION = "1.1" as const

function rpcUrl(override?: string): string {
  return override?.trim() || process.env.BASE_SEPOLIA_RPC_URL?.trim() || DEFAULT_BASE_SEPOLIA_RPC
}

export function createBaseSepoliaPublicClient(override?: string): PublicClient {
  return createPublicClient({ chain: baseSepolia, transport: http(rpcUrl(override)) }) as PublicClient
}

export async function createSmartAccount(privateKey: Hex, client: PublicClient) {
  const owner = privateKeyToAccount(privateKey)
  return toCoinbaseSmartAccount({ client, owners: [owner], version: SMART_ACCOUNT_VERSION })
}

const addressCache = new Map<Hex, Promise<Hex>>()

/**
 * Resolve the counterfactual Coinbase Smart Account address whose owner is the
 * EOA derived from `privateKey`. This is the address the on-ramp must deliver
 * USDC to, and the address the bridge user-op spends from. It is not the same
 * as `privateKeyToAccount(privateKey).address` (the EOA itself).
 */
export function getSmartAccountAddress(privateKey: Hex): Promise<Hex> {
  const cached = addressCache.get(privateKey)
  if (cached) return cached
  const pending = (async () => {
    const account = await createSmartAccount(privateKey, createBaseSepoliaPublicClient())
    return account.address
  })()
  addressCache.set(privateKey, pending)
  return pending
}

/**
 * Produce an EIP-191 signature over `message` that backends can verify against
 * the smart-account address via ERC-1271. While the account is undeployed the
 * returned signature is EIP-6492-wrapped so a verifier can simulate deployment;
 * once deployed it degrades to a plain ERC-1271 signature.
 */
export async function signNonceForSmartAccount(privateKey: Hex, message: string): Promise<Hex> {
  const account = await createSmartAccount(privateKey, createBaseSepoliaPublicClient())
  return account.signMessage({ message })
}
