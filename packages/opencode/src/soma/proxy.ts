import { type Subprocess } from "bun"
import fs from "node:fs/promises"
import { openSync, closeSync } from "node:fs"
import os from "node:os"
import path from "path"
import { INDEXER_URL, resolveConfigDir, resolveHome } from "./config"

export const PROXY_PORT = 11434

/** How long to wait for an already-listening process to answer `/v1/models`. */
const ADOPT_PROBE_TIMEOUT_MS = 1_500

/**
 * If something is already listening on `PROXY_PORT` and it answers
 * `GET /v1/models`, return `true` — we can adopt it as our proxy and
 * skip spawning a duplicate. Returns `false` for "port is free" OR
 * "port is taken but the holder doesn't look like soma proxy."
 *
 * Cross-platform: only uses HTTP, no `lsof` / `netstat` shell-outs.
 * The narrower POSIX path below (kill orphans) is still there as
 * defense in depth for the case where the prior soma proxy is hung
 * mid-boot and not yet serving `/v1/models`.
 */
const adoptIfResponsive = async (): Promise<boolean> => {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ADOPT_PROBE_TIMEOUT_MS)
  try {
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/models`, { signal: ctl.signal })
    return r.ok || r.status === 401 || r.status === 403
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

const ensurePortFree = async () => {
  try {
    const server = Bun.serve({ port: PROXY_PORT, fetch: () => new Response() })
    server.stop()
    return
  } catch {
    // fall through to orphan detection
  }

  // Port is taken — see if it's an orphan `soma proxy` from a prior TUI session.
  // lsof / ps are POSIX-only; on Windows we skip the kill path and rely on the
  // earlier `adoptIfResponsive` fast path to reuse a healthy proxy, or surface
  // a clear "port in use" message below if it's something else.
  let stale: string[] = []
  if (process.platform !== "win32") {
    try {
      const lsof = Bun.spawn(["lsof", "-ti", `tcp:${PROXY_PORT}`], { stdout: "pipe", stderr: "ignore" })
      const text = await new Response(lsof.stdout).text()
      await lsof.exited
      stale = text.split("\n").map((s) => s.trim()).filter(Boolean)
    } catch {
      // lsof not available — fall through to error below
    }
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
  /** `true` when the proxy was started by an external process and we adopted it; `stop()` is a no-op. */
  adopted: boolean
  stop: () => Promise<void>
  proc?: Subprocess
}

let current: Handle | undefined
let starting: Promise<Handle> | undefined

const adoptHandle = (binary: string, payer: string): Handle => ({
  baseURL: `http://127.0.0.1:${PROXY_PORT}/v1`,
  port: PROXY_PORT,
  payer,
  binary,
  adopted: true,
  stop: async () => {
    if (current?.adopted) current = undefined
  },
})

const spawn = async (binary: string, payer: string, prewarmModel?: string): Promise<Handle> => {
  // Fast path: someone (another somacode entry point, an orphan from a prior
  // session, a hand-started `soma proxy`) is already serving on PROXY_PORT
  // and answers /v1/models. Adopt it instead of spawning a duplicate that
  // would race on the bind. Cross-platform, no shell-outs.
  if (await adoptIfResponsive()) {
    return adoptHandle(binary, payer)
  }

  await ensurePortFree()
  const port = PROXY_PORT
  const home = await resolveHome()
  const configDir = await resolveConfigDir()

  // Liveness filtering happens inside the Rust proxy now (testnet-v0.1.34+);
  // no more --trusted-providers-url sidecar. The proxy probes each
  // provider's /health directly with --liveness-refresh-secs / -timeout-ms
  // defaults baked in.
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
  ]
  if (prewarmModel) args.push("--prewarm-model", prewarmModel)

  // Send proxy logs to ~/.somacode/soma/proxy.log instead of inheriting the
  // TUI's stdout/stderr — the proxy's INFO-level chatter shouldn't splatter
  // onto the model picker UI.
  const logDir = path.join(os.homedir(), ".somacode", "soma")
  await fs.mkdir(logDir, { recursive: true }).catch(() => undefined)
  const logPath = path.join(logDir, "proxy.log")
  // 'a' = append-mode so successive proxy boots accumulate, with the most
  // recent run at the tail of the file. Pass the same fd for stdout + stderr.
  const logFd = openSync(logPath, "a")
  const proc = Bun.spawn([binary, ...args], {
    env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? "inference=info,sdk=info" },
    stdout: logFd,
    stderr: logFd,
  })
  const handle: Handle = {
    baseURL: `http://127.0.0.1:${port}/v1`,
    port,
    payer,
    binary,
    adopted: false,
    proc,
    stop: async () => {
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
    proc.kill()
    try {
      closeSync(logFd)
    } catch {
      // ignore
    }
    throw err
  })
  return handle
}

export const ensureProxy = async (binary: string, payer: string, prewarmModel?: string) => {
  if (current && current.payer === payer && current.binary === binary) return current
  if (starting) return starting
  if (current) await current.stop()
  starting = spawn(binary, payer, prewarmModel)
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
