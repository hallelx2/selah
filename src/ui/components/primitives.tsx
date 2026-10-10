import { RGBA, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { mixColor } from "../motion"
import type { IconName } from "../icons"
import { useApp } from "../state"

const EMPTY = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

/** opencode's signature edge: a single heavy bar on the left, no other border. */
export const LeftBar = { border: ["left" as const], customBorderChars: { ...EMPTY, vertical: "┃" } }

export const ROUNDED = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  topT: "┬",
  bottomT: "┴",
  leftT: "├",
  rightT: "┤",
  cross: "┼",
}

export const TRANSPARENT = RGBA.fromInts(0, 0, 0, 0)

/** A smooth horizontal bar using eighth blocks, so small fractions are still visible. */
export function Bar(props: { fraction: number; width: number; color?: RGBA; track?: RGBA }) {
  const { theme } = useApp()
  const cells = () => {
    const f = Math.max(0, Math.min(1, props.fraction))
    const total = f * props.width
    const full = Math.floor(total)
    const part = Math.round((total - full) * 8)
    const partial = part > 0 && full < props.width ? " ▏▎▍▌▋▊▉"[part]! : ""
    const rest = props.width - full - (partial ? 1 : 0)
    return { filled: "█".repeat(full) + partial, rest: "█".repeat(Math.max(0, rest)) }
  }
  return (
    <text wrapMode="none" selectable={false}>
      <span style={{ fg: props.color ?? theme().primary, bg: props.track ?? theme().backgroundElement }}>{cells().filled}</span>
      <span style={{ fg: props.track ?? theme().backgroundElement }}>{cells().rest}</span>
    </text>
  )
}

/** Thin line progress, "━━━━━━────", for compact places like headers. */
export function LineBar(props: { fraction: number; width: number; color?: RGBA }) {
  const { theme } = useApp()
  const n = () => Math.round(Math.max(0, Math.min(1, props.fraction)) * props.width)
  return (
    <text wrapMode="none" selectable={false}>
      <span style={{ fg: props.color ?? theme().primary }}>{"━".repeat(n())}</span>
      <span style={{ fg: theme().borderSubtle }}>{"─".repeat(props.width - n())}</span>
    </text>
  )
}

export interface Hint {
  key: string
  label: string
}

export function Hints(props: { hints: Hint[] }) {
  const { theme } = useApp()
  return (
    <box flexDirection="row" gap={2}>
      <For each={props.hints}>
        {(h) => (
          <text wrapMode="none" selectable={false}>
            <span style={{ fg: theme().text }}>{h.key}</span>
            <span style={{ fg: theme().textMuted }}> {h.label}</span>
          </text>
        )}
      </For>
    </box>
  )
}

/** The bottom band of every screen: a mode chip, context hints, and the reading status. */
export function Footer(props: { mode: string; icon?: IconName; hints: Hint[]; right?: JSX.Element; reserve?: number }) {
  const app = useApp()
  const t = () => app.theme()
  const dims = useTerminalDimensions()
  // Show as many hints as fit beside the chip and the status; never let them collide.
  const chip = () => ` ${props.icon ? app.ip(props.icon) : ""}${props.mode} `
  const fitting = () => {
    let room = dims().width - (chip().length + 2) - (props.reserve ?? 34) - 2
    const out: Hint[] = []
    for (const h of props.hints) {
      const w = h.key.length + h.label.length + 3
      if (w > room) break
      out.push(h)
      room -= w
    }
    return out
  }
  return (
    <box flexDirection="row" height={1} flexShrink={0} backgroundColor={t().backgroundPanel} justifyContent="space-between">
      <box flexDirection="row" gap={2}>
        <text wrapMode="none" selectable={false} bg={t().primary} fg={t().onPrimary} attributes={TextAttributes.BOLD}>
          {chip()}
        </text>
        <Hints hints={fitting()} />
      </box>
      <box flexDirection="row" paddingRight={1} flexShrink={0}>
        <Show when={props.right} fallback={<StreakStatus />}>
          {props.right}
        </Show>
      </box>
    </box>
  )
}

/** "▲ 6  ·  today 1/2 ch  ·  14m": how the reader is doing, always in view. */
export function StreakStatus() {
  const app = useApp()
  const t = () => app.theme()
  const goal = () => app.config.goal
  const doneToday = () => (goal().kind === "chapters" ? app.todayTotals().chapters : Math.floor(app.todayTotals().minutes))
  const met = () => doneToday() >= goal().amount
  // A live streak not yet kept today glows softly: a nudge, never an alarm.
  const nudging = () => app.streak() > 0 && !met() && !app.motion.reduced()
  const [phase, setPhase] = createSignal(0)
  createEffect(() => {
    if (!nudging()) return
    const id = setInterval(() => setPhase((n) => n + 1), 80)
    onCleanup(() => clearInterval(id))
  })
  const streakColor = () => {
    if (app.streak() === 0) return t().textMuted
    if (!nudging()) return t().warning
    return mixColor(t().warning, t().backgroundPanel, 0.25 + 0.25 * Math.sin(phase() / 6))
  }
  return (
    <text wrapMode="none" selectable={false}>
      <span style={{ fg: streakColor() }}>
        {app.i("streak")} {app.streak()}
      </span>
      <span style={{ fg: t().textMuted }}>{app.streak() === 1 ? " day" : " days"}  ·  today </span>
      <span style={{ fg: met() ? t().success : t().text }}>
        {doneToday()}/{goal().amount}
      </span>
      <span style={{ fg: t().textMuted }}>{goal().kind === "chapters" ? " ch" : " min"}</span>
      <Show when={met()}>
        <span style={{ fg: t().success }}> ✓</span>
      </Show>
    </text>
  )
}

export function Rule(props: { color?: RGBA }) {
  const { theme } = useApp()
  return <box height={1} border={["top"]} borderColor={props.color ?? theme().borderSubtle} />
}

/** Pads or truncates to an exact width, for column layouts in monospace. */
export function fit(s: string, width: number, align: "left" | "right" = "left"): string {
  if (s.length > width) return s.slice(0, Math.max(0, width - 1)) + "…"
  return align === "left" ? s.padEnd(width) : s.padStart(width)
}
