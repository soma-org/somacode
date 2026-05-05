import { Popover } from "@opencode-ai/ui/popover"
import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePoints } from "@/context/points"

export const SidebarCoinBalance: Component<{ mobile?: boolean }> = (props) => {
  const language = useLanguage()
  const points = usePoints()

  const formatted = createMemo(() => new Intl.NumberFormat(language.intl()).format(points.balance()))

  const placement = () => (props.mobile ? "bottom" : "right")

  return (
    <Popover
      placement={placement()}
      gutter={8}
      class="min-w-[200px] max-w-[260px]"
      title={language.t("sidebar.points.popoverTitle")}
      modal={false}
      trigger={
        <button
          type="button"
          data-component="sidebar-points-trigger"
          class="flex flex-col items-center justify-center gap-0.5 w-10 min-h-11 py-1 rounded-md text-text-strong hover:bg-surface-base-hover outline-none focus-visible:shadow-xs-border-focus"
          aria-label={language.t("sidebar.points.aria", { count: formatted() })}
        >
          <Icon name="coin" size="small" class="icon-strong-base shrink-0" />
          <span class="text-11-medium tabular-nums leading-none max-w-full truncate px-0.5">{formatted()}</span>
        </button>
      }
    >
      <div class="text-20-medium text-text-strong tabular-nums">{formatted()}</div>
      <p class="text-14-regular text-text-weak mt-2 leading-normal">{language.t("sidebar.points.popoverBody")}</p>
    </Popover>
  )
}
