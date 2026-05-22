import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { usePoints } from "@/context/points"
import type { WalletCheckoutFailure } from "@/context/platform"
import {
  isTerminalStatus,
  subscribeToOnrampEvents,
  walletAddressesMatch,
  type OnrampStatus,
  type OnrampSubscription,
  type OnrampTransactionDetails,
} from "@/utils/onramp-session"
import { fetchBalance } from "@opencode-ai/core/util/balance-query"

const BALANCE_GRAPHQL_URL = ((import.meta.env.VITE_BALANCE_GRAPHQL_URL as string | undefined) ?? "").trim() || undefined
const BRIDGE_POLL_INTERVAL_MS = 5000
const BRIDGE_POLL_TIMEOUT_MS = 180_000

type ErrorReason = WalletCheckoutFailure | "stream_lost" | "bridge_timeout"

type Phase =
  | { kind: "loading" }
  | { kind: "confirm" }
  | { kind: "authenticating" }
  | { kind: "waiting"; status: OnrampStatus; oneTimeCode: string; details?: OnrampTransactionDetails }
  | { kind: "bridging"; details?: OnrampTransactionDetails }
  | { kind: "success"; details?: OnrampTransactionDetails }
  | { kind: "rejected"; details?: OnrampTransactionDetails }
  | { kind: "error"; reason: ErrorReason; message?: string }

type StepStatus = "pending" | "in_progress" | "done" | "error"

const STEP_LABEL_KEYS = [
  "onramp.step.wallet",
  "onramp.step.verification",
  "onramp.step.buyBaseUsdc",
  "onramp.step.toSomaUsdc",
] as const

const BRIDGE_REASONS: ReadonlySet<ErrorReason> = new Set<ErrorReason>(["bridge_timeout"])

function computeSteps(phase: Phase): [StepStatus, StepStatus, StepStatus, StepStatus] {
  switch (phase.kind) {
    case "loading":
      return ["in_progress", "pending", "pending", "pending"]
    case "confirm":
      return ["done", "pending", "pending", "pending"]
    case "authenticating":
      return ["done", "in_progress", "pending", "pending"]
    case "waiting":
      if (phase.status === "fulfillment_complete") return ["done", "done", "done", "in_progress"]
      if (phase.status === "rejected") return ["done", "done", "error", "pending"]
      return ["done", "done", "in_progress", "pending"]
    case "bridging":
      return ["done", "done", "done", "in_progress"]
    case "success":
      return ["done", "done", "done", "done"]
    case "rejected":
      return ["done", "done", "error", "pending"]
    case "error":
      if (phase.reason === "unavailable") return ["error", "pending", "pending", "pending"]
      if (phase.reason === "stream_lost") return ["done", "done", "error", "pending"]
      if (BRIDGE_REASONS.has(phase.reason)) return ["done", "done", "done", "error"]
      return ["done", "error", "pending", "pending"]
  }
}

function StepProgress(props: { phase: Phase; errorMessage: () => string }) {
  const language = useLanguage()
  const steps = createMemo(() => computeSteps(props.phase))

  const detail = createMemo<{ index: number; text: string } | undefined>(() => {
    const phase = props.phase
    switch (phase.kind) {
      case "loading":
        return { index: 0, text: language.t("onramp.detail.loading") }
      case "authenticating":
        return { index: 1, text: language.t("onramp.detail.authenticating") }
      case "waiting": {
        if (phase.status === "initialized")
          return { index: 2, text: language.t("onramp.detail.initialized") }
        if (phase.status === "requires_payment")
          return { index: 2, text: language.t("onramp.detail.requires_payment") }
        if (phase.status === "fulfillment_processing")
          return { index: 2, text: language.t("onramp.detail.fulfillment_processing") }
        if (phase.status === "fulfillment_complete")
          return { index: 3, text: language.t("onramp.detail.bridge_starting") }
        if (phase.status === "rejected")
          return { index: 2, text: language.t("onramp.detail.rejected") }
        return undefined
      }
      case "bridging":
        return { index: 3, text: language.t("onramp.detail.bridging") }
      case "rejected":
        return { index: 2, text: language.t("onramp.detail.rejected") }
      case "error": {
        let index = 1
        if (phase.reason === "unavailable") index = 0
        else if (phase.reason === "stream_lost") index = 2
        else if (BRIDGE_REASONS.has(phase.reason)) index = 3
        return { index, text: props.errorMessage() }
      }
      default:
        return undefined
    }
  })

  const dotClasses = (status: StepStatus): string => {
    if (status === "done") return "bg-icon-success-base text-text-on-success-base"
    if (status === "error") return "bg-icon-critical-base text-text-on-critical-base"
    if (status === "in_progress")
      return "bg-icon-warning-base text-text-on-warning-base animate-pulse"
    return "bg-surface-base text-text-weak border border-border-weak-base"
  }

  const connectorClass = (prev: StepStatus): string =>
    prev === "done" ? "bg-icon-success-base" : "bg-border-weak-base"

  const labelClass = (status: StepStatus): string =>
    status === "pending" ? "text-text-weak" : "text-text-strong"

  const detailIsError = createMemo(() => {
    const d = detail()
    if (!d) return false
    return steps()[d.index] === "error"
  })

  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-start">
        {STEP_LABEL_KEYS.map((labelKey, i) => (
          <>
            {i > 0 && <div class={`mt-[15px] h-px flex-1 ${connectorClass(steps()[i - 1])}`} />}
            <div class="flex flex-col items-center gap-2 shrink-0 w-[88px]">
              <div
                class={`size-[30px] rounded-full flex items-center justify-center text-12-medium ${dotClasses(steps()[i])}`}
              >
                <Switch fallback={<span>{i + 1}</span>}>
                  <Match when={steps()[i] === "done"}>
                    <Icon name="check" class="size-4" />
                  </Match>
                  <Match when={steps()[i] === "error"}>
                    <Icon name="close" class="size-4" />
                  </Match>
                </Switch>
              </div>
              <div class={`text-12-medium text-center leading-tight ${labelClass(steps()[i])}`}>
                {language.t(labelKey)}
              </div>
            </div>
          </>
        ))}
      </div>
      <Show when={detail()}>
        {(d) => (
          <p
            class={`text-12-regular text-center ${
              detailIsError() ? "text-text-danger-base" : "text-text-weak"
            }`}
          >
            {d().text}
          </p>
        )}
      </Show>
    </div>
  )
}


export const DialogOnrampCheckout: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const points = usePoints()

  const [phase, setPhase] = createSignal<Phase>(platform.wallet ? { kind: "loading" } : { kind: "error", reason: "unavailable" })
  const [redirectUrl, setRedirectUrl] = createSignal<string | undefined>(undefined)
  const [activeWallet, setActiveWallet] = createSignal<string | undefined>(undefined)

  let subscription: OnrampSubscription | undefined
  const alive = { value: true }

  const waitForBridgeCredit = async (details: OnrampTransactionDetails | undefined, walletAddress: string) => {
    if (!alive.value) return
    setPhase({ kind: "bridging", details })

    const expectedDelta = Number(details?.destination_amount ?? "")
    const baseline = await fetchBalance({
      url: BALANCE_GRAPHQL_URL,
      fetch: platform.fetch ?? fetch,
      address: walletAddress,
    })
    if (!alive.value) return
    const baselineUsdc = baseline.ok ? baseline.usdcBalance : points.usdcBalance()
    // Soma indexer reports in micros; allow a tiny epsilon (1c) for float reconstruction.
    const target = baselineUsdc + (Number.isFinite(expectedDelta) && expectedDelta > 0 ? expectedDelta - 0.01 : 0)

    const deadline = Date.now() + BRIDGE_POLL_TIMEOUT_MS
    while (alive.value) {
      await new Promise((resolve) => setTimeout(resolve, BRIDGE_POLL_INTERVAL_MS))
      if (!alive.value) return
      const result = await fetchBalance({
        url: BALANCE_GRAPHQL_URL,
        fetch: platform.fetch ?? fetch,
        address: walletAddress,
      })
      if (!alive.value) return
      if (result.ok && result.usdcBalance > target) {
        points.setUsdcBalance(result.usdcBalance)
        setPhase({ kind: "success", details })
        return
      }
      if (Date.now() >= deadline) {
        setPhase({ kind: "error", reason: "bridge_timeout" })
        return
      }
    }
  }

  const openStream = () => {
    if (subscription) return
    subscription = subscribeToOnrampEvents({
      onEvent: (event) => {
        if (!alive.value) return
        const wallet = activeWallet()
        const eventWallet = event.session?.transaction_details?.wallet_address
        if (!wallet) return
        if (!walletAddressesMatch(wallet, eventWallet)) return

        const details = event.session?.transaction_details
        if (event.status === "fulfillment_complete") {
          void waitForBridgeCredit(details, wallet)
          return
        }
        if (event.status === "rejected") {
          setPhase({ kind: "rejected", details })
          return
        }
        const current = phase()
        if (current.kind === "waiting") {
          setPhase({ kind: "waiting", status: event.status, oneTimeCode: current.oneTimeCode, details })
        }
      },
      onError: () => {
        if (!alive.value) return
        const current = phase()
        if (current.kind === "waiting" && !isTerminalStatus(current.status)) {
          setPhase({ kind: "error", reason: "stream_lost" })
        }
      },
    })
  }

  const applyBalanceUpdate = (details?: OnrampTransactionDetails) => {
    const amount = Number(details?.destination_amount ?? "")
    if (!Number.isFinite(amount) || amount <= 0) return
    points.setWalletUsdcMicros((current) => current + BigInt(Math.round(amount * 1_000_000)))
  }

  onMount(() => {
    openStream()
    if (!platform.wallet) return
    setPhase({ kind: "confirm" })
  })

  onCleanup(() => {
    alive.value = false
    subscription?.close()
    subscription = undefined
  })

  const startCheckout = async () => {
    if (!platform.wallet) return
    setPhase({ kind: "authenticating" })
    const result = await platform.wallet.startCheckout()
    if (!alive.value) return
    if (!result.ok) {
      setPhase({ kind: "error", reason: result.reason, message: result.message })
      return
    }
    points.setWalletAddress(result.walletAddress)
    setActiveWallet(result.walletAddress)
    setRedirectUrl(result.redirectUrl)
    setPhase({ kind: "waiting", status: "initialized", oneTimeCode: result.oneTimeCode })
    openStream()
    platform.openLink(result.redirectUrl)
  }

  const reopenCheckout = () => {
    const url = redirectUrl()
    if (url) platform.openLink(url)
  }

  const resetToConfirm = () => {
    setActiveWallet(undefined)
    setRedirectUrl(undefined)
    setPhase(platform.wallet ? { kind: "confirm" } : { kind: "error", reason: "unavailable" })
  }

  const errorMessage = createMemo(() => {
    const current = phase()
    if (current.kind !== "error") return ""
    switch (current.reason) {
      case "missing_gateway_url":
        return language.t("onramp.error.missing_gateway_url")
      case "missing_intent_id":
        return language.t("onramp.error.missing_intent_id")
      case "unavailable":
        return language.t("onramp.error.wallet_unavailable")
      case "auth_failed":
        return language.t("onramp.error.auth_failed")
      case "network":
        return current.message || language.t("onramp.error.network")
      case "stream_lost":
        return language.t("onramp.error.stream_lost")
      case "bridge_timeout":
        return language.t("onramp.error.bridge_timeout")
      default:
        return language.t("common.requestFailed")
    }
  })

  return (
    <Dialog size="normal" transition title={language.t("onramp.dialog.title")}>
      <div class="flex flex-col gap-6 pb-4 pt-4 sm:px-5 sm:pb-8">
        <StepProgress phase={phase()} errorMessage={errorMessage} />

        <Switch>
          <Match when={phase().kind === "confirm"}>
            <div class="flex flex-col gap-5">
              <p class="text-14-regular text-text-weak leading-normal">{language.t("onramp.confirm.body")}</p>
              <Show when={points.walletAddress()}>
                {(addr) => (
                  <div class="rounded-xl border border-border-weak-base bg-surface-base p-4">
                    <div class="text-14-regular text-text-strong break-all font-mono">{addr()}</div>
                  </div>
                )}
              </Show>
              <div class="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
                  {language.t("onramp.cancel")}
                </Button>
                <Button type="button" variant="primary" size="large" onClick={() => void startCheckout()}>
                  {language.t("onramp.confirm.start")}
                </Button>
              </div>
            </div>
          </Match>

          <Match when={phase().kind === "waiting"}>
            {(() => {
              const current = phase() as Extract<Phase, { kind: "waiting" }>
              return (
                <div class="flex flex-col gap-4 py-2">
                  <p class="text-14-regular text-text-weak leading-normal">{language.t("onramp.code.hint")}</p>
                  <div class="flex items-center justify-center rounded-xl border border-border-weak-base bg-surface-base py-4">
                    <span class="text-[28px] font-mono font-medium tracking-[0.4em] text-text-strong tabular-nums">
                      {current.oneTimeCode}
                    </span>
                  </div>
                  <p class="text-14-medium text-text-danger-base leading-normal">{language.t("onramp.waitingWarning")}</p>
                  <Show when={redirectUrl()}>
                    <div class="flex flex-wrap gap-2">
                      <Button type="button" variant="primary" size="large" onClick={reopenCheckout}>
                        {language.t("onramp.openCheckout")}
                      </Button>
                    </div>
                  </Show>
                </div>
              )
            })()}
          </Match>

          <Match when={phase().kind === "success"}>
            {(() => {
              const current = phase() as Extract<Phase, { kind: "success" }>
              const details = current.details
              return (
                <div class="flex flex-col gap-5">
                  <div class="flex items-center gap-3">
                    <Icon name="circle-check" class="text-icon-success-base size-6" />
                    <span class="text-16-medium text-text-strong">{language.t("onramp.success.heading")}</span>
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
              <p class="text-14-regular text-text-weak leading-normal">{language.t("onramp.rejected.body")}</p>
              <div class="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
                  {language.t("onramp.rejected.close")}
                </Button>
                <Button type="button" variant="primary" size="large" onClick={resetToConfirm}>
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
                <Show when={platform.wallet}>
                  <Button type="button" variant="primary" size="large" onClick={resetToConfirm}>
                    {language.t("onramp.retry")}
                  </Button>
                </Show>
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
