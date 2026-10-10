import { RGBA, TextAttributes } from "@opentui/core"
import { mixColor } from "../motion"
import { For } from "solid-js"
import { useApp } from "../state"

/**
 * KJV marks the words its translators supplied in [brackets]; printed Bibles set them in
 * italics, and so does Selah. Search hits arrive wrapped in \u0001 … \u0002.
 */
export interface SegmentOptions {
  /** KJV marks supplied words in [brackets] (the default); commentary uses brackets literally. */
  brackets?: boolean
  /** Treat *asterisks* as italics (Henry's Markdown). */
  emphasis?: boolean
}

export function segments(text: string, opts: SegmentOptions = {}): { text: string; italic: boolean; match: boolean }[] {
  const brackets = opts.brackets ?? true
  const out: { text: string; italic: boolean; match: boolean }[] = []
  let italic = false
  let match = false
  let buf = ""
  const flush = () => {
    if (buf) out.push({ text: buf, italic, match })
    buf = ""
  }
  for (const ch of text) {
    const toggle = (brackets && (ch === "[" || ch === "]")) || (opts.emphasis && ch === "*")
    if (toggle || ch === "\u0001" || ch === "\u0002") {
      flush()
      if (ch === "*") italic = !italic
      else if (ch === "[") italic = true
      else if (ch === "]") italic = false
      else match = ch === "\u0001"
      continue
    }
    buf += ch
  }
  flush()
  return out
}

/**
 * `fade` (0..1) draws the text that far from the background toward its own colour: used for
 * chapter fade-ins, the verse of the day reveal, and dimming outside the focused verse.
 */
export function VerseText(props: { text: string; fg?: RGBA; bg?: RGBA; matchColor?: RGBA; fade?: number; segments?: SegmentOptions }) {
  const app = useApp()
  const t = () => app.theme()
  const bg = () => (t().background.a === 0 ? (t().mode === "dark" ? RGBA.fromHex("#000000") : RGBA.fromHex("#ffffff")) : t().background)
  const f = (c: RGBA) => (props.fade === undefined || props.fade >= 1 ? c : mixColor(bg(), c, props.fade))
  return (
    <For each={segments(props.text, props.segments)}>
      {(seg) => (
        <span
          style={{
            fg: f(seg.match ? (props.matchColor ?? t().primary) : seg.italic ? t().textMuted : (props.fg ?? t().text)),
            bg: props.bg,
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
