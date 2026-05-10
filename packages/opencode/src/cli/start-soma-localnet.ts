import { spawn } from "node:child_process"
import * as Log from "@opencode-ai/core/util/log"

/**
 * Spawns `soma start localnet --force-regenesis` once per CLI process so embedded
 * provider stack is up before Somacode runs (see {@link shouldStartSomaLocalnet}).
 *
 * Uses `stdio: "ignore"`, `detached`, and no shell by default so nothing is printed
 * to the parent terminal and Windows does not open an extra `cmd.exe` window when
 * `soma` is a real `.exe` on `PATH`. If spawn fails with `ENOENT` on Windows because
 * only `soma.cmd` exists, set `SOMACODE_SOMA_LOCALNET_SHELL=1` to fall back to `shell: true`.
 */
export function startSomaLocalnet(): void {
  if (!shouldStartSomaLocalnet()) return

  const args = ["start", "localnet", "--force-regenesis"] as const
  const useShell = process.env.SOMACODE_SOMA_LOCALNET_SHELL === "1"
  const child = spawn("soma", [...args], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: useShell,
  })

  child.on("error", (err) => {
    Log.Default.warn("soma-localnet", { message: String(err) })
  })

  child.unref()
  Log.Default.info("soma-localnet", { pid: child.pid ?? null })
}

export function shouldStartSomaLocalnet(): boolean {
  if (process.env.SOMACODE_SKIP_SOMA_LOCALNET === "1") return false
  const argv = process.argv.slice(2)
  if (argv.includes("-h") || argv.includes("--help")) return false
  if (argv[0] === "completion") return false
  if (argv[0] === "attach") return false
  if (argv.includes("--attach")) return false
  return true
}
