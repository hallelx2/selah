import { RGBA, TextAttributes, type InputRenderable, type KeyEvent, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from "solid-js"
import { ease, mixColor } from "../motion"
import { fuzzyFilter, type FuzzyMatch } from "../../data/fuzzy"
import { useApp } from "../state"
import { Hints, TRANSPARENT, type Hint } from "./primitives"

export const WIDTHS = { medium: 60, large: 88, xlarge: 116 }

/** The modal layer: dims everything behind it and centres the panel a quarter of the way down. */
export function DialogLayer() {
  const app = useApp()
  const dims = useTerminalDimensions()
  // Opening: the backdrop dims in and the panel rises two rows into place. Input is never
  // gated on this; keys reach the dialog from the first frame.
  const [opening, setOpening] = createSignal(app.motion.start(0))
  createEffect(on(() => app.dialogs.length > 0, (open) => open && setOpening(app.motion.start(170))))
  const p = () => app.motion.progress(opening(), ease.outCubic)
  return (
    <Show when={app.dialogs.length > 0}>
      <box
        position="absolute"
        left={0}
        top={0}
        width={dims().width}
        height={dims().height}
        zIndex={3000}
        alignItems="center"
        paddingTop={Math.max(1, Math.floor(dims().height / 6)) + Math.round((1 - p()) * 2)}
        backgroundColor={RGBA.fromInts(0, 0, 0, Math.round(150 * p()))}
        onMouseUp={() => app.closeDialog()}
      >
        <box
          width={WIDTHS[app.dialogs.at(-1)!.size]}
          maxWidth={dims().width - 2}
          maxHeight={dims().height - 4}
          backgroundColor={app.theme().backgroundPanel}
          paddingTop={1}
          paddingBottom={1}
          onMouseUp={(e: { stopPropagation(): void }) => e.stopPropagation()}
        >
          {app.dialogs.at(-1)!.element()}
        </box>
      </box>
    </Show>
  )
}

export function DialogHeader(props: { title: string; right?: string }) {
  const app = useApp()
  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={4} paddingRight={4} flexShrink={0}>
      <text fg={app.theme().text} attributes={TextAttributes.BOLD} wrapMode="none">
        {props.title}
      </text>
      <text fg={app.theme().textMuted} wrapMode="none" onMouseUp={() => app.closeDialog()}>
        {props.right ?? "esc"}
      </text>
    </box>
  )
}

export interface SelectItem<T = unknown> {
  id: string
  title: string
  value: T
  /** Muted text after the title. */
  description?: string
  /** Right-aligned muted text, such as a key binding or a count. */
  hint?: string
  category?: string
  /** Text matched by the filter when it should differ from the title. */
  search?: string
  /** Marks the current choice with a ● in the gutter. */
  current?: boolean
  disabled?: boolean
}

export interface SelectDialogProps<T> {
  title: string
  placeholder?: string
  items: SelectItem<T>[] | ((filter: string) => SelectItem<T>[])
  /** Items are already filtered by the `items` function. */
  customFilter?: boolean
  onSelect: (item: SelectItem<T>, filter: string) => void
  onMove?: (item: SelectItem<T> | undefined) => void
  onKey?: (key: KeyEvent, item: SelectItem<T> | undefined) => boolean
  footer?: Hint[]
  empty?: string
  initial?: string
  /** Max list rows. */
  rows?: number
  header?: JSX.Element
}

/** opencode's select dialog: a filter input, grouped rows, the selected row filled with primary. */
export function SelectDialog<T>(props: SelectDialogProps<T>) {
  const app = useApp()
  const t = () => app.theme()
  const dims = useTerminalDimensions()
  const [filter, setFilter] = createSignal("")
  const [index, setIndex] = createSignal(0)
  let input: InputRenderable | undefined
  let scroll: ScrollBoxRenderable | undefined

  const rows = createMemo(() => {
    const f = filter()
    const all = typeof props.items === "function" ? props.items(f) : props.items
    if (props.customFilter || !f.trim()) return all.map((item) => ({ item, match: undefined as FuzzyMatch | undefined }))
    return fuzzyFilter(f, all, (i) => i.search ?? `${i.title} ${i.description ?? ""} ${i.category ?? ""}`)
  })

  // Group by category only while unfiltered; filtered results are ranked, not grouped.
  const grouped = createMemo(() => {
    const out: { category?: string; rows: { item: SelectItem<T>; flat: number }[] }[] = []
    rows().forEach((r, flat) => {
      const category = filter().trim() ? undefined : r.item.category
      const last = out.at(-1)
      if (last && last.category === category) last.rows.push({ item: r.item, flat })
      else out.push({ category, rows: [{ item: r.item, flat }] })
    })
    return out
  })

  const selected = () => rows()[index()]?.item

  createEffect(() => {
    rows()
    const initial = props.initial
    const i = initial ? rows().findIndex((r) => r.item.id === initial) : -1
    setIndex(i >= 0 && !filter() ? i : 0)
  })

  createEffect(() => {
    const item = selected()
    props.onMove?.(item)
    if (item && scroll) scroll.scrollChildIntoView(`opt-${item.id}`)
  })

  const move = (delta: number) => {
    const n = rows().length
    if (!n) return
    setIndex((i) => (i + delta + n) % n)
  }

  app.useKeys(
    (key) => {
      if (props.onKey?.(key, selected())) return true
      if (key.name === "escape") {
        app.closeDialog()
        return true
      }
      if (key.name === "up" || (key.ctrl && key.name === "p") || (key.ctrl && key.name === "k")) return move(-1), true
      if (key.name === "down" || (key.ctrl && key.name === "n") || (key.ctrl && key.name === "j")) return move(1), true
      if (key.name === "pageup") return move(-8), true
      if (key.name === "pagedown") return move(8), true
      if (key.name === "return") {
        const item = selected()
        if (item && !item.disabled) props.onSelect(item, filter())
        return true
      }
      return false
    },
    { modal: true },
  )

  const height = () => Math.min(props.rows ?? 14, Math.max(4, dims().height - 14))

  return (
    <box flexDirection="column" gap={1}>
      <box paddingLeft={4} paddingRight={4} flexShrink={0}>
        <DialogHeader title={props.title} />
        {props.header}
        <box paddingTop={1}>
          <input
            ref={(r: InputRenderable) => {
              input = r
              setTimeout(() => !r.isDestroyed && r.focus(), 1)
            }}
            placeholder={props.placeholder ?? "Search"}
            placeholderColor={t().textMuted}
            textColor={t().text}
            focusedTextColor={t().text}
            backgroundColor={t().backgroundPanel}
            focusedBackgroundColor={t().backgroundPanel}
            cursorColor={t().primary}
            onInput={(v: string) => setFilter(v)}
          />
        </box>
      </box>
      <Show
        when={rows().length > 0}
        fallback={
          <box paddingLeft={4} paddingRight={4}>
            <text fg={t().textMuted}>{props.empty ?? "No results"}</text>
          </box>
        }
      >
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (scroll = r)}
          height={Math.min(height(), rows().length + grouped().filter((g) => g.category).length * 2)}
          paddingLeft={1}
          paddingRight={1}
          scrollbarOptions={{ visible: false }}
        >
          <For each={grouped()}>
            {(group, gi) => (
              <>
                <Show when={group.category}>
                  <box paddingLeft={3} paddingTop={gi() > 0 ? 1 : 0}>
                    <text fg={t().accent} attributes={TextAttributes.BOLD} wrapMode="none">
                      {group.category}
                    </text>
                  </box>
                </Show>
                <For each={group.rows}>
                  {(row) => {
                    const active = () => row.flat === index()
                    return (
                      <box
                        id={`opt-${row.item.id}`}
                        flexDirection="row"
                        justifyContent="space-between"
                        paddingLeft={row.item.current ? 1 : 3}
                        paddingRight={3}
                        backgroundColor={active() ? t().primary : TRANSPARENT}
                        onMouseOver={() => setIndex(row.flat)}
                        onMouseUp={() => !row.item.disabled && props.onSelect(row.item, filter())}
                      >
                        <box flexDirection="row" flexShrink={1}>
                          <Show when={row.item.current}>
                            <text fg={active() ? t().onPrimary : t().primary} wrapMode="none">
                              {"● "}
                            </text>
                          </Show>
                          <text
                            wrapMode="none"
                            fg={row.item.disabled ? t().textMuted : active() ? t().onPrimary : t().text}
                            attributes={active() ? TextAttributes.BOLD : undefined}
                          >
                            {row.item.title}
                          </text>
                          <Show when={row.item.description}>
                            <text wrapMode="none" fg={active() ? t().onPrimary : t().textMuted}>
                              {` ${row.item.description}`}
                            </text>
                          </Show>
                        </box>
                        <Show when={row.item.hint}>
                          <text wrapMode="none" fg={active() ? t().onPrimary : t().textMuted} flexShrink={0}>
                            {` ${row.item.hint}`}
                          </text>
                        </Show>
                      </box>
                    )
                  }}
                </For>
              </>
            )}
          </For>
        </scrollbox>
      </Show>
      <Show when={props.footer?.length}>
        <box paddingLeft={4} paddingRight={4} flexShrink={0}>
          <Hints hints={props.footer!} />
        </box>
      </Show>
    </box>
  )
  void input
}

export function ToastLayer() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const color = (tone: string) => {
    const t = app.theme()
    return tone === "success" ? t.success : tone === "warning" ? t.warning : tone === "error" ? t.error : t.primary
  }
  return (
    <box position="absolute" right={2} top={2} zIndex={4000} flexDirection="column" gap={1} width={Math.min(52, dims().width - 4)}>
      <For each={app.toasts()}>
        {(toast) => {
          const enter = () => app.motion.progress(toast.enter, ease.outCubic)
          const leave = () => (toast.leave ? app.motion.progress(toast.leave, ease.inOutSine) : 0)
          const shift = () => Math.round((1 - enter()) * 28 + leave() * 28)
          const page = () => app.theme().backgroundElement
          const f = (c: RGBA) => mixColor(page(), c, enter() * (1 - leave()))
          return (
          <box
            position="relative"
            left={shift()}
            border={["left"]}
            customBorderChars={{ topLeft: "", bottomLeft: "", vertical: "┃", topRight: "", bottomRight: "", horizontal: " ", bottomT: "", topT: "", cross: "", leftT: "", rightT: "" }}
            borderColor={f(color(toast.tone))}
            backgroundColor={app.theme().backgroundElement}
            paddingLeft={2}
            paddingRight={2}
          >
            <text fg={f(app.theme().text)} attributes={TextAttributes.BOLD}>
              {toast.message}
            </text>
            <Show when={toast.detail}>
              <text fg={f(app.theme().textMuted)}>{toast.detail}</text>
            </Show>
          </box>
          )
        }}
      </For>
    </box>
  )
}
