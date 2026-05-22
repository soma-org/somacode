import { IconButton } from "@opencode-ai/ui/icon-button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createMemo, type Component } from "solid-js"
import { DialogSidebarBalance } from "@/components/dialog-sidebar-balance"
import { useLanguage } from "@/context/language"
import { usePoints } from "@/context/points"

export const SidebarCoinBalance: Component<{ mobile?: boolean }> = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const points = usePoints()

  const openBalance = () => {
    dialog.show(() => <DialogSidebarBalance />)
  }

  const ariaLabel = createMemo(() =>
    language.t("sidebar.points.aria", { spent: (Number(points.usdcSpentMicros()) / 1_000_000).toFixed(2) }),
  )

  return (
    <IconButton
      icon="wallet"
      variant="ghost"
      size="large"
      onClick={openBalance}
      aria-label={ariaLabel()}
    />
  )
}
