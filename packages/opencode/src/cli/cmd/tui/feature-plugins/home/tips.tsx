import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { shouldStartSomaLocalnet } from "../../../../start-soma-localnet"
import { waitForSomacodeLocalnetReady } from "../../../../soma-embedded-provider"
import { Tips, type EmbeddedLocalnetTip } from "./tips-view"
import { useBindings } from "../../keymap"

const id = "internal:home-tips"

function View(props: { api: TuiPluginApi; hidden: boolean; show: boolean; connected: boolean }) {
  const [embeddedLocalnet, setEmbeddedLocalnet] = createSignal<EmbeddedLocalnetTip>("off")

  createEffect(() => {
    if (!props.show || props.connected) {
      setEmbeddedLocalnet("off")
      return
    }
    if (!shouldStartSomaLocalnet()) {
      setEmbeddedLocalnet("off")
      return
    }

    const ac = new AbortController()
    setEmbeddedLocalnet("starting")
    void waitForSomacodeLocalnetReady(ac.signal).then((ok) => {
      if (ac.signal.aborted) return
      setEmbeddedLocalnet(ok ? "ready" : "timeout")
    })

    onCleanup(() => {
      ac.abort()
      setEmbeddedLocalnet("off")
    })
  })

  useBindings(() => ({
    commands: [
      {
        name: "tips.toggle",
        title: props.hidden ? "Show tips" : "Hide tips",
        category: "System",
        namespace: "palette",
        run() {
          props.api.kv.set("tips_hidden", !props.api.kv.get("tips_hidden", false))
          props.api.ui.dialog.clear()
        },
      },
    ],
    bindings: props.api.tuiConfig.keybinds.get("tips.toggle"),
  }))

  return (
    <box
      height={4}
      minHeight={0}
      width="100%"
      maxWidth={75}
      alignItems="flex-start"
      paddingTop={3}
      /** Matches {@link Prompt} input inset: left border (1) + inner `paddingLeft` (2). */
      paddingLeft={3}
      flexShrink={1}
    >
      <Show when={props.show}>
        <Tips connected={props.connected} embeddedLocalnet={embeddedLocalnet()} />
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_bottom() {
        const hidden = createMemo(() => api.kv.get("tips_hidden", false))
        const first = createMemo(() => api.state.session.count() === 0)
        const connected = createMemo(() =>
          api.state.provider.some(
            (item) => item.id !== "opencode" || Object.values(item.models).some((model) => model.cost?.input !== 0),
          ),
        )
        const show = createMemo(() => (!first() || !connected()) && !hidden())
        return <View api={api} hidden={hidden()} show={show()} connected={connected()} />
      },
    },
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
