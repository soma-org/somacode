import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import type { Hex } from "viem"

const previousHome = process.env.HOME
const previousUserProfile = process.env.USERPROFILE
let tmpHome = ""

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "evm-keypair-"))
  process.env.HOME = tmpHome
  process.env.USERPROFILE = tmpHome
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = previousUserProfile
  await fs.rm(tmpHome, { recursive: true, force: true })
})

describe("evm-keypair", () => {
  test("reuses existing ~/.soma/evm_keypair.json", async () => {
    const privateKey = generatePrivateKey()
    const account = privateKeyToAccount(privateKey)
    const file = path.join(tmpHome, ".soma", "evm_keypair.json")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({
        privateKey,
        publicKey: account.publicKey,
        address: account.address,
      }),
      "utf8",
    )

    const mod = await import("../../../../src/cli/cmd/tui/util/evm-keypair.ts")
    const loaded = await mod.loadEvmKeypair()
    expect(loaded?.address).toBe(account.address)

    const ensured = await mod.ensureEvmKeypair()
    expect(ensured.address).toBe(account.address)

    const raw = await fs.readFile(file, "utf8")
    expect(JSON.parse(raw).privateKey).toBe(privateKey)
  })

  test("derives public key and address when only privateKey is stored", async () => {
    const privateKey = generatePrivateKey()
    const account = privateKeyToAccount(privateKey)
    const file = path.join(tmpHome, ".soma", "evm_keypair.json")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ privateKey }), "utf8")

    const mod = await import("../../../../src/cli/cmd/tui/util/evm-keypair.ts")
    const loaded = await mod.loadEvmKeypair()
    expect(loaded?.address).toBe(account.address)
    expect(loaded?.publicKey).toBe(account.publicKey)
  })

  test("does not overwrite an existing file it cannot parse", async () => {
    const file = path.join(tmpHome, ".soma", "evm_keypair.json")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ broken: true }), "utf8")

    const mod = await import("../../../../src/cli/cmd/tui/util/evm-keypair.ts")
    await expect(mod.ensureEvmKeypair()).rejects.toThrow("Failed to parse existing")
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ broken: true })
  })

  test("creates a new keypair only when the file is missing", async () => {
    const mod = await import("../../../../src/cli/cmd/tui/util/evm-keypair.ts")
    const first = await mod.ensureEvmKeypair()
    const second = await mod.ensureEvmKeypair()
    expect(second.address).toBe(first.address)
  })

  test("accepts private keys without a 0x prefix", async () => {
    const privateKey = generatePrivateKey()
    const bare = privateKey.slice(2) as Hex
    const account = privateKeyToAccount(privateKey)
    const file = path.join(tmpHome, ".soma", "evm_keypair.json")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ privateKey: bare, address: account.address }), "utf8")

    const mod = await import("../../../../src/cli/cmd/tui/util/evm-keypair.ts")
    const loaded = await mod.loadEvmKeypair()
    expect(loaded?.address).toBe(account.address)
  })
})
