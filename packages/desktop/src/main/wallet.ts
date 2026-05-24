import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import type { Hex } from "viem"
import {
  runOnrampCheckout,
  type OnrampCheckoutFailureReason,
} from "@opencode-ai/core/util/wallet-checkout"
import {
  DEFAULT_ONRAMP_BASE_URL,
  DEFAULT_PAYMENT_GATEWAY_URL,
} from "@opencode-ai/core/util/onramp-session"
import { setIntentToken } from "@opencode-ai/core/util/intent-token"

type EvmKeypair = {
  privateKey: Hex
  publicKey: Hex
  address: Hex
}

export type WalletCheckoutFailureReason = OnrampCheckoutFailureReason | "unavailable"

export type WalletCheckoutResult =
  | { ok: true; redirectUrl: string; walletAddress: string; oneTimeCode: string }
  | { ok: false; reason: WalletCheckoutFailureReason; message?: string }

function keypairDir(): string {
  return path.join(os.homedir(), ".soma")
}

function keypairFile(): string {
  return path.join(keypairDir(), "evm_keypair.json")
}

function normalizeHex(value: unknown): Hex | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`
  if (!/^0x[0-9a-fA-F]+$/.test(hex)) return null
  return hex as Hex
}

function parseKeypair(raw: string): EvmKeypair | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return null
    const record = parsed as Record<string, unknown>
    const privateKey = normalizeHex(record.privateKey) ?? normalizeHex(record.private_key)
    if (!privateKey || privateKey.length !== 66) return null

    const publicKey = normalizeHex(record.publicKey) ?? normalizeHex(record.public_key)
    const address = normalizeHex(record.address)
    if (publicKey && address) return { privateKey, publicKey, address }
    return deriveKeypair(privateKey)
  } catch {
    return null
  }
}

function deriveKeypair(privateKey: Hex): EvmKeypair {
  const account = privateKeyToAccount(privateKey)
  return {
    privateKey,
    publicKey: account.publicKey,
    address: account.address,
  }
}

async function keypairFileExists(): Promise<boolean> {
  try {
    await fs.access(keypairFile())
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
    throw err
  }
}

async function loadKeypair(): Promise<EvmKeypair | null> {
  try {
    const raw = await fs.readFile(keypairFile(), "utf8")
    return parseKeypair(raw)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
}

let pending: Promise<EvmKeypair> | undefined

async function createKeypair(): Promise<EvmKeypair> {
  const privateKey = generatePrivateKey()
  const keypair = deriveKeypair(privateKey)
  await fs.mkdir(keypairDir(), { recursive: true })
  await fs.writeFile(keypairFile(), JSON.stringify(keypair, null, 2), { mode: 0o600 })
  return keypair
}

export async function ensureKeypair(): Promise<EvmKeypair> {
  if (pending) return pending

  pending = (async () => {
    const existing = await loadKeypair()
    if (existing) return existing
    if (await keypairFileExists()) {
      throw new Error("Failed to parse existing ~/.soma/evm_keypair.json")
    }
    return createKeypair()
  })()

  try {
    return await pending
  } finally {
    pending = undefined
  }
}

function readEnvBaseUrl(): string {
  return process.env.SOMACODE_ONRAMP_BASE_URL?.trim() || DEFAULT_ONRAMP_BASE_URL
}

function readEnvGatewayUrl(): string {
  return (
    process.env.VITE_SOMACODE_PAYMENT_GATEWAY_URL?.trim() ||
    process.env.SOMACODE_PAYMENT_GATEWAY_URL?.trim() ||
    DEFAULT_PAYMENT_GATEWAY_URL
  )
}

export async function startCheckout(): Promise<WalletCheckoutResult> {
  let keypair: EvmKeypair
  try {
    keypair = await ensureKeypair()
  } catch (err) {
    return { ok: false, reason: "unavailable", message: (err as Error)?.message }
  }

  const result = await runOnrampCheckout({
    baseUrl: readEnvBaseUrl(),
    gatewayUrl: readEnvGatewayUrl(),
    publicKey: keypair.publicKey,
    address: keypair.address,
    sign: (nonce) => privateKeyToAccount(keypair.privateKey).signMessage({ message: nonce }),
  })

  if (!result.ok) return { ok: false, reason: result.reason }

  // Cache the JWT in-process for future protected onramp calls.
  // Never forward to the renderer or any other host.
  setIntentToken(result.walletAddress, result.intentToken)

  return {
    ok: true,
    redirectUrl: result.redirectUrl,
    walletAddress: result.walletAddress,
    oneTimeCode: result.oneTimeCode,
  }
}
