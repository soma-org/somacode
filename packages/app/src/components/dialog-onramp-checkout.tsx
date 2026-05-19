import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { createMemo, createSignal, Match, onCleanup, Show, Switch, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { usePoints } from "@/context/points"
import {
  createOnrampSession,
  isTerminalStatus,
  subscribeToOnrampEvents,
  type CreateSessionFailureReason,
  type OnrampStatus,
  type OnrampSubscription,
  type OnrampTransactionDetails,
} from "@/utils/onramp-session"

type Phase =
  | { kind: "input" }
  | { kind: "creating" }
  | { kind: "waiting"; status: OnrampStatus; details?: OnrampTransactionDetails }
  | { kind: "success"; details?: OnrampTransactionDetails }
  | { kind: "rejected"; details?: OnrampTransactionDetails }
  | { kind: "error"; reason: CreateSessionFailureReason | "stream_lost" }

const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/

export const DialogOnrampCheckout: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const points = usePoints()

  const [walletInput, setWalletInput] = createSignal(points.walletAddress() ?? "")
  const [walletError, setWalletError] = createSignal<string | undefined>(undefined)
  const [phase, setPhase] = createSignal<Phase>({ kind: "input" })
  const [redirectUrl, setRedirectUrl] = createSignal<string | undefined>(undefined)

  let subscription: OnrampSubscription | undefined
  const alive = { value: true }

  onCleanup(() => {
    alive.value = false
    subscription?.close()
    subscription = undefined
  })

  const closeStream = () => {
    subscription?.close()
    subscription = undefined
  }

  const startSession = async () => {
    const wallet = walletInput().trim()
    if (!wallet) {
      setWalletError(language.t("onramp.wallet.required"))
      return
    }
    if (!WALLET_PATTERN.test(wallet)) {
      setWalletError(language.t("onramp.wallet.invalid"))
      return
    }
    setWalletError(undefined)
    points.setWalletAddress(wallet)

    setPhase({ kind: "creating" })
    setRedirectUrl(undefined)

    const result = await createOnrampSession({
      walletAddress: wallet,
      fetch: platform.fetch ?? fetch,
    })
    if (!alive.value) return

    if (!result.ok) {
      setPhase({ kind: "error", reason: result.reason })
      return
    }

    setRedirectUrl(result.redirectUrl)
    setPhase({ kind: "waiting", status: "initialized" })

    subscription = subscribeToOnrampEvents({
      sessionId: result.sessionId,
      onEvent: (event) => {
        if (!alive.value) return
        const details = event.session?.transaction_details
        if (event.status === "fulfillment_complete") {
          closeStream()
          setPhase({ kind: "success", details })
          return
        }
        if (event.status === "rejected") {
          closeStream()
          setPhase({ kind: "rejected", details })
          return
        }
        setPhase({ kind: "waiting", status: event.status, details })
      },
      onError: () => {
        if (!alive.value) return
        const current = phase()
        if (current.kind === "waiting" && !isTerminalStatus(current.status)) {
          setPhase({ kind: "error", reason: "stream_lost" })
        }
      },
    })

    platform.openLink(result.redirectUrl)
  }

  const reopenCheckout = () => {
    const url = redirectUrl()
    if (url) platform.openLink(url)
  }

  const resetToInput = () => {
    closeStream()
    setRedirectUrl(undefined)
    setPhase({ kind: "input" })
  }

  const statusLabel = createMemo(() => {
    const current = phase()
    if (current.kind !== "waiting") return ""
    switch (current.status) {
      case "initialized":
        return language.t("onramp.status.initialized")
      case "requires_payment":
        return language.t("onramp.status.requires_payment")
      case "fulfillment_processing":
        return language.t("onramp.status.fulfillment_processing")
      default:
        return language.t("onramp.status.unknown")
    }
  })

  const errorMessage = createMemo(() => {
    const current = phase()
    if (current.kind !== "error") return ""
    switch (current.reason) {
      case "missing_base_url":
        return language.t("onramp.error.missing_base_url")
      case "missing_wallet_address":
        return language.t("onramp.error.missing_wallet_address")
      case "http_error":
        return language.t("onramp.error.http_error")
      case "invalid_response":
        return language.t("onramp.error.invalid_response")
      case "network_error":
        return language.t("onramp.error.network_error")
      case "stream_lost":
        return language.t("onramp.error.stream_lost")
      default:
        return language.t("common.requestFailed")
    }
  })

  const handleSubmit = (e: SubmitEvent) => {
    e.preventDefault()
    void startSession()
  }

  return (
    <Dialog size="normal" transition title={language.t("onramp.dialog.title")}>
      <div class="flex flex-col gap-6 pb-4 pt-4 sm:px-5 sm:pb-8">
        <Switch>
          <Match when={phase().kind === "input"}>
            <form class="flex flex-col gap-5" onSubmit={handleSubmit}>
              <TextField
                autofocus
                type="text"
                label={language.t("onramp.wallet.label")}
                description={language.t("onramp.wallet.description")}
                placeholder={language.t("onramp.wallet.placeholder")}
                value={walletInput()}
                onChange={(v) => {
                  setWalletInput(v)
                  if (walletError()) setWalletError(undefined)
                }}
                validationState={walletError() ? "invalid" : undefined}
                error={walletError()}
              />
              <div class="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
                  {language.t("onramp.cancel")}
                </Button>
                <Button type="submit" variant="primary" size="large">
                  {language.t("onramp.start")}
                </Button>
              </div>
            </form>
          </Match>

          <Match when={phase().kind === "creating"}>
            <div class="flex items-center gap-3 py-6">
              <Spinner class="size-5 text-icon-strong-base" />
              <span class="text-14-regular text-text-base">{language.t("onramp.status.creating")}</span>
            </div>
          </Match>

          <Match when={phase().kind === "waiting"}>
            <div class="flex flex-col gap-4 py-2">
              <div class="flex items-center gap-3">
                <Spinner class="size-5 text-icon-strong-base" />
                <span class="text-14-regular text-text-base">{statusLabel()}</span>
              </div>
              <p class="text-14-regular text-text-weak leading-normal">
                {language.t("onramp.openCheckoutHint")}
              </p>
              <Show when={redirectUrl()}>
                <div class="flex flex-wrap gap-2">
                  <Button type="button" variant="primary" size="large" onClick={reopenCheckout}>
                    {language.t("onramp.openCheckout")}
                  </Button>
                  <Button type="button" variant="ghost" size="large" onClick={resetToInput}>
                    {language.t("onramp.changeWallet")}
                  </Button>
                </div>
              </Show>
            </div>
          </Match>

          <Match when={phase().kind === "success"}>
            {(() => {
              const current = phase() as Extract<Phase, { kind: "success" }>
              const details = current.details
              return (
                <div class="flex flex-col gap-5">
                  <div class="flex items-center gap-3">
                    <Icon name="circle-check" class="text-icon-success-base size-6" />
                    <span class="text-16-medium text-text-strong">
                      {language.t("onramp.success.heading")}
                    </span>
                  </div>
                  <div class="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border-weak-base bg-surface-base p-4">
                    <div class="text-12-medium uppercase tracking-wide text-text-weak">
                      {language.t("onramp.success.amountLabel")}
                    </div>
                    <div class="text-14-regular text-text-strong tabular-nums text-right">
                      {formatAmount(details?.destination_amount)} {(details?.destination_currency ?? "").toUpperCase()}
                    </div>
                    <div class="text-12-medium uppercase tracking-wide text-text-weak">
                      {language.t("onramp.success.paidLabel")}
                    </div>
                    <div class="text-14-regular text-text-strong tabular-nums text-right">
                      {formatAmount(details?.source_amount)} {(details?.source_currency ?? "").toUpperCase()}
                    </div>
                    <div class="text-12-medium uppercase tracking-wide text-text-weak">
                      {language.t("onramp.success.networkLabel")}
                    </div>
                    <div class="text-14-regular text-text-strong text-right capitalize">
                      {details?.destination_network ?? "—"}
                    </div>
                    <div class="text-12-medium uppercase tracking-wide text-text-weak">
                      {language.t("onramp.success.walletLabel")}
                    </div>
                    <div class="text-14-regular text-text-strong text-right break-all font-mono">
                      {shortenAddress(details?.wallet_address)}
                    </div>
                  </div>
                  <div class="flex justify-end">
                    <Button type="button" variant="primary" size="large" onClick={() => dialog.close()}>
                      {language.t("onramp.success.done")}
                    </Button>
                  </div>
                </div>
              )
            })()}
          </Match>

          <Match when={phase().kind === "rejected"}>
            <div class="flex flex-col gap-5">
              <div class="flex items-center gap-3">
                <Icon name="circle-ban-sign" class="text-icon-critical-base size-6" />
                <span class="text-16-medium text-text-strong">{language.t("onramp.rejected.heading")}</span>
              </div>
              <p class="text-14-regular text-text-weak leading-normal">
                {language.t("onramp.rejected.body")}
              </p>
              <div class="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
                  {language.t("onramp.rejected.close")}
                </Button>
                <Button type="button" variant="primary" size="large" onClick={resetToInput}>
                  {language.t("onramp.rejected.retry")}
                </Button>
              </div>
            </div>
          </Match>

          <Match when={phase().kind === "error"}>
            <div class="flex flex-col gap-5">
              <div class="flex items-center gap-3">
                <Icon name="circle-ban-sign" class="text-icon-critical-base size-6" />
                <span class="text-16-medium text-text-strong">{language.t("onramp.error.title")}</span>
              </div>
              <p class="text-14-regular text-text-weak leading-normal">{errorMessage()}</p>
              <div class="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
                  {language.t("onramp.cancel")}
                </Button>
                <Button type="button" variant="primary" size="large" onClick={resetToInput}>
                  {language.t("onramp.retry")}
                </Button>
              </div>
            </div>
          </Match>
        </Switch>
      </div>
    </Dialog>
  )
}

function formatAmount(value?: string): string {
  if (!value) return "—"
  const n = Number(value)
  if (!Number.isFinite(n)) return value
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(n)
}

function shortenAddress(value?: string): string {
  if (!value) return "—"
  if (value.length <= 14) return value
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}
