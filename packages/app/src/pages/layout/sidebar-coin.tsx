import { Icon } from "@somacode-ai/ui/icon"
import { useDialog } from "@somacode-ai/ui/context/dialog"
import { createMemo, type Component } from "solid-js"
import { DialogSidebarBalance } from "@/components/dialog-sidebar-balance"
import { useLanguage } from "@/context/language"
import { usePoints } from "@/context/points"

export const SidebarCoinBalance: Component<{ mobile?: boolean }> = () => {
  const language = useLanguage()
  const points = usePoints()
  const dialog = useDialog()

  const formatted = createMemo(() => new Intl.NumberFormat(language.intl()).format(points.balance()))

  const openBalance = () => {
    dialog.show(() => <DialogSidebarBalance />)
  }

  return (
    <button
      type="button"
      data-component="sidebar-points-trigger"
      class="flex flex-col items-center justify-center gap-0.5 w-10 min-h-11 py-1 rounded-md text-text-strong hover:bg-surface-base-hover outline-none focus-visible:shadow-xs-border-focus"
      aria-label={language.t("sidebar.points.aria", { count: formatted() })}
      onClick={openBalance}
    >
      <Icon name="coin" size="small" class="icon-strong-base shrink-0" />
      <span class="text-11-medium tabular-nums leading-none max-w-full truncate px-0.5">{formatted()}</span>
    </button>
  )
}
