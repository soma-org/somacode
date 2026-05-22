import { RGBA, TextAttributes } from "@opentui/core"
import { createSignal, Match, onCleanup, onMount, Show, Switch, createMemo } from "solid-js"
import {
  isTerminalStatus,
  subscribeToOnrampEvents,
  walletAddressesMatch,
  type OnrampStatus,
  type OnrampSubscription,
  type OnrampTransactionDetails,
} from "@opencode-ai/core/util/onramp-session"
import { ONRAMP_BASE_URL, PAYMENT_GATEWAY_URL } from "@/config/endpoints"
import { runOnrampCheckout, type OnrampCheckoutFailureReason } from "@opencode-ai/core/util/wallet-checkout"
import { usdcToMicros, type BridgeFailureReason } from "@opencode-ai/core/util/bridge"
import { executeBridge } from "@/wallet/bridge"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useKV } from "@tui/context/kv"
import { useBindings } from "../keymap"
import { ensureEvmKeypair, type EvmKeypair } from "../util/evm-keypair"
import { getSmartAccountAddress, signNonceForSmartAccount } from "@/wallet/smart-account"
import { openUrl } from "../util/open-url"
import { useRenderer } from "@opentui/solid"

type ErrorReason = OnrampCheckoutFailureReason | "stream_lost" | "missing_keypair" | BridgeFailureReason

type Phase =
  | { kind: "loading_keypair" }
  | { kind: "confirm"; keypair: EvmKeypair }
  | { kind: "authenticating"; keypair: EvmKeypair }
  | { kind: "waiting"; status: OnrampStatus; oneTimeCode: string; details?: OnrampTransactionDetails }
  | { kind: "bridging"; details?: OnrampTransactionDetails }
  | { kind: "success"; details?: OnrampTransactionDetails; bundleId?: string }
  | { kind: "rejected"; details?: OnrampTransactionDetails }
  | { kind: "error"; reason: ErrorReason; message?: string }

type StepStatus = "pending" | "in_progress" | "done" | "error"

const STEP_LABELS = ["Setup Wallet", "Verification", "Buy Base USDC", "To Soma USDC"] as const

const BRIDGE_REASONS: ReadonlySet<ErrorReason> = new Set<ErrorReason>([
  "missing_paymaster_url",
  "missing_amount",
  "invalid_amount",
  "user_op_failed",
  "paymaster_rejected",
  "network_error",
  "unsupported_platform",
])

function computeSteps(phase: Phase): [StepStatus, StepStatus, StepStatus, StepStatus] {
  switch (phase.kind) {
    case "loading_keypair":
      return ["in_progress", "pending", "pending", "pending"]
    case "confirm":
      return ["done", "pending", "pending", "pending"]
    case "authenticating":
      return ["done", "in_progress", "pending", "pending"]
    case "waiting":
      if (phase.status === "fulfillment_complete") return ["done", "done", "done", "in_progress"]
      if (phase.status === "rejected") return ["done", "done", "error", "pending"]
      if (phase.status === "initialized") return ["done", "done", "in_progress", "pending"]
      return ["done", "done", "in_progress", "pending"]
    case "bridging":
      return ["done", "done", "done", "in_progress"]
    case "success":
      return ["done", "done", "done", "done"]
    case "rejected":
      return ["done", "done", "error", "pending"]
    case "error":
      if (phase.reason === "missing_keypair") return ["error", "pending", "pending", "pending"]
      if (phase.reason === "stream_lost") return ["done", "done", "error", "pending"]
      if (BRIDGE_REASONS.has(phase.reason)) return ["done", "done", "done", "error"]
      return ["done", "error", "pending", "pending"]
  }
}

const STEP_DOT_GREEN = RGBA.fromHex("#22c55e")
const STEP_DOT_RED = RGBA.fromHex("#ef4444")
const STEP_DOT_PROGRESS = RGBA.fromHex("#eab308")

function activeStepDetail(phase: Phase): { index: number; detail: string } | undefined {
  switch (phase.kind) {
    case "loading_keypair":
      return { index: 0, detail: "Loading wallet from ~/.soma..." }
    case "authenticating":
      return { index: 1, detail: "Signing nonce..." }
    case "waiting":
      if (phase.status === "initialized") return { index: 2, detail: "Continue checkout in your browser..." }
      if (phase.status === "requires_payment")
        return { index: 2, detail: "Purchasing via Stripe Onramp or LiFi widget..." }
      if (phase.status === "fulfillment_processing") return { index: 2, detail: "Processing your USDC..." }
      if (phase.status === "fulfillment_complete") return { index: 3, detail: "Starting bridge to Soma..." }
      if (phase.status === "rejected") return { index: 2, detail: "Payment was declined" }
      return undefined
    case "bridging":
      return { index: 3, detail: "Bridging Base USDC → Soma USDC via paymaster..." }
    case "rejected":
      return { index: 2, detail: "Payment was declined" }
    case "error": {
      let index = 1
      if (phase.reason === "missing_keypair") index = 0
      else if (phase.reason === "stream_lost") index = 2
      else if (BRIDGE_REASONS.has(phase.reason)) index = 3
      return { index, detail: phase.message ?? errorMessage(phase.reason) }
    }
    default:
      return undefined
  }
}

function StepProgress(props: { phase: Phase }) {
  const { theme } = useTheme()
  const [blink, setBlink] = createSignal(true)
  onMount(() => {
    const timer = setInterval(() => setBlink((b) => !b), 500)
    onCleanup(() => clearInterval(timer))
  })
  const steps = createMemo(() => computeSteps(props.phase))
  const detail = createMemo(() => activeStepDetail(props.phase))

  const dotColor = (status: StepStatus) => {
    if (status === "done") return STEP_DOT_GREEN
    if (status === "error") return STEP_DOT_RED
    if (status === "in_progress") return blink() ? STEP_DOT_PROGRESS : theme.textMuted
    return theme.textMuted
  }

  const detailColor = (status: StepStatus) => {
    if (status === "error") return STEP_DOT_RED
    return theme.textMuted
  }

  return (
    <box flexDirection="column" gap={0}>
      {STEP_LABELS.map((label, i) => {
        const status = () => steps()[i]
        const activeDetail = () => (detail()?.index === i ? detail()!.detail : undefined)
        return (
          <>
            <text>
              <span style={{ fg: dotColor(status()) }}>●</span>
              <span style={{ fg: status() === "pending" ? theme.textMuted : theme.text }}> {label}</span>
            </text>
            <Show when={activeDetail()}>
              {(d) => <text fg={detailColor(status())}>{`   ${d()}`}</text>}
            </Show>
          </>
        )
      })}
    </box>
  )
}

function errorMessage(reason: ErrorReason): string {
  switch (reason) {
    case "missing_gateway_url":
      return "VITE_SOMACODE_PAYMENT_GATEWAY_URL is not configured."
    case "missing_wallet_address":
      return "Wallet address is required."
    case "missing_intent_id":
      return "Backend did not return an intent id."
    case "missing_keypair":
      return "Failed to load wallet keypair from ~/.soma/evm_keypair.json."
    case "nonce_failed":
      return "Could not fetch a sign-in nonce from the backend."
    case "register_failed":
      return "Backend rejected the payment registration."
    case "stream_lost":
      return "Lost connection to the onramp event stream."
    case "missing_paymaster_url":
      return "BASE_PAYMASTER_URL is not configured."
    case "missing_amount":
      return "Bridge amount is missing."
    case "invalid_amount":
      return "Bridge amount must be greater than zero."
    case "user_op_failed":
      return "Bridge transaction reverted on Base."
    case "paymaster_rejected":
      return "Paymaster rejected the sponsorship request."
    case "network_error":
      return "Network error while submitting the bridge transaction."
    case "unsupported_platform":
      return "Bridge is not supported on this platform."
  }
}

function formatAmount(value?: string): string {
  if (!value) return "—"
  const n = Number(value)
  if (!Number.isFinite(n)) return value
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n)
}

export function DialogOnrampCheckout() {
  const dialog = useDialog()
  const renderer = useRenderer()
  const { theme } = useTheme()
  const kv = useKV()

  const baseUrl = ONRAMP_BASE_URL
  const gatewayUrl = PAYMENT_GATEWAY_URL

  const [phase, setPhase] = createSignal<Phase>({ kind: "loading_keypair" })
  const [redirectUrl, setRedirectUrl] = createSignal<string | undefined>(undefined)
  const [activeWallet, setActiveWallet] = createSignal<string | undefined>(undefined)
  const [smartAccountAddress, setSmartAccountAddress] = createSignal<string | undefined>(undefined)

  const somaUsdcBalance = createMemo(() => {
    if (!kv.ready) return 0
    const v = kv.get("usdc_balance", 0)
    return typeof v === "number" && !Number.isNaN(v) ? v : 0
  })

  let subscription: OnrampSubscription | undefined
  const alive = { value: true }

  const applyBalanceUpdate = (details?: OnrampTransactionDetails) => {
    const amount = Number(details?.destination_amount ?? "")
    if (!Number.isFinite(amount) || amount <= 0) return
    const current = kv.get("usdc_balance", 0)
    const base = typeof current === "number" && !Number.isNaN(current) ? current : 0
    kv.set("usdc_balance", base + amount)
  }

  const startBridge = async (details: OnrampTransactionDetails | undefined, keypair: EvmKeypair) => {
    if (!alive.value) return
    setPhase({ kind: "bridging", details })

    // Testing: bridge a fixed 0.1 USDC after onramp completes regardless of the purchased amount.
    const micros = usdcToMicros("0.1")

    const result = await executeBridge({ privateKey: keypair.privateKey, amount: micros })
    if (!alive.value) return

    if (!result.ok) {
      setPhase({ kind: "error", reason: result.reason, message: result.message })
      return
    }
    setPhase({ kind: "success", details, bundleId: result.bundleId })
  }

  const openStream = () => {
    if (subscription) return
    subscription = subscribeToOnrampEvents({
      baseUrl,
      onEvent: (event) => {
        if (!alive.value) return
        const wallet = activeWallet()
        if (!wallet) return
        const eventWallet = event.session?.transaction_details?.wallet_address
        if (!walletAddressesMatch(wallet, eventWallet)) return

        const details = event.session?.transaction_details
        if (event.status === "fulfillment_complete") {
          applyBalanceUpdate(details)
          const current = phase()
          const keypair =
            current.kind === "confirm" || current.kind === "authenticating" ? current.keypair : undefined
          if (keypair) void startBridge(details, keypair)
          else
            void ensureEvmKeypair()
              .then((kp) => startBridge(details, kp))
              .catch(() => setPhase({ kind: "error", reason: "missing_keypair" }))
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

  onMount(() => {
    dialog.setSize("medium")
    openStream()
    void ensureEvmKeypair()
      .then(async (keypair) => {
        if (!alive.value) return
        const smart = await getSmartAccountAddress(keypair.privateKey)
        if (!alive.value) return
        setSmartAccountAddress(smart)
        kv.set("wallet_address", smart)
        setPhase({ kind: "confirm", keypair })
      })
      .catch(() => {
        if (!alive.value) return
        setPhase({ kind: "error", reason: "missing_keypair" })
      })
  })

  onCleanup(() => {
    alive.value = false
    subscription?.close()
    subscription = undefined
  })

  const startCheckout = async (keypair: EvmKeypair) => {
    setPhase({ kind: "authenticating", keypair })

    const smart = smartAccountAddress() ?? (await getSmartAccountAddress(keypair.privateKey))
    if (!alive.value) return
    if (!smartAccountAddress()) setSmartAccountAddress(smart)

    const result = await runOnrampCheckout({
      baseUrl,
      gatewayUrl,
      publicKey: keypair.publicKey,
      address: smart,
      sign: (nonce) => signNonceForSmartAccount(keypair.privateKey, nonce),
    })

    if (!alive.value) return
    if (!result.ok) {
      setPhase({ kind: "error", reason: result.reason, message: result.message })
      return
    }

    setActiveWallet(smart)
    setRedirectUrl(result.redirectUrl)
    setPhase({ kind: "waiting", status: "initialized", oneTimeCode: result.oneTimeCode })
    openStream()
    void openUrl(renderer, result.redirectUrl)
  }

  const reopenCheckout = () => {
    const url = redirectUrl()
    if (url) void openUrl(renderer, url)
  }

  const resetToConfirm = () => {
    setActiveWallet(undefined)
    setRedirectUrl(undefined)
    void ensureEvmKeypair()
      .then((keypair) => {
        if (!alive.value) return
        setPhase({ kind: "confirm", keypair })
      })
      .catch(() => {
        if (!alive.value) return
        setPhase({ kind: "error", reason: "missing_keypair" })
      })
  }

  useBindings(() => ({
    enabled: () => phase().kind === "confirm",
    bindings: [
      {
        key: "return",
        desc: "Start checkout",
        group: "Dialog",
        cmd: () => {
          const current = phase()
          if (current.kind !== "confirm") return
          void startCheckout(current.keypair)
        },
      },
    ],
  }))

  useBindings(() => ({
    enabled: () => phase().kind === "waiting",
    bindings: [
      {
        key: "o",
        desc: "Open payment page",
        group: "Dialog",
        cmd: () => reopenCheckout(),
      },
    ],
  }))

  useBindings(() => ({
    enabled: () => {
      const k = phase().kind
      return k === "rejected" || k === "error"
    },
    bindings: [
      {
        key: "r",
        desc: "Restart",
        group: "Dialog",
        cmd: () => resetToConfirm(),
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Buy USDC
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <StepProgress phase={phase()} />

      <Switch>
        <Match when={phase().kind === "confirm"}>
          {(() => {
            const current = phase() as Extract<Phase, { kind: "confirm" }>
            return (
              <box gap={1}>
                <text fg={theme.textMuted} wrapMode="word">
                  USDC will be delivered to your soma smart wallet:
                </text>
                <text fg={theme.text}>{smartAccountAddress() ?? current.keypair.address}</text>
                <text fg={theme.textMuted} wrapMode="word">
                  Owner key stored in ~/.soma/evm_keypair.json. Keep this file safe.
                </text>
                <box paddingBottom={1}>
                  <text fg={theme.textMuted}>
                    <span style={{ fg: theme.text }}>enter</span> continue{" "}
                    <span style={{ fg: theme.text }}>esc</span> cancel
                  </text>
                </box>
              </box>
            )
          })()}
        </Match>

        <Match when={phase().kind === "waiting"}>
          {(() => {
            const current = phase() as Extract<Phase, { kind: "waiting" }>
            return (
              <box gap={1}>
                <text fg={theme.textMuted} wrapMode="word">
                  A payment page has opened in your browser. Type this code to verify:
                </text>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  {current.oneTimeCode}
                </text>
                <text fg={theme.error} wrapMode="word">
                  Please don't close this dialog until the payment has succeeded.
                </text>
                <box paddingBottom={1}>
                  <text fg={theme.textMuted}>
                    <span style={{ fg: theme.text }}>o</span> open payment page
                  </text>
                </box>
              </box>
            )
          })()}
        </Match>

        <Match when={phase().kind === "bridging"}>
          {(() => {
            const current = phase() as Extract<Phase, { kind: "bridging" }>
            const details = current.details
            return (
              <box gap={1}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Bridging to Soma USDC...
                </text>
                <text fg={theme.textMuted} wrapMode="word">
                  Received{" "}
                  <span style={{ fg: theme.text }}>
                    {formatAmount(details?.destination_amount)} {(details?.destination_currency ?? "USDC").toUpperCase()}
                  </span>{" "}
                  on Base. This may take 10–30 seconds.
                </text>
              </box>
            )
          })()}
        </Match>

        <Match when={phase().kind === "success"}>
          {(() => {
            return (
              <box gap={1}>
                <text fg={theme.success} attributes={TextAttributes.BOLD}>
                  Purchase complete
                </text>
                <box gap={0}>
                  <text fg={theme.textMuted}>
                    Soma wallet <span style={{ fg: theme.text }}>{smartAccountAddress() ?? "—"}</span>
                  </text>
                  <text fg={theme.textMuted}>
                    Soma USDC balance{" "}
                    <span style={{ fg: theme.text }}>${somaUsdcBalance().toFixed(2)}</span>
                  </text>
                </box>
                <box paddingBottom={1}>
                  <text fg={theme.textMuted}>
                    <span style={{ fg: theme.text }}>esc</span> close
                  </text>
                </box>
              </box>
            )
          })()}
        </Match>

        <Match when={phase().kind === "rejected"}>
          <box gap={1}>
            <text fg={theme.error} attributes={TextAttributes.BOLD}>
              Purchase rejected
            </text>
            <text fg={theme.textMuted} wrapMode="word">
              The payment provider declined this transaction. No funds were charged.
            </text>
            <box paddingBottom={1}>
              <text fg={theme.textMuted}>
                <span style={{ fg: theme.text }}>r</span> retry{" "}
                <span style={{ fg: theme.text }}>esc</span> close
              </text>
            </box>
          </box>
        </Match>

        <Match when={phase().kind === "error"}>
          {(() => {
            const current = phase() as Extract<Phase, { kind: "error" }>
            return (
              <box gap={1}>
                <text fg={theme.error} attributes={TextAttributes.BOLD}>
                  Onramp error
                </text>
                <text fg={theme.textMuted} wrapMode="word">
                  {current.message ?? errorMessage(current.reason)}
                </text>
                <box paddingBottom={1}>
                  <text fg={theme.textMuted}>
                    <span style={{ fg: theme.text }}>r</span> retry{" "}
                    <span style={{ fg: theme.text }}>esc</span> close
                  </text>
                </box>
              </box>
            )
          })()}
        </Match>
      </Switch>
    </box>
  )
}
