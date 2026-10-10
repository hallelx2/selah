import { RGBA, TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { tint } from "../../theme"
import { useApp } from "../state"

/**
 * Block letters in opencode's logo style: `_` is a shadowed space, `^` a shadowed upper half,
 * `~` a shadow-only upper half. The left half is drawn muted, the right half bold.
 */
const LEFT = ["            ", "█▀▀▀ █▀▀▀ █   ", "^^^█ █^^^ █___", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀"]
const RIGHT = ["         ", "█▀▀█ █  █", "█^^█ █^^█", "▀  ▀ ▀  ▀"]

export function Logo() {
  const app = useApp()
  const line = (s: string, fg: RGBA, bold: boolean) => {
    const shadow = tint(app.theme().background.a === 0 ? RGBA.fromHex("#000000") : app.theme().background, fg, 0.25)
    const attributes = bold ? TextAttributes.BOLD : undefined
    return Array.from(s).map((ch) => {
      if (ch === "_") return <span style={{ fg, bg: shadow, attributes }}> </span>
      if (ch === "^") return <span style={{ fg, bg: shadow, attributes }}>▀</span>
      if (ch === "~") return <span style={{ fg: shadow, attributes }}>▀</span>
      return <span style={{ fg, attributes }}>{ch}</span>
    })
  }
  return (
    <box flexShrink={0}>
      <For each={LEFT}>
        {(l, i) => (
          <box flexDirection="row" gap={1}>
            <text selectable={false} wrapMode="none">
              {line(l.trimEnd().padEnd(14), app.theme().textMuted, false)}
            </text>
            <text selectable={false} wrapMode="none">
              {line(RIGHT[i()]!, app.theme().text, true)}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}
