import { SyntaxStyle } from "@opentui/core"
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

/**
 * One style per theme, kept for the session. OpenTUI's markdown view swaps a new style into its
 * blocks only on its next frame, and a background highlight can still be reading the old one,
 * so freeing a style on a theme change could pull it from under a block mid-highlight. There are
 * at most a few dozen themes, so the styles simply stay.
 */
const styles = new Map<string, SyntaxStyle>()
export function themeMarkdownStyle(theme: Theme): SyntaxStyle {
  // keyed by the colours themselves: the system theme keeps one name across palettes
  const key = [...Object.values(theme.markdown), theme.textMuted].map((c) => `${c.r},${c.g},${c.b}`).join(";")
  let style = styles.get(key)
  if (!style) styles.set(key, (style = markdownStyle(theme)))
  return style
}

/** Markdown in the theme's colours, through OpenTUI's own markdown renderable. */
export function Markdown(props: { content: string }) {
  const app = useApp()
  return <markdown content={props.content} syntaxStyle={themeMarkdownStyle(app.theme())} fg={app.theme().markdown.text} conceal />
}
