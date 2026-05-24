import { ensureSoma } from "./installer"
import { liveModels, totalSettledMicros, type LiveModel } from "./indexer"
import { ensureProxy, stopProxy } from "./proxy"
import { sweepAndTopUp, type FundingStatus } from "./topup"
import { activeAddress, ensureWallet, usdcBalanceMicros } from "./wallet"

export interface Bootstrap {
  address: string
  baseURL: string
  binary: string
}

let bootstrap: Promise<Bootstrap> | undefined
let modelsCache: { at: number; data: LiveModel[] } | undefined
let pollers: Timer[] = []

const MODELS_TTL_MS = 30_000
const POLL_INTERVAL_MS = 60_000

const start = async (): Promise<Bootstrap> => {
  const binary = await ensureSoma()
  await ensureWallet(binary)
  const address = await activeAddress(binary)
  // No `status` object passed any more — the TS trusted-server (which
  // exposed /status) is gone. UI status queries hit the in-process
  // runtime functions (walletUsdcMicros / usdcSpentMicros below)
  // directly, through `/soma/status` in the HTTP API layer.
  const handle = await ensureProxy(binary, address)
  pollers.push(
    setInterval(() => {
      void sweepAndTopUp(binary, address).catch(() => undefined)
    }, POLL_INTERVAL_MS),
    setInterval(() => {
      modelsCache = undefined
    }, MODELS_TTL_MS),
  )
  return { address, baseURL: handle.baseURL, binary }
}

export const init = () => {
  bootstrap ??= start().catch((err) => {
    bootstrap = undefined
    throw err
  })
  return bootstrap
}

export const shutdown = async () => {
  pollers.forEach(clearInterval)
  pollers = []
  await stopProxy()
  bootstrap = undefined
}

export const listAvailableModels = async (): Promise<LiveModel[]> => {
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.data
  await init()
  const data = await liveModels()
  modelsCache = { at: Date.now(), data }
  return data
}

export const usdcSpentMicros = async (): Promise<bigint> => {
  const b = await init()
  return totalSettledMicros(b.address)
}

export const walletUsdcMicros = async (): Promise<bigint> => {
  const b = await init()
  return usdcBalanceMicros(b.binary, b.address)
}

export const fundingStatus = async (): Promise<FundingStatus> => {
  const b = await init()
  return sweepAndTopUp(b.binary, b.address)
}

export const walletAddress = async () => (await init()).address
