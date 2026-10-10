import { RGBA, type TerminalColors } from "@opentui/core"
import { BUILTIN_THEMES } from "./builtin"

/** The tokens every Selah surface draws from. Names follow opencode's theme format. */
export const BASE_TOKENS = [
  "primary",
  "secondary",
  "accent",
  "error",
  "warning",
  "success",
  "info",
  "text",
  "textMuted",
  "background",
  "backgroundPanel",
  "backgroundElement",
  "border",
  "borderActive",
  "borderSubtle",
] as const

export type BaseToken = (typeof BASE_TOKENS)[number]

/** opencode's markdown tokens, each with the base token it falls back to in a theme without it. */
export const MARKDOWN_TOKENS = {
  text: ["markdownText", "text"],
  heading: ["markdownHeading", "primary"],
  link: ["markdownLink", "info"],
  linkText: ["markdownLinkText", "accent"],
  code: ["markdownCode", "success"],
  quote: ["markdownBlockQuote", "textMuted"],
  emph: ["markdownEmph", "warning"],
  strong: ["markdownStrong", "text"],
  listItem: ["markdownListItem", "accent"],
} as const satisfies Record<string, readonly [string, BaseToken]>
export type MarkdownToken = keyof typeof MARKDOWN_TOKENS

export interface Theme extends Record<BaseToken, RGBA> {
  /** Verse highlight backgrounds, colours 1 to 4. */
  highlight: [RGBA, RGBA, RGBA, RGBA]
  /** Heatmap cells, level 0 (nothing read) to 4. */
  heat: [RGBA, RGBA, RGBA, RGBA, RGBA]
  /** Foreground for text drawn on a `primary` fill. */
  onPrimary: RGBA
  /** The dimmed backdrop behind dialogs. */
  backdrop: RGBA
  /** The colour behind the reading column. */
  page: RGBA
  /** opencode's markdown colours, for notes rendered as Markdown. */
  markdown: Record<MarkdownToken, RGBA>
  name: string
  mode: "dark" | "light"
}

type ColorValue = string | number | { dark: ColorValue; light: ColorValue }
export interface ThemeJson {
  defs?: Record<string, ColorValue>
  theme: Record<string, ColorValue>
}

export function isThemeJson(value: unknown): value is ThemeJson {
  if (!value || typeof value !== "object") return false
  const theme = (value as { theme?: unknown }).theme
  if (!theme || typeof theme !== "object") return false
  return BASE_TOKENS.every((t) => t in (theme as object))
}

const ANSI = [
  "#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
  "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
]

function ansi(n: number): RGBA {
  if (n < 16) return RGBA.fromHex(ANSI[n]!)
  if (n < 232) {
    const i = n - 16
    const v = (x: number) => (x === 0 ? 0 : 55 + x * 40)
    return RGBA.fromInts(v(Math.floor(i / 36)), v(Math.floor(i / 6) % 6), v(i % 6))
  }
  const g = 8 + (n - 232) * 10
  return RGBA.fromInts(g, g, g)
}

export function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  const mix = (a: number, b: number) => Math.round((a + (b - a) * alpha) * 255)
  return RGBA.fromInts(mix(base.r, overlay.r), mix(base.g, overlay.g), mix(base.b, overlay.b))
}

const luminance = (c: RGBA) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b

export function resolveTheme(name: string, json: ThemeJson, mode: "dark" | "light"): Theme {
  const defs = json.defs ?? {}
  const resolve = (value: ColorValue, chain: string[] = []): RGBA => {
    if (typeof value === "number") return ansi(value)
    if (typeof value === "object") return resolve(value[mode], chain)
    if (value === "none" || value === "transparent") return RGBA.fromInts(0, 0, 0, 0)
    if (value.startsWith("#")) return RGBA.fromHex(value)
    if (chain.includes(value)) throw new Error(`Theme ${name}: circular colour reference ${[...chain, value].join(" → ")}`)
    const next = defs[value] ?? json.theme[value]
    if (next === undefined) throw new Error(`Theme ${name}: colour "${value}" is not defined`)
    return resolve(next, [...chain, value])
  }
  const base = Object.fromEntries(BASE_TOKENS.map((t) => [t, resolve(json.theme[t]!)])) as Record<BaseToken, RGBA>
  // A transparent background means "use the terminal's own"; tints need a real colour to mix with.
  const solid = base.background.a === 0 ? (mode === "dark" ? RGBA.fromHex("#000000") : RGBA.fromHex("#ffffff")) : base.background
  const hl = (c: RGBA) => tint(solid, c, mode === "dark" ? 0.28 : 0.22)
  return {
    ...base,
    name,
    mode,
    highlight: [hl(base.warning), hl(base.success), hl(base.info), hl(base.accent)],
    heat: [
      tint(solid, base.textMuted, 0.14),
      tint(solid, base.success, 0.3),
      tint(solid, base.success, 0.55),
      tint(solid, base.success, 0.8),
      base.success,
    ],
    onPrimary: luminance(base.primary) > 0.55 ? tint(solid, RGBA.fromHex("#000000"), 0.6) : RGBA.fromHex("#ffffff"),
    backdrop: RGBA.fromInts(0, 0, 0, 150),
    page: base.background,
    markdown: Object.fromEntries(
      Object.entries(MARKDOWN_TOKENS).map(([k, [token, fallback]]) => [k, json.theme[token] !== undefined ? resolve(json.theme[token]!) : base[fallback]]),
    ) as Record<MarkdownToken, RGBA>,
  }
}

/** A theme built from the terminal's own palette, so Selah matches whatever the rice already is. */
export function systemTheme(colors: TerminalColors): ThemeJson {
  const p = colors.palette
  const bg = colors.defaultBackground ?? p[0] ?? "#000000"
  const fg = colors.defaultForeground ?? p[7] ?? "#ffffff"
  const mode = luminance(RGBA.fromHex(bg)) > 0.5 ? "light" : "dark"
  const b = RGBA.fromHex(bg)
  const f = RGBA.fromHex(fg)
  const hex = (c: RGBA) => {
    const h = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0")
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`
  }
  const step = (a: number) => hex(tint(b, f, a))
  const pick = (i: number, fallback: string) => p[i] ?? fallback
  return {
    theme: {
      primary: pick(4, "#5c9cf5"),
      secondary: pick(6, "#56b6c2"),
      accent: pick(5, "#9d7cd8"),
      error: pick(1, "#e06c75"),
      warning: pick(3, "#e5c07b"),
      success: pick(2, "#7fd88f"),
      info: pick(6, "#56b6c2"),
      text: fg,
      textMuted: step(mode === "dark" ? 0.5 : 0.55),
      background: "none",
      backgroundPanel: step(0.05),
      backgroundElement: step(0.1),
      border: step(0.3),
      borderActive: step(0.45),
      borderSubtle: step(0.18),
    },
  }
}

export const THEME_NAMES = Object.keys(BUILTIN_THEMES).sort((a, b) =>
  a === "opencode" ? -1 : b === "opencode" ? 1 : a.localeCompare(b),
)

export function themeJson(name: string): ThemeJson | undefined {
  const t = BUILTIN_THEMES[name]
  return isThemeJson(t) ? t : undefined
}

/** Display names: "catppuccin-macchiato" → "Catppuccin Macchiato". */
export const themeLabel = (name: string) =>
  name === "system" ? "System (terminal palette)" : name.split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ")
