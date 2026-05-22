import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { createMemo, Show, type Component } from "solid-js"
import { DialogOnrampCheckout } from "@/components/dialog-onramp-checkout"
import { useLanguage } from "@/context/language"
import { usePoints } from "@/context/points"

const FUNDING_LOW_THRESHOLD_MICROS = 5_000_000n

const fromMicros = (micros: bigint) => Number(micros) / 1_000_000

export const DialogSidebarBalance: Component = () => {
  const language = useLanguage()
  const points = usePoints()
  const dialog = useDialog()

  const formattedSpent = createMemo(() =>
    new Intl.NumberFormat(language.intl(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(fromMicros(points.usdcSpentMicros())),
  )

  const formattedBalance = createMemo(() =>
    new Intl.NumberFormat(language.intl(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(fromMicros(points.walletUsdcMicros())),
  )

  const lowFunds = createMemo(() => points.walletUsdcMicros() < FUNDING_LOW_THRESHOLD_MICROS)

  const onFund = () => {
    dialog.show(() => <DialogOnrampCheckout />, { dismissable: false })
  }

  return (
    <Dialog size="normal" transition title={language.t("sidebar.points.dialogTitle")}>
      <div class="flex flex-col gap-8 pb-4 pt-4 sm:px-5 sm:pb-8">
        <div class="flex flex-row rounded-xl border border-border-weak-base bg-surface-base p-6">
          <div class="flex flex-col flex-2 ml-2 gap-2">
            <div class="text-12-medium uppercase tracking-wide text-text-weak">
              {language.t("sidebar.points.sectionUsdcSpent")}
            </div>
            <div class="flex items-center text-[32px] font-medium text-text-strong tabular-nums leading-none">
              ${formattedSpent()}
              <Button size="large" class="self-start ml-10" onClick={onFund}>
                {language.t("sidebar.points.fundWallet")}
              </Button>
            </div>
          </div>
          <div class="flex flex-col flex-1 gap-2">
            <div class="text-12-medium uppercase tracking-wide text-text-weak">
              {language.t("sidebar.points.sectionWalletBalance")}
            </div>
            <div class="text-[32px] font-medium text-text-strong tabular-nums leading-none">
              ${formattedBalance()}
            </div>
          </div>
        </div>
        <Show when={points.walletAddress()}>
          <div class="flex flex-col gap-1 rounded-lg border border-border-weak-base bg-surface-base p-4">
            <div class="text-12-medium uppercase tracking-wide text-text-weak">
              {language.t("sidebar.points.walletAddress")}
            </div>
            <div class="text-13-regular font-mono text-text-base break-all">{points.walletAddress()}</div>
          </div>
        </Show>
        <Show when={lowFunds()}>
          <div class="rounded-lg border border-border-weak-base bg-surface-base p-4 text-14-regular text-text-base">
            {language.t("sidebar.points.lowFundsWarning")}
          </div>
        </Show>
        <p class="text-14-regular text-text-weak leading-normal">
          {language.t("sidebar.points.dialogBody")}
        </p>
      </div>
    </Dialog>
  )
}
