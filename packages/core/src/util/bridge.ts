import { encodeFunctionData, parseUnits, type Hex } from "viem"

// Base Sepolia addresses (see bridge.md).
export const BASE_SEPOLIA_CHAIN_ID = 84532
export const SOMA_BRIDGE_ADDRESS: Hex = "0x5458a14d8a28CAff779f029FA3d60B8F9523C85b"
export const BASE_SEPOLIA_USDC: Hex = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
export const SOMA_DESTINATION_CHAIN_ID = 2

// Soma recipient is a 32-byte address. Hardcoded until per-user derivation lands.
export const SOMA_RECIPIENT: Hex = "0xcf0ba8ae309d3f4160ece7729c681defcab8854fdb4cb1c3e3ff7e0859b387c8"

export const USDC_DECIMALS = 6

const USDC_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const

const SOMA_BRIDGE_DEPOSIT_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "destinationChainID", type: "uint8" },
      { name: "somaRecipient", type: "bytes32" },
      { name: "amount", type: "uint64" },
    ],
    outputs: [],
  },
] as const

export type BridgeCall = {
  to: Hex
  value: Hex
  data: Hex
}

export function buildApproveCall(amount: bigint): BridgeCall {
  return {
    to: BASE_SEPOLIA_USDC,
    value: "0x0",
    data: encodeFunctionData({
      abi: USDC_APPROVE_ABI,
      functionName: "approve",
      args: [SOMA_BRIDGE_ADDRESS, amount],
    }),
  }
}

export function buildDepositCall(amount: bigint, somaRecipient: Hex = SOMA_RECIPIENT): BridgeCall {
  return {
    to: SOMA_BRIDGE_ADDRESS,
    value: "0x0",
    data: encodeFunctionData({
      abi: SOMA_BRIDGE_DEPOSIT_ABI,
      functionName: "deposit",
      args: [SOMA_DESTINATION_CHAIN_ID, somaRecipient, amount],
    }),
  }
}

export function buildBridgeCalls(amount: bigint, somaRecipient: Hex = SOMA_RECIPIENT): [BridgeCall, BridgeCall] {
  return [buildApproveCall(amount), buildDepositCall(amount, somaRecipient)]
}

export function usdcToMicros(humanAmount: string | number): bigint {
  if (typeof humanAmount === "number") return BigInt(Math.round(humanAmount * 1_000_000))
  return parseUnits(humanAmount, USDC_DECIMALS)
}

export type BridgeFailureReason =
  | "missing_paymaster_url"
  | "missing_amount"
  | "invalid_amount"
  | "user_op_failed"
  | "paymaster_rejected"
  | "network_error"
  | "unsupported_platform"

export type BridgeResult =
  | {
      ok: true
      bundleId: string
      txHash?: Hex
      amount: bigint
      somaRecipient: Hex
    }
  | {
      ok: false
      reason: BridgeFailureReason
      message?: string
    }
