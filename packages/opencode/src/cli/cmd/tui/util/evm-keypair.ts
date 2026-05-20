import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import type { Hex } from "viem"

export type EvmKeypair = {
  privateKey: Hex
  publicKey: Hex
  address: Hex
}

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

export async function loadEvmKeypair(): Promise<EvmKeypair | null> {
  try {
    const raw = await fs.readFile(keypairFile(), "utf8")
    return parseKeypair(raw)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
}

export async function ensureEvmKeypair(): Promise<EvmKeypair> {
  const existing = await loadEvmKeypair()
  if (existing) return existing

  const privateKey = generatePrivateKey()
  const keypair = deriveKeypair(privateKey)

  await fs.mkdir(keypairDir(), { recursive: true })
  await fs.writeFile(keypairFile(), JSON.stringify(keypair, null, 2), { mode: 0o600 })
  return keypair
}

export async function signMessage(privateKey: Hex, message: string): Promise<Hex> {
  const account = privateKeyToAccount(privateKey)
  return account.signMessage({ message })
}
