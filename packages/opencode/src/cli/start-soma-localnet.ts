import { spawn } from "node:child_process"
import * as Log from "@somacode-ai/core/util/log"

/**
 * Spawns `soma start localnet --force-regenesis` once per CLI process so embedded
 * provider stack is up before Somacode runs (see {@link shouldStartSomaLocalnet}).
 */
export function startSomaLocalnet(): void {
  if (!shouldStartSomaLocalnet()) return

  const child = spawn("soma", ["start", "localnet", "--force-regenesis"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: process.platform === "win32",
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
