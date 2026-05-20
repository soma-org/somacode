import { TextAttributes } from "@opentui/core"
import { createSignal, Match, onCleanup, onMount, Switch } from "solid-js"
import {
  authenticateWallet,
  buildPaymentGatewayUrl,
  isTerminalStatus,
  subscribeToOnrampEvents,
  walletAddressesMatch,
  DEFAULT_PAYMENT_GATEWAY_URL,
  type AuthFailureReason,
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
import { ensureEvmKeypair, signMessage, type EvmKeypair } from "../util/evm-keypair"
import { openUrl } from "../util/open-url"
import { useRenderer } from "@opentui/solid"

type ErrorReason = BuildGatewayUrlFailureReason | AuthFailureReason | "stream_lost" | "missing_keypair"

type Phase =
  | { kind: "loading_keypair" }
  | { kind: "confirm"; keypair: EvmKeypair }
  | { kind: "authenticating"; keypair: EvmKeypair }
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
      return "VITE_SOMACODE_PAYMENT_GATEWAY_URL is not configured."
    case "missing_wallet_address":
      return "Wallet address is required."
    case "missing_intent_id":
      return "Backend did not return an intent id."
    case "missing_keypair":
      return "Failed to load wallet keypair from ~/.soma/evm_keypair.json."
    case "nonce_failed":
      return "Could not fetch a sign-in nonce from the backend."
    case "verify_failed":
      return "Backend rejected the signed nonce."
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
  const renderer = useRenderer()
  const { theme } = useTheme()
  const kv = useKV()

  const baseUrl = process.env.SOMACODE_ONRAMP_BASE_URL?.trim() || undefined
  const gatewayUrl = process.env.VITE_SOMACODE_PAYMENT_GATEWAY_URL?.trim() || DEFAULT_PAYMENT_GATEWAY_URL

  const [phase, setPhase] = createSignal<Phase>({ kind: "loading_keypair" })
  const [redirectUrl, setRedirectUrl] = createSignal<string | undefined>(undefined)
  const [activeWallet, setActiveWallet] = createSignal<string | undefined>(undefined)

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
    void ensureEvmKeypair()
      .then((keypair) => {
        if (!alive.value) return
        kv.set("wallet_address", keypair.address)
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

    const auth = await authenticateWallet({
      baseUrl,
      publicKey: keypair.publicKey,
      address: keypair.address,
      sign: (nonce) => signMessage(keypair.privateKey, nonce),
    })

    if (!alive.value) return
    if (!auth.ok) {
      setPhase({ kind: "error", reason: auth.reason })
      return
    }

    const result = buildPaymentGatewayUrl({ intentId: auth.intent_id, gatewayUrl })
    if (!result.ok) {
      setPhase({ kind: "error", reason: result.reason })
      return
    }

    setActiveWallet(keypair.address)
    setRedirectUrl(result.redirectUrl)
    setPhase({ kind: "waiting", status: "initialized" })
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

      <Switch>
        <Match when={phase().kind === "loading_keypair"}>
          <box gap={1}>
            <Spinner color={theme.textMuted}>Loading wallet...</Spinner>
            <box paddingBottom={1} />
          </box>
        </Match>

        <Match when={phase().kind === "confirm"}>
          {(() => {
            const current = phase() as Extract<Phase, { kind: "confirm" }>
            return (
              <box gap={1}>
                <text fg={theme.textMuted} wrapMode="word">
                  USDC will be delivered to your soma wallet:
                </text>
                <text fg={theme.text}>{current.keypair.address}</text>
                <text fg={theme.textMuted} wrapMode="word">
                  Stored in ~/.soma/evm_keypair.json. Keep this file safe.
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

        <Match when={phase().kind === "authenticating"}>
          <box gap={1}>
            <Spinner color={theme.textMuted}>Signing in to payment backend...</Spinner>
            <box paddingBottom={1} />
          </box>
        </Match>

        <Match when={phase().kind === "waiting"}>
          {(() => {
            const current = phase() as Extract<Phase, { kind: "waiting" }>
            return (
              <box gap={1}>
                <Spinner color={theme.textMuted}>{statusLabel(current.status)}</Spinner>
                <text fg={theme.textMuted} wrapMode="word">
                  A payment page has opened in your browser. Complete the purchase to receive USDC.
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
