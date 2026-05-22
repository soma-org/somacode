import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { useKV } from "@tui/context/kv"
import { map, pipe, filter, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogVariant } from "./dialog-variant"
import type { SupportedModel } from "@opencode-ai/core/util/models-query"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const kv = useKV()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()

  const supported = createMemo<SupportedModel[]>(() => {
    if (!kv.ready) return []
    const list = kv.get("supported_models")
    if (!Array.isArray(list)) return []
    return list.filter(
      (x): x is SupportedModel =>
        x &&
        typeof x === "object" &&
        typeof x.providerID === "string" &&
        typeof x.modelID === "string" &&
        typeof x.name === "string",
    )
  })

  const providerName = (id: string) => sync.data.provider.find((p) => p.id === id)?.name ?? id

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = connected() && !props.providerID && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    // soma model picker is rendered flat — no provider headers at all.
    // The provider routing happens behind the proxy; surfacing per-provider
    // groupings here just leaks irrelevant infra detail to the user.
    const isSomaOnly = supported().every((m) => m.providerID === "soma")

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const entry = supported().find((m) => m.providerID === item.providerID && m.modelID === item.modelID)
        if (!entry) return []
        return [
          {
            key: item,
            value: { providerID: entry.providerID, modelID: entry.modelID },
            title: entry.name,
            description: isSomaOnly ? undefined : providerName(entry.providerID),
            category: isSomaOnly ? undefined : category,
            footer: entry.free ? "Free" : undefined,
            onSelect: () => {
              onSelect(entry.providerID, entry.modelID)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

    const providerOptions = pipe(
      supported(),
      filter((entry) => (props.providerID ? entry.providerID === props.providerID : true)),
      map((entry) => ({
        value: { providerID: entry.providerID, modelID: entry.modelID },
        title: entry.name,
        description: favorites.some((item) => item.providerID === entry.providerID && item.modelID === entry.modelID)
          ? "(Favorite)"
          : undefined,
        category: isSomaOnly ? undefined : providerName(entry.providerID),
        footer: entry.free ? "Free" : undefined,
        onSelect() {
          onSelect(entry.providerID, entry.modelID)
        },
      })),
      filter((x) => {
        if (!showSections) return true
        if (favorites.some((item) => item.providerID === x.value.providerID && item.modelID === x.value.modelID))
          return false
        if (recents.some((item) => item.providerID === x.value.providerID && item.modelID === x.value.modelID))
          return false
        return true
      }),
      sortBy(
        (x) => x.footer !== "Free",
        (x) => x.category ?? "",
        (x) => x.title,
      ),
    )

    if (needle) {
      return fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj)
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions]
  })

  const title = createMemo(() => (props.providerID ? providerName(props.providerID) : "Select model"))

  function onSelect(providerID: string, modelID: string) {
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.selected()
    if (cur === "default" || (cur && list.includes(cur))) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      actions={[
        {
          command: "model.dialog.favorite",
          title: "Favorite",
          disabled: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}
