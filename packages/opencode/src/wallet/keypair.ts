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

export class EvmKeypairError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EvmKeypairError"
  }
}

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

export async function loadEvmKeypair(): Promise<EvmKeypair | null> {
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

export async function ensureEvmKeypair(): Promise<EvmKeypair> {
  if (pending) return pending

  pending = (async () => {
    const existing = await loadEvmKeypair()
    if (existing) return existing
    if (await keypairFileExists()) {
      throw new EvmKeypairError("Failed to parse existing ~/.soma/evm_keypair.json")
    }
    return createKeypair()
  })()

  try {
    return await pending
  } finally {
    pending = undefined
  }
}

export async function signMessage(privateKey: Hex, message: string): Promise<Hex> {
  const account = privateKeyToAccount(privateKey)
  return account.signMessage({ message })
}
