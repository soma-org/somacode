import { AUTO_TOPUP_AMOUNT_USDC, FUNDING_THRESHOLD_MICROS, LOW_BALANCE_MICROS, resolveConfigDir } from "./config"
import { channelsForPayer } from "./indexer"
import { usdcBalanceMicros } from "./wallet"

const remaining = (deposit: bigint, settled: bigint) => deposit - settled

const topupChannel = async (binary: string, channelId: string) => {
  const proc = Bun.spawn(
    [binary, "channel", "top-up", "--channel-id", channelId, "--amount", AUTO_TOPUP_AMOUNT_USDC, "--coin-type", "usdc"],
    { env: { ...process.env, SOMA_CONFIG_DIR: await resolveConfigDir() }, stdout: "ignore", stderr: "pipe" },
  )
  if ((await proc.exited) !== 0) {
    throw new Error(`top-up failed: ${await new Response(proc.stderr).text()}`)
  }
}

export interface FundingStatus {
  walletUsdcMicros: bigint
  totalDepositMicros: bigint
  totalSettledMicros: bigint
  topupsTriggered: number
  lowBalance: boolean
}

export const sweepAndTopUp = async (binary: string, payer: string): Promise<FundingStatus> => {
  const channels = (await channelsForPayer(payer)).filter((c) => c.status === "OPEN")
  const lowChannels = channels.filter((c) => remaining(c.deposit, c.settledAmount) < FUNDING_THRESHOLD_MICROS)
  const walletUsdcMicros = await usdcBalanceMicros(binary, payer)

  const canTopUp = walletUsdcMicros > BigInt(AUTO_TOPUP_AMOUNT_USDC) * 1_000_000n * BigInt(lowChannels.length)
  const triggered = canTopUp
    ? await Promise.all(
        lowChannels.map((c) =>
          topupChannel(binary, c.id)
            .then(() => true)
            .catch(() => false),
        ),
      ).then((arr) => arr.filter(Boolean).length)
    : 0

  return {
    walletUsdcMicros,
    totalDepositMicros: channels.reduce((s, c) => s + c.deposit, 0n),
    totalSettledMicros: channels.reduce((s, c) => s + c.settledAmount, 0n),
    topupsTriggered: triggered,
    lowBalance: walletUsdcMicros < LOW_BALANCE_MICROS,
  }
}
