import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import open from "open"
import {
  createOnrampSession,
  isTerminalStatus,
  subscribeToOnrampEvents,
  type CreateSessionFailureReason,
  type OnrampStatus,
  type OnrampSubscription,
  type OnrampTransactionDetails,
} from "@opencode-ai/core/util/onramp-session"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useKV } from "@tui/context/kv"
import { useBindings } from "../keymap"
import { Spinner } from "./spinner"
import * as Clipboard from "@tui/util/clipboard"

const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/

type Phase =
  | { kind: "input" }
  | { kind: "creating" }
  | { kind: "waiting"; status: OnrampStatus; details?: OnrampTransactionDetails }
  | { kind: "success"; details?: OnrampTransactionDetails }
  | { kind: "rejected"; details?: OnrampTransactionDetails }
  | { kind: "error"; reason: CreateSessionFailureReason | "stream_lost" }

function statusLabel(status: OnrampStatus): string {
  switch (status) {
    case "initialized":
      return "Waiting for you to start payment..."
    case "requires_payment":
      return "Waiting for payment..."
    case "fulfillment_processing":
      return "Processing your USDC..."
    case "fulfillment_complete":
      return "Purchase complete"
    case "rejected":
      return "Purchase rejected"
  }
}

function errorMessage(reason: CreateSessionFailureReason | "stream_lost"): string {
  switch (reason) {
    case "missing_base_url":
      return "SOMACODE_ONRAMP_BASE_URL is not configured."
    case "missing_wallet_address":
      return "Wallet address is required."
    case "http_error":
      return "The onramp backend rejected the request."
    case "invalid_response":
      return "The onramp backend returned an unexpected response."
    case "network_error":
      return "Could not reach the onramp backend."
    case "stream_lost":
      return "Lost connection to the onramp event stream."
  }
}

function formatAmount(value?: string): string {
  if (!value) return "—"
  const n = Number(value)
  if (!Number.isFinite(n)) return value
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n)
}

function shortenAddress(value?: string): string {
  if (!value) return "—"
  if (value.length <= 14) return value
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

export function DialogOnrampCheckout() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const kv = useKV()

  const baseUrl = process.env.SOMACODE_ONRAMP_BASE_URL?.trim() || undefined
  const initialWallet = (() => {
    const v = kv.get("wallet_address", "")
    return typeof v === "string" ? v : ""
  })()

  const [phase, setPhase] = createSignal<Phase>({ kind: "input" })
  const [walletError, setWalletError] = createSignal<string | undefined>(undefined)
  const [redirectUrl, setRedirectUrl] = createSignal<string | undefined>(undefined)
  const [activeSessionId, setActiveSessionId] = createSignal<string | undefined>(undefined)

  let textarea: TextareaRenderable | undefined
  let subscription: OnrampSubscription | undefined
  const alive = { value: true }

  const applyBalanceUpdate = (details?: OnrampTransactionDetails) => {
    const amount = Number(details?.destination_amount ?? "")
    if (!Number.isFinite(amount) || amount <= 0) return
    const current = kv.get("usdc_balance", 0)
    const base = typeof current === "number" && !Number.isNaN(current) ? current : 0
    kv.set("usdc_balance", base + amount)
  }

  const openStream = () => {
    if (subscription) return
    subscription = subscribeToOnrampEvents({
      baseUrl,
      onEvent: (event) => {
        if (!alive.value) return
        const sessionId = activeSessionId()
        const eventSessionId = event.session?.id
        if (!sessionId) return
        if (eventSessionId && eventSessionId !== sessionId) return

        const details = event.session?.transaction_details
        if (event.status === "fulfillment_complete") {
          applyBalanceUpdate(details)
          setPhase({ kind: "success", details })
          return
        }
        if (event.status === "rejected") {
          setPhase({ kind: "rejected", details })
          return
        }
        const current = phase()
        if (current.kind === "waiting" || current.kind === "creating") {
          setPhase({ kind: "waiting", status: event.status, details })
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
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      textarea.focus()
      textarea.gotoLineEnd()
    }, 1)
  })

  onCleanup(() => {
    alive.value = false
    subscription?.close()
    subscription = undefined
  })

  const startSession = async (wallet: string) => {
    const current = phase()
    if (current.kind === "creating" || current.kind === "waiting" || current.kind === "success") return

    const trimmed = wallet.trim()
    if (!trimmed) {
      setWalletError("Wallet address is required.")
      return
    }
    if (!WALLET_PATTERN.test(trimmed)) {
      setWalletError("Enter a valid 0x-prefixed Ethereum address.")
      return
    }
    setWalletError(undefined)
    kv.set("wallet_address", trimmed)

    setActiveSessionId(undefined)
    setRedirectUrl(undefined)
    setPhase({ kind: "creating" })
    openStream()

    const result = await createOnrampSession({ walletAddress: trimmed, baseUrl })
    if (!alive.value) return

    if (!result.ok) {
      setPhase({ kind: "error", reason: result.reason })
      return
    }

    setActiveSessionId(result.sessionId)
    setRedirectUrl(result.redirectUrl)
    setPhase({ kind: "waiting", status: "initialized" })
    open(result.redirectUrl).catch(() => {})
  }

  const reopenCheckout = () => {
    const url = redirectUrl()
    if (url) open(url).catch(() => {})
  }

  const resetToInput = () => {
    setActiveSessionId(undefined)
    setRedirectUrl(undefined)
    setPhase({ kind: "input" })
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      textarea.focus()
    }, 1)
  }

  useBindings(() => ({
    enabled: () => {
      const k = phase().kind
      return k === "waiting" || k === "success" || k === "rejected" || k === "error"
    },
    bindings: [
      {
        key: "o",
        desc: "Open checkout",
        group: "Dialog",
        cmd: () => reopenCheckout(),
      },
      {
        key: "r",
        desc: "Restart",
        group: "Dialog",
        cmd: () => resetToInput(),
      },
    ],
  }))

  useBindings(() => ({
    enabled: () => phase().kind === "input",
    bindings: [
      {
        key: "ctrl+v",
        desc: "Paste wallet address",
        group: "Dialog",
        cmd: async () => {
          if (!textarea || textarea.isDestroyed) return
          const content = await Clipboard.read().catch(() => undefined)
          if (!content || content.mime !== "text/plain") return
          const cleaned = content.data.replace(/\s+/g, "")
          if (!cleaned) return
          textarea.setText(cleaned)
          textarea.gotoLineEnd()
          if (walletError()) setWalletError(undefined)
        },
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

      <Switch>
        <Match when={phase().kind === "input"}>
          <box gap={1}>
            <text fg={theme.textMuted} wrapMode="word">
              Enter the wallet address where USDC will be delivered.
            </text>
            <textarea
              onSubmit={() => {
                if (!textarea) return
                void startSession(textarea.plainText)
              }}
              height={3}
              ref={(val: TextareaRenderable) => {
                textarea = val
              }}
              initialValue={initialWallet}
              placeholder="0x..."
              placeholderColor={theme.textMuted}
              textColor={theme.text}
              focusedTextColor={theme.text}
              cursorColor={theme.text}
            />
            <Show when={walletError()}>
              <text fg={theme.error}>{walletError()}</text>
            </Show>
            <box paddingBottom={1}>
              <text fg={theme.textMuted}>
                <span style={{ fg: theme.text }}>enter</span> submit{" "}
                <span style={{ fg: theme.text }}>esc</span> cancel
              </text>
            </box>
          </box>
        </Match>

        <Match when={phase().kind === "creating"}>
          <box paddingBottom={1}>
            <Spinner color={theme.textMuted}>Starting checkout session...</Spinner>
          </box>
        </Match>

        <Match when={phase().kind === "waiting"}>
          {(() => {
            const current = phase() as Extract<Phase, { kind: "waiting" }>
            return (
              <box gap={1}>
                <Spinner color={theme.textMuted}>{statusLabel(current.status)}</Spinner>
                <text fg={theme.textMuted} wrapMode="word">
                  A checkout page was opened in your browser. Complete the purchase to receive USDC.
                </text>
                <box paddingBottom={1}>
                  <text fg={theme.textMuted}>
                    <span style={{ fg: theme.text }}>o</span> open checkout{" "}
                    <span style={{ fg: theme.text }}>r</span> restart{" "}
                    <span style={{ fg: theme.text }}>esc</span> close
                  </text>
                </box>
              </box>
            )
          })()}
        </Match>

        <Match when={phase().kind === "success"}>
          {(() => {
            const current = phase() as Extract<Phase, { kind: "success" }>
            const details = current.details
            return (
              <box gap={1}>
                <text fg={theme.success} attributes={TextAttributes.BOLD}>
                  Purchase complete
                </text>
                <box gap={0}>
                  <text fg={theme.textMuted}>
                    Received{" "}
                    <span style={{ fg: theme.text }}>
                      {formatAmount(details?.destination_amount)} {(details?.destination_currency ?? "").toUpperCase()}
                    </span>{" "}
                    on{" "}
                    <span style={{ fg: theme.text }}>{details?.destination_network ?? "—"}</span>
                  </text>
                  <text fg={theme.textMuted}>
                    Paid{" "}
                    <span style={{ fg: theme.text }}>
                      {formatAmount(details?.source_amount)} {(details?.source_currency ?? "").toUpperCase()}
                    </span>
                  </text>
                  <text fg={theme.textMuted}>
                    Wallet <span style={{ fg: theme.text }}>{shortenAddress(details?.wallet_address)}</span>
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
                  {errorMessage(current.reason)}
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
