import { type Subprocess } from "bun"
import fs from "node:fs/promises"
import { openSync, closeSync } from "node:fs"
import os from "node:os"
import path from "path"
import { INDEXER_URL, resolveConfigDir, resolveHome } from "./config"
import { startTrustedServer, type StatusProvider } from "./trusted-server"

export const PROXY_PORT = 11434

const ensurePortFree = async () => {
  try {
    const server = Bun.serve({ port: PROXY_PORT, fetch: () => new Response() })
    server.stop()
    return
  } catch {
    // fall through to soma-proxy detection
  }

  // Port is taken — see if it's an orphan `soma proxy` from a prior TUI session
  // (the previous process attached its stderr to the same controlling terminal,
  // so its warn-level chatter splatters onto the current TUI). If we find one,
  // kill it and retry — there's nothing else legitimate listening on this port.
  let stale: string[] = []
  try {
    const lsof = Bun.spawn(["lsof", "-ti", `tcp:${PROXY_PORT}`], { stdout: "pipe", stderr: "ignore" })
    const text = await new Response(lsof.stdout).text()
    await lsof.exited
    stale = text.split("\n").map((s) => s.trim()).filter(Boolean)
  } catch {
    // lsof not available — fall through to error below
  }

  for (const pid of stale) {
    try {
      // Sanity check it's actually a soma proxy before sending SIGTERM. The
      // `ps -o command=` form prints the full argv; we look for `soma proxy`.
      const ps = Bun.spawn(["ps", "-p", pid, "-o", "command="], { stdout: "pipe", stderr: "ignore" })
      const cmd = (await new Response(ps.stdout).text()).trim()
      await ps.exited
      if (!/\bsoma\b.*\bproxy\b/.test(cmd)) continue
      process.kill(Number(pid), "SIGTERM")
    } catch {
      // best-effort; ignore PIDs we can't introspect or signal
    }
  }

  // Give the OS a moment to release the port, then retry.
  await Bun.sleep(500)
  try {
    const server = Bun.serve({ port: PROXY_PORT, fetch: () => new Response() })
    server.stop()
  } catch (e) {
    throw new Error(
      `port ${PROXY_PORT} is already in use and could not be cleaned up (found PIDs: ${stale.join(", ") || "none"}). ` +
        `Stop the other process manually and retry: ${e}`,
    )
  }
}

const waitReady = async (port: number, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await fetch(`http://127.0.0.1:${port}/v1/models`)
      .then((r) => r.ok || r.status === 401 || r.status === 403)
      .catch(() => false)
    if (ok) return
    await Bun.sleep(300)
  }
  throw new Error(`soma proxy did not become ready on port ${port}`)
}

interface Handle {
  baseURL: string
  port: number
  payer: string
  binary: string
  trustedUrl: string
  statusUrl: string
  livenessAt: () => Map<string, boolean>
  stop: () => Promise<void>
  proc: Subprocess
}

let current: Handle | undefined
let starting: Promise<Handle> | undefined

const spawn = async (
  binary: string,
  payer: string,
  status?: StatusProvider,
  prewarmModel?: string,
): Promise<Handle> => {
  await ensurePortFree()
  const port = PROXY_PORT
  const home = await resolveHome()
  const configDir = await resolveConfigDir()
  const trusted = await startTrustedServer(status)
  const args = [
    "proxy",
    "--listen",
    `127.0.0.1:${port}`,
    "--indexer-url",
    INDEXER_URL,
    "--soma-home",
    home,
    "--client",
    path.join(configDir, "client.yaml"),
    "--address",
    payer,
    "--trusted-providers-url",
    trusted.url,
    "--trusted-providers-refresh-secs",
    "60",
  ]
  if (prewarmModel) args.push("--prewarm-model", prewarmModel)

  // Send proxy logs to ~/.somacode/soma/proxy.log instead of inheriting the
  // TUI's stdout/stderr — the proxy's WARN-level chatter (trusted-providers
  // refresh blips, transient channel hiccups) is harmless and should not
  // splatter onto the model picker UI.
  const logDir = path.join(os.homedir(), ".somacode", "soma")
  await fs.mkdir(logDir, { recursive: true }).catch(() => undefined)
  const logPath = path.join(logDir, "proxy.log")
  // 'a' = append-mode so successive proxy boots accumulate, with the most
  // recent run at the tail of the file. Pass the same fd for stdout + stderr.
  const logFd = openSync(logPath, "a")
  const proc = Bun.spawn([binary, ...args], {
    env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? "inference=warn,sdk=warn" },
    stdout: logFd,
    stderr: logFd,
  })
  const handle: Handle = {
    baseURL: `http://127.0.0.1:${port}/v1`,
    port,
    payer,
    binary,
    trustedUrl: trusted.url,
    statusUrl: `${trusted.url}/status`,
    livenessAt: trusted.live,
    proc,
    stop: async () => {
      trusted.stop()
      proc.kill()
      await proc.exited
      try {
        closeSync(logFd)
      } catch {
        // ignore — fd may already be released by the spawned child's exit
      }
      if (current === handle) current = undefined
    },
  }
  await waitReady(port).catch(async (err) => {
    trusted.stop()
    proc.kill()
    try {
      closeSync(logFd)
    } catch {
      // ignore
    }
    throw err
  })
  await Promise.race([trusted.firstPoll(), Bun.sleep(10_000)])
  return handle
}

export const ensureProxy = async (
  binary: string,
  payer: string,
  status?: StatusProvider,
  prewarmModel?: string,
) => {
  if (current && current.payer === payer && current.binary === binary) return current
  if (starting) return starting
  if (current) await current.stop()
  starting = spawn(binary, payer, status, prewarmModel)
  try {
    current = await starting
    return current
  } finally {
    starting = undefined
  }
}

export const stopProxy = async () => {
  if (current) await current.stop()
}

export const currentHandle = () => current

const installShutdownHooks = () => {
  const shutdown = () => {
    if (current) void current.stop()
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
  process.once("exit", shutdown)
}

installShutdownHooks()
