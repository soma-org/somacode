import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { shouldStartSomaLocalnet } from "../../../../start-soma-localnet"
import { waitForSomacodeLocalnetReady } from "../../../../soma-embedded-provider"
import { Tips, type EmbeddedLocalnetTip } from "./tips-view"

const id = "internal:home-tips"

function View(props: { show: boolean; connected: boolean }) {
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
  api.command.register(() => [
    {
      title: api.kv.get("tips_hidden", false) ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      hidden: api.route.current.name !== "home",
      onSelect() {
        api.kv.set("tips_hidden", !api.kv.get("tips_hidden", false))
        api.ui.dialog.clear()
      },
    },
  ])

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
        return <View show={show()} connected={connected()} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
