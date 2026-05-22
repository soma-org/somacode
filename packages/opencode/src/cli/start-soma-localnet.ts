import * as Log from "@opencode-ai/core/util/log"
import * as Runtime from "@/soma/runtime"

let pending: Promise<void> | undefined

export function startSomaInferenceProxy(): void {
  if (process.env.SOMACODE_SKIP_SOMA_PROXY === "1") return
  if (pending) return
  pending = Runtime.init()
    .then((bootstrap) => {
      process.env.SOMA_PROXY_BASE_URL = bootstrap.baseURL
      process.env.SOMA_WALLET_ADDRESS = bootstrap.address
      process.env.SOMA_STATUS_URL = bootstrap.statusUrl
      Log.Default.info("soma-runtime", {
        baseURL: bootstrap.baseURL,
        address: bootstrap.address,
        statusUrl: bootstrap.statusUrl,
      })
    })
    .catch((err: unknown) => {
      Log.Default.warn("soma-runtime", { message: String(err) })
    })
}

export function awaitSomaProxy(): Promise<void> {
  return pending ?? Promise.resolve()
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

export function startSomaLocalnet(): void {
  startSomaInferenceProxy()
}
