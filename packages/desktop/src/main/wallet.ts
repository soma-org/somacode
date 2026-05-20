import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import type { Hex } from "viem"
import {
  authenticateWallet,
  buildPaymentGatewayUrl,
  DEFAULT_ONRAMP_BASE_URL,
  DEFAULT_PAYMENT_GATEWAY_URL,
} from "@opencode-ai/core/util/onramp-session"

type EvmKeypair = {
  privateKey: Hex
  publicKey: Hex
  address: Hex
}

export type WalletCheckoutResult =
  | { ok: true; redirectUrl: string; walletAddress: string }
  | { ok: false; reason: string; message?: string }

function keypairDir(): string {
  return path.join(os.homedir(), ".soma")
}

function keypairFile(): string {
  return path.join(keypairDir(), "evm_keypair.json")
}

function isHex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)
}

function parseKeypair(raw: string): EvmKeypair | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return null
    const { privateKey, publicKey, address } = parsed as Record<string, unknown>
    if (!isHex(privateKey) || !isHex(publicKey) || !isHex(address)) return null
    return { privateKey, publicKey, address }
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

async function loadKeypair(): Promise<EvmKeypair | null> {
  try {
    const raw = await fs.readFile(keypairFile(), "utf8")
    return parseKeypair(raw)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
}

export async function ensureKeypair(): Promise<EvmKeypair> {
  const existing = await loadKeypair()
  if (existing) return existing
  const privateKey = generatePrivateKey()
  const keypair = deriveKeypair(privateKey)
  await fs.mkdir(keypairDir(), { recursive: true })
  await fs.writeFile(keypairFile(), JSON.stringify(keypair, null, 2), { mode: 0o600 })
  return keypair
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

  const auth = await authenticateWallet({
    baseUrl: readEnvBaseUrl(),
    publicKey: keypair.publicKey,
    address: keypair.address,
    sign: (nonce) => privateKeyToAccount(keypair.privateKey).signMessage({ message: nonce }),
  })
  if (!auth.ok) {
    return { ok: false, reason: "auth_failed", message: auth.reason }
  }

  const url = buildPaymentGatewayUrl({ intentId: auth.intent_id, gatewayUrl: readEnvGatewayUrl() })
  if (!url.ok) {
    return { ok: false, reason: url.reason }
  }

  return { ok: true, redirectUrl: url.redirectUrl, walletAddress: keypair.address }
}
