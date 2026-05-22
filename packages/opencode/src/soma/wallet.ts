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

export const activeAddress = async (binary: string) => {
  const out = (await run(binary, ["wallet", "--json", "active"])).trim()
  const parsed = JSON.parse(out) as string | { address: string }
  return normalize(typeof parsed === "string" ? parsed : parsed.address)
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
