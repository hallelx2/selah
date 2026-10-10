/**
 * Every icon Selah draws, by meaning. Nerd Font glyphs are Font Awesome 4 codepoints, the
 * most stable range across Nerd Font versions (each one checked present in JetBrainsMono
 * Nerd Font with fc-list on 2026-10-10). Fallbacks are single-width Unicode so a terminal
 * without a Nerd Font keeps the exact same layout.
 */
export type IconSet = "nerd" | "unicode" | "none"

const TABLE = {
  home: ["", "⌂"],
  book: ["", "▤"],
  bookmark: ["", "◆"],
  note: ["", "✎"],
  highlight: ["", "▌"],
  search: ["", "⌕"],
  streak: ["", "▲"],
  check: ["", "✓"],
  clock: ["", "◷"],
  reading: ["", "○"],
  goal: ["", "◎"],
  plan: ["", "▦"],
  parallel: ["", "‖"],
  translation: ["", "⇄"],
  trophy: ["", "★"],
  quote: ["", "❝"],
  stats: ["", "▥"],
  chart: ["", "▁"],
  focus: ["", "◉"],
  light: ["", "☼"],
  theme: ["", "◐"],
  command: ["", "›"],
  list: ["", "≡"],
  keyboard: ["", "?"],
  copy: ["", "⧉"],
  history: ["", "↺"],
  settings: ["", "≡"],
  bolt: ["", "↯"],
  star: ["", "✦"],
  library: ["\uf0ca", "≡"],
  dot: ["", "●"],
  circle: ["", "○"],
  // fa-language (U+F1AB), checked present with fc-list on 2026-10-10
  language: ["\uf1ab", "α"],
} as const satisfies Record<string, readonly [string, string]>

export type IconName = keyof typeof TABLE

export const ICON_NAMES = Object.keys(TABLE) as IconName[]

export function icon(name: IconName, set: IconSet): string {
  if (set === "none") return ""
  return TABLE[name][set === "nerd" ? 0 : 1]
}

/** An icon followed by a space, or nothing at all when icons are off. */
export function iconPrefix(name: IconName, set: IconSet): string {
  const i = icon(name, set)
  return i ? `${i} ` : ""
}

export const fallbackOf = (name: IconName) => TABLE[name][1]
export const nerdOf = (name: IconName) => TABLE[name][0]
