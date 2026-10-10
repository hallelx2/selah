import { SyntaxStyle } from "@opentui/core"
import { createMemo, onCleanup } from "solid-js"
import type { Theme } from "../../theme"
import { useApp } from "../state"

/** The markdown scopes OpenTUI's renderer emits, styled from the theme's markdown colours. */
export function markdownStyle(theme: Theme): SyntaxStyle {
  const m = theme.markdown
  return SyntaxStyle.fromTheme([
    { scope: ["default"], style: { foreground: m.text } },
    { scope: ["markup.heading"], style: { foreground: m.heading, bold: true } },
    { scope: ["markup.strong"], style: { foreground: m.strong, bold: true } },
    { scope: ["markup.italic"], style: { foreground: m.emph, italic: true } },
    { scope: ["markup.strikethrough"], style: { foreground: theme.textMuted, dim: true } },
    { scope: ["markup.list"], style: { foreground: m.listItem } },
    { scope: ["markup.quote"], style: { foreground: m.quote, italic: true } },
    { scope: ["markup.raw"], style: { foreground: m.code } },
    { scope: ["markup.link", "markup.link.url"], style: { foreground: m.link, underline: true } },
    { scope: ["markup.link.label"], style: { foreground: m.linkText } },
  ])
}

/** Markdown in the theme's colours, through OpenTUI's own markdown renderable. */
export function Markdown(props: { content: string }) {
  const app = useApp()
  const style = createMemo<SyntaxStyle>((prev) => {
    // freed a tick later, once the renderable holds the new one
    if (prev) setTimeout(() => prev.destroy(), 0)
    return markdownStyle(app.theme())
  })
  onCleanup(() => style().destroy())
  return <markdown content={props.content} syntaxStyle={style()} fg={app.theme().markdown.text} conceal />
}
