import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import open from "open"
import {
  buildPaymentGatewayUrl,
  isTerminalStatus,
  subscribeToOnrampEvents,
  walletAddressesMatch,
  DEFAULT_PAYMENT_GATEWAY_URL,
  type BuildGatewayUrlFailureReason,
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

type ErrorReason = BuildGatewayUrlFailureReason | "stream_lost"

type Phase =
  | { kind: "input" }
  | { kind: "waiting"; status: OnrampStatus; details?: OnrampTransactionDetails }
  | { kind: "success"; details?: OnrampTransactionDetails }
  | { kind: "rejected"; details?: OnrampTransactionDetails }
  | { kind: "error"; reason: ErrorReason }

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

function errorMessage(reason: ErrorReason): string {
  switch (reason) {
    case "missing_gateway_url":
      return "SOMACODE_PAYMENT_GATEWAY_URL is not configured."
    case "missing_wallet_address":
      return "Wallet address is required."
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
  const gatewayUrl = process.env.SOMACODE_PAYMENT_GATEWAY_URL?.trim() || DEFAULT_PAYMENT_GATEWAY_URL
  const initialWallet = (() => {
    const v = kv.get("wallet_address", "")
    return typeof v === "string" ? v : ""
  })()

  const [phase, setPhase] = createSignal<Phase>({ kind: "input" })
  const [walletError, setWalletError] = createSignal<string | undefined>(undefined)
  const [redirectUrl, setRedirectUrl] = createSignal<string | undefined>(undefined)
  const [activeWallet, setActiveWallet] = createSignal<string | undefined>(undefined)

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
        const wallet = activeWallet()
        if (!wallet) return
        const eventWallet = event.session?.transaction_details?.wallet_address
        if (!walletAddressesMatch(wallet, eventWallet)) return

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
        if (current.kind === "waiting") {
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

  const startCheckout = (wallet: string) => {
    const current = phase()
    if (current.kind === "waiting" || current.kind === "success") return

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

    const result = buildPaymentGatewayUrl({ walletAddress: trimmed, gatewayUrl })
    if (!result.ok) {
      setPhase({ kind: "error", reason: result.reason })
      return
    }

    setActiveWallet(trimmed)
    setRedirectUrl(result.redirectUrl)
    setPhase({ kind: "waiting", status: "initialized" })
    openStream()
    open(result.redirectUrl).catch(() => {})
  }

  const reopenCheckout = () => {
    const url = redirectUrl()
    if (url) open(url).catch(() => {})
  }

  const resetToInput = () => {
    setActiveWallet(undefined)
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
                startCheckout(textarea.plainText)
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
