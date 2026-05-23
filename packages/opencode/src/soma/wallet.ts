import { resolveConfigDir } from "./config"

let cachedConfigDir: string | undefined
const configDir = async () => (cachedConfigDir ??= await resolveConfigDir())

const env = async () => ({ ...process.env, SOMA_CONFIG_DIR: await configDir() })

const run = async (binary: string, args: string[]) => {
  const proc = Bun.spawn([binary, ...args], { env: await env(), stdout: "pipe", stderr: "pipe" })
  if ((await proc.exited) !== 0) {
    throw new Error(`${binary} ${args.join(" ")} failed: ${await new Response(proc.stderr).text()}`)
  }
  return new Response(proc.stdout).text()
}

const normalize = (addr: string) => (addr.startsWith("0x") ? addr : `0x${addr}`)

// soma wallet output comes in one of two shapes depending on the binary version:
//   --json:          "<hex>"  or  { "address": "<hex>" }
//   plain text:      "<wallet-name> (<hex>)"
// Returns the trimmed hex (without 0x prefix). Throws if neither shape matches.
const parseActive = (raw: string): string => {
  const out = raw.trim()
  if (!out) throw new Error("soma wallet active returned empty output")
  if (out.startsWith("{") || out.startsWith("\"")) {
    const parsed = JSON.parse(out) as string | { address: string }
    return typeof parsed === "string" ? parsed : parsed.address
  }
  // "name (hex)" — capture the hex inside the last set of parentheses.
  const match = out.match(/\(([0-9a-fA-F]{40,})\)/)
  if (match?.[1]) return match[1]
  throw new Error(`soma wallet active returned unrecognized output: ${out}`)
}

export const activeAddress = async (binary: string) => {
  // Try --json first; some soma versions don't support the flag and fall back
  // to the plain-text format which we also parse.
  let raw: string
  try {
    raw = await run(binary, ["wallet", "--json", "active"])
  } catch {
    raw = await run(binary, ["wallet", "active"])
  }
  return normalize(parseActive(raw))
}

export const usdcBalanceMicros = async (binary: string, address: string): Promise<bigint> => {
  const proc = Bun.spawn([binary, "balance", address, "--json"], { env: await env(), stdout: "pipe", stderr: "ignore" })
  if ((await proc.exited) !== 0) return 0n
  const text = (await new Response(proc.stdout).text()).trim()
  if (!text) return 0n
  const parsed = JSON.parse(text) as { usdc?: number | string }
  if (parsed.usdc === undefined) return 0n
  return BigInt(parsed.usdc)
}

export const ensureWallet = async (binary: string) => {
  return activeAddress(binary)
}
