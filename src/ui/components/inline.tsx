import { TextAttributes, type RGBA } from "@opentui/core"
import { For } from "solid-js"

/** *italic* and **bold** from Henry's Markdown, nothing more. */
export function Inline(props: { text: string; fg: RGBA }) {
  const parts = () => props.text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean)
  return (
    <For each={parts()}>
      {(p) =>
        p.startsWith("**") ? (
          <span style={{ fg: props.fg, attributes: TextAttributes.BOLD }}>{p.slice(2, -2)}</span>
        ) : p.startsWith("*") ? (
          <span style={{ fg: props.fg, attributes: TextAttributes.ITALIC }}>{p.slice(1, -1)}</span>
        ) : (
          <span style={{ fg: props.fg }}>{p}</span>
        )
      }
    </For>
  )
}

