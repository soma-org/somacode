import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { usePoints } from "@/context/points"
import { useStripe } from "@/hooks/use-stripe"

export const DialogSidebarBalance: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const points = usePoints()
  const dialog = useDialog()
  const { checkoutPending, buyUsdc } = useStripe()

  const formattedPoints = createMemo(() =>
    new Intl.NumberFormat(language.intl()).format(points.balance()),
  )

  const formattedUsdc = createMemo(() =>
    new Intl.NumberFormat(language.intl(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(points.usdcBalance()),
  )

  const onBuyUsdc = async () => {
    const result = await buyUsdc()
    if (!result.ok) {
      if (result.reason === "missing_checkout_url") {
        showToast({
          variant: "default",
          title: language.t("sidebar.points.checkoutMissingTitle"),
          description: language.t("sidebar.points.checkoutMissingDescription"),
        })
        return
      }
      if (result.reason === "missing_stripe_key") {
        showToast({
          variant: "default",
          title: language.t("sidebar.points.checkoutMissingTitle"),
          description: language.t("sidebar.points.checkoutMissingStripeKeyDescription"),
        })
        return
      }
      if (result.reason === "invalid_response") {
        showToast({
          variant: "error",
          title: language.t("sidebar.points.checkoutSessionInvalidTitle"),
          description: language.t("sidebar.points.checkoutSessionInvalidDescription"),
        })
        return
      }
      showToast({
        variant: "error",
        title: language.t("sidebar.points.checkoutSessionFailedTitle"),
        description: language.t("sidebar.points.checkoutSessionFailedDescription"),
      })
      return
    }

    platform.openLink(result.redirectUrl)
    dialog.close()
  }

  return (
    <Dialog size="normal" transition title={language.t("sidebar.points.dialogTitle")}>
      <div class="flex flex-col gap-8 pb-4 pt-4 sm:px-5 sm:pb-8">
        <div class="flex flex-row rounded-xl border border-border-weak-base bg-surface-base p-6">
          <div class="flex flex-col flex-2 ml-2 gap-2">
            <div class="text-12-medium uppercase tracking-wide text-text-weak">
              {language.t("sidebar.points.sectionUsdc")}
            </div>
            <div class="flex items-center text-[32px] font-medium text-text-strong tabular-nums leading-none">
              {formattedUsdc()}
              <Button
                size="large"
                class="self-start ml-10"
                disabled={checkoutPending()}
                onClick={onBuyUsdc}
              >
                {language.t("sidebar.points.buyUsdc")}
              </Button>
            </div>
          </div>
          <div class="flex flex-col flex-1 gap-2">
            <div class="text-12-medium uppercase tracking-wide text-text-weak">
              {language.t("sidebar.points.sectionPoints")}
            </div>
            <div class="text-[32px] font-medium text-text-strong tabular-nums leading-none">
              {formattedPoints()}
            </div>
          </div>
        </div>
        <p class="text-14-regular text-text-weak leading-normal">
          {language.t("sidebar.points.dialogBody")}
        </p>
      </div>
    </Dialog>
  )
}
