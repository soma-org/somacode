import { TextAttributes } from "@opentui/core"
import { createSignal, Match, onCleanup, onMount, Switch } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useBindings } from "../keymap"
import { ensureEvmKeypair, type EvmKeypair } from "../util/evm-keypair"
import { executeBridge } from "@/wallet/bridge"
import {
  SOMA_RECIPIENT,
  usdcToMicros,
  type BridgeFailureReason,
} from "@opencode-ai/core/util/bridge"

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; keypair: EvmKeypair }
  | { kind: "submitting"; keypair: EvmKeypair }
  | { kind: "success"; bundleId: string; txHash?: string }
  | { kind: "error"; reason: BridgeFailureReason | "missing_keypair"; message?: string }

const DEFAULT_AMOUNT = "0.1"

function reasonText(reason: BridgeFailureReason | "missing_keypair", message?: string): string {
  if (message) return message
  switch (reason) {
    case "missing_keypair":
      return "Failed to load wallet keypair from ~/.soma/evm_keypair.json."
    case "missing_paymaster_url":
      return "BASE_PAYMASTER_URL is not configured."
    case "missing_amount":
      return "Amount is missing."
    case "invalid_amount":
      return "Amount must be greater than zero."
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

function shortenHash(value?: string): string {
  if (!value) return "—"
  if (value.length <= 16) return value
  return `${value.slice(0, 10)}…${value.slice(-6)}`
}

export function DialogBridgeTest() {
  const dialog = useDialog()
  const { theme } = useTheme()

  const [phase, setPhase] = createSignal<Phase>({ kind: "loading" })
  const [amount, setAmount] = createSignal(DEFAULT_AMOUNT)
  const alive = { value: true }

  onMount(() => {
    dialog.setSize("medium")
    void ensureEvmKeypair()
      .then((keypair) => {
        if (!alive.value) return
        setPhase({ kind: "ready", keypair })
      })
      .catch(() => {
        if (!alive.value) return
        setPhase({ kind: "error", reason: "missing_keypair" })
      })
  })

  onCleanup(() => {
    alive.value = false
  })

  const submit = async () => {
    const current = phase()
    if (current.kind !== "ready") return
    let micros: bigint
    try {
      micros = usdcToMicros(amount())
    } catch {
      setPhase({ kind: "error", reason: "invalid_amount" })
      return
    }
    if (micros <= 0n) {
      setPhase({ kind: "error", reason: "invalid_amount" })
      return
    }
    setPhase({ kind: "submitting", keypair: current.keypair })
    const result = await executeBridge({ privateKey: current.keypair.privateKey, amount: micros })
    if (!alive.value) return
    if (!result.ok) {
      setPhase({ kind: "error", reason: result.reason, message: result.message })
      return
    }
    setPhase({ kind: "success", bundleId: result.bundleId, txHash: result.txHash })
  }

  const cycleAmount = (delta: number) => {
    const current = Number(amount()) || 0
    const next = Math.max(0, current + delta)
    setAmount(next.toFixed(2))
  }

  useBindings(() => ({
    enabled: () => phase().kind === "ready",
    bindings: [
      { key: "return", desc: "Submit bridge", group: "Dialog", cmd: () => void submit() },
      { key: "+", desc: "Increase amount", group: "Dialog", cmd: () => cycleAmount(0.1) },
      { key: "-", desc: "Decrease amount", group: "Dialog", cmd: () => cycleAmount(-0.1) },
    ],
  }))

  useBindings(() => ({
    enabled: () => phase().kind === "success" || phase().kind === "error",
    bindings: [
      {
        key: "r",
        desc: "Retry",
        group: "Dialog",
        cmd: () => {
          void ensureEvmKeypair()
            .then((keypair) => {
              if (!alive.value) return
              setPhase({ kind: "ready", keypair })
            })
            .catch(() => {
              if (!alive.value) return
              setPhase({ kind: "error", reason: "missing_keypair" })
            })
        },
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Bridge test
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Switch>
        <Match when={phase().kind === "loading"}>
          <text fg={theme.textMuted}>Loading wallet...</text>
        </Match>

        <Match when={phase().kind === "ready"}>
          {(() => {
            const current = phase() as Extract<Phase, { kind: "ready" }>
            return (
              <box gap={1}>
                <text fg={theme.textMuted}>From</text>
                <text fg={theme.text}>{current.keypair.address}</text>
                <text fg={theme.textMuted}>To Soma recipient (hardcoded)</text>
                <text fg={theme.text}>{SOMA_RECIPIENT}</text>
                <text fg={theme.textMuted}>Amount (USDC)</text>
                <text fg={theme.text}>{amount()}</text>
                <box paddingBottom={1}>
                  <text fg={theme.textMuted}>
                    <span style={{ fg: theme.text }}>enter</span> submit{" "}
                    <span style={{ fg: theme.text }}>+/-</span> ±0.1{" "}
                    <span style={{ fg: theme.text }}>esc</span> cancel
                  </text>
                </box>
              </box>
            )
          })()}
        </Match>

        <Match when={phase().kind === "submitting"}>
          <box gap={1}>
            <text fg={theme.textMuted}>Submitting user operation via paymaster...</text>
            <text fg={theme.textMuted}>This may take 10–30 seconds.</text>
          </box>
        </Match>

        <Match when={phase().kind === "success"}>
          {(() => {
            const current = phase() as Extract<Phase, { kind: "success" }>
            return (
              <box gap={1}>
                <text fg={theme.success} attributes={TextAttributes.BOLD}>
                  Bridge submitted
                </text>
                <text fg={theme.textMuted}>Bundle id</text>
                <text fg={theme.text}>{shortenHash(current.bundleId)}</text>
                <text fg={theme.textMuted}>Base tx</text>
                <text fg={theme.text}>{shortenHash(current.txHash)}</text>
                <text fg={theme.textMuted}>
                  Watch https://sepolia.basescan.org/ then check Soma balance in ~30s.
                </text>
                <box paddingBottom={1}>
                  <text fg={theme.textMuted}>
                    <span style={{ fg: theme.text }}>r</span> run again{" "}
                    <span style={{ fg: theme.text }}>esc</span> close
                  </text>
                </box>
              </box>
            )
          })()}
        </Match>

        <Match when={phase().kind === "error"}>
          {(() => {
            const current = phase() as Extract<Phase, { kind: "error" }>
            return (
              <box gap={1}>
                <text fg={theme.error} attributes={TextAttributes.BOLD}>
                  Bridge failed
                </text>
                <text fg={theme.textMuted} wrapMode="word">
                  {reasonText(current.reason, current.message)}
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
