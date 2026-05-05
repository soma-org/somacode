import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@opencode-ai/ui/toast"
import { useProviders } from "@/hooks/use-providers"
import { createMemo, type Component, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { FIXED_PROVIDER_ID } from "@/config/fixed-provider"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { SettingsList } from "./settings-list"

type ProviderSource = "env" | "api" | "config" | "custom"

export const SettingsProviders: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const providers = useProviders()

  const meta = createMemo(() => providers.all().find((p) => p.id === FIXED_PROVIDER_ID))
  const connected = createMemo(() => providers.connected().find((p) => p.id === FIXED_PROVIDER_ID))

  const source = (): ProviderSource | undefined => {
    const item = connected()
    if (!item || !("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const typeTag = () => {
    const current = source()
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") return language.t("settings.providers.tag.config")
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = () => source() !== "env"

  const disconnect = async () => {
    const item = connected()
    if (!item) return
    await globalSDK.client.auth
      .remove({ providerID: FIXED_PROVIDER_ID })
      .then(async () => {
        await globalSDK.client.global.dispose()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: item.name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: item.name }),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const connect = () => {
    dialog.show(() => <DialogConnectProvider provider={FIXED_PROVIDER_ID} />)
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{meta()?.name ?? "OpenRouter"}</h2>
          <p class="text-14-regular text-text-weak">{language.t("dialog.provider.openrouter.note")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <SettingsList>
          <Show
            when={connected()}
            fallback={
              <div class="flex flex-wrap items-center justify-between gap-4 min-h-16 py-3">
                <div class="flex items-center gap-3 min-w-0">
                  <ProviderIcon id={FIXED_PROVIDER_ID} class="size-5 shrink-0 icon-strong-base" />
                  <span class="text-14-medium text-text-strong">{meta()?.name ?? "OpenRouter"}</span>
                </div>
                <Button size="large" variant="secondary" icon="plus-small" onClick={connect}>
                  {language.t("common.connect")}
                </Button>
              </div>
            }
          >
            {(item) => {
              const row = item()
              return (
                <div class="group flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                  <div class="flex items-center gap-3 min-w-0">
                    <ProviderIcon id={row.id} class="size-5 shrink-0 icon-strong-base" />
                    <span class="text-14-medium text-text-strong truncate">{row.name}</span>
                    <Tag>{typeTag()}</Tag>
                  </div>
                  <Show
                    when={canDisconnect()}
                    fallback={
                      <span class="text-14-regular text-text-base opacity-0 group-hover:opacity-100 transition-opacity duration-200 pr-3 cursor-default">
                        {language.t("settings.providers.connected.environmentDescription")}
                      </span>
                    }
                  >
                    <Button size="large" variant="ghost" onClick={() => void disconnect()}>
                      {language.t("common.disconnect")}
                    </Button>
                  </Show>
                </div>
              )
            }}
          </Show>
        </SettingsList>
      </div>
    </div>
  )
}
