import { TextAttributes, type RGBA } from "@opentui/core"
import { For } from "solid-js"
import { useApp } from "../state"

/**
 * KJV marks the words its translators supplied in [brackets]; printed Bibles set them in
 * italics, and so does Selah. Search hits arrive wrapped in \u0001 … \u0002.
 */
export function segments(text: string): { text: string; italic: boolean; match: boolean }[] {
  const out: { text: string; italic: boolean; match: boolean }[] = []
  let italic = false
  let match = false
  let buf = ""
  const flush = () => {
    if (buf) out.push({ text: buf, italic, match })
    buf = ""
  }
  for (const ch of text) {
    if (ch === "[" || ch === "]" || ch === "\u0001" || ch === "\u0002") {
      flush()
      if (ch === "[") italic = true
      else if (ch === "]") italic = false
      else match = ch === "\u0001"
      continue
    }
    buf += ch
  }
  flush()
  return out
}

export function VerseText(props: { text: string; fg?: RGBA; matchColor?: RGBA }) {
  const app = useApp()
  const t = () => app.theme()
  return (
    <For each={segments(props.text)}>
      {(seg) => (
        <span
          style={{
            fg: seg.match ? (props.matchColor ?? t().primary) : seg.italic ? t().textMuted : (props.fg ?? t().text),
            attributes: (seg.italic ? TextAttributes.ITALIC : 0) | (seg.match ? TextAttributes.BOLD : 0),
          }}
        >
          {seg.text}
        </span>
      )}
    </For>
  )
}

export const plain = (text: string) => text.replace(/[[\]\u0001\u0002]/g, "")
