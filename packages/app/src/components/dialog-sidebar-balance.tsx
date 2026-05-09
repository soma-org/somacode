import { Button } from "@somacode-ai/ui/button"
import { useDialog } from "@somacode-ai/ui/context/dialog"
import { Dialog } from "@somacode-ai/ui/dialog"
import { showToast } from "@somacode-ai/ui/toast"
import { createMemo, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { usePoints } from "@/context/points"

const checkoutUrl = () => (import.meta.env.VITE_USDC_CHECKOUT_URL ?? "").trim()

export const DialogSidebarBalance: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const points = usePoints()
  const dialog = useDialog()

  const formattedPoints = createMemo(() => new Intl.NumberFormat(language.intl()).format(points.balance()))
  const formattedUsdc = createMemo(() =>
    new Intl.NumberFormat(language.intl(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(points.usdcBalance()),
  )

  const addUsdc = () => {
    const url = checkoutUrl()
    if (!url) {
      showToast({
        variant: "warning",
        title: language.t("sidebar.points.checkoutMissingTitle"),
        description: language.t("sidebar.points.checkoutMissingDescription"),
      })
      return
    }
    platform.openLink(url)
    dialog.close()
  }

  return (
    <Dialog size="large" transition title={language.t("sidebar.points.dialogTitle")}>
      <div class="flex flex-col gap-8 px-5 pb-6 pt-4 sm:px-8 sm:pb-8">
        <div class="flex flex-col gap-2">
          <div class="text-12-medium uppercase tracking-wide text-text-weak">
            {language.t("sidebar.points.sectionPoints")}
          </div>
          <div class="text-[32px] font-medium text-text-strong tabular-nums leading-none">{formattedPoints()}</div>
        </div>
        <div class="flex flex-col gap-4 rounded-xl border border-border-weak-base bg-surface-base p-6">
          <div class="flex flex-col gap-2">
            <div class="text-12-medium uppercase tracking-wide text-text-weak">
              {language.t("sidebar.points.sectionUsdc")}
            </div>
            <div class="text-[32px] font-medium text-text-strong tabular-nums leading-none">
              {formattedUsdc()}
              <span class="text-14-medium text-text-weak ml-2">USDC</span>
            </div>
          </div>
          <Button size="large" class="self-start" onClick={addUsdc}>
            {language.t("sidebar.points.addUsdc")}
          </Button>
        </div>
        <p class="text-14-regular text-text-weak leading-normal">{language.t("sidebar.points.dialogBody")}</p>
      </div>
    </Dialog>
  )
}
