import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { paths } from "./paths"
import { DEFAULT_GOAL, type Goal } from "./stats"

/** Preferences, kept in $XDG_CONFIG_HOME/selah/config.json so they can be edited by hand. */
export interface Config {
  theme: string
  mode: "auto" | "dark" | "light"
  translation: string
  /** Second translation for the side-by-side view. */
  parallel: string
  goal: Goal
  sidebar: boolean
  /** Show verse numbers in the reading column. */
  verseNumbers: boolean
  /** Maximum width of the reading column. */
  measure: number
  /** "reduced" turns every animation into its final frame. */
  motion: "full" | "reduced"
  /** Unset until the reader has said whether Nerd Font glyphs render. */
  icons?: "nerd" | "unicode" | "none"
  /** Flowing paragraphs with superscript verse numbers, instead of one verse per line. */
  prose: boolean
  /** Width of the study pane in columns. */
  studyWidth: number
  /** Which local agent answers in the Ask tab: the first one found, or a specific one. */
  agent: "auto" | "claude" | "codex"
  /**
   * How Hebrew is drawn. "visual" reverses each word for terminals that lay text out left to
   * right (nearly all); "logical" leaves it to a terminal that applies bidi itself.
   */
  hebrew: "visual" | "logical"
}

export const DEFAULT_CONFIG: Config = {
  theme: "opencode",
  mode: "auto",
  translation: "KJV",
  parallel: "BSB",
  goal: DEFAULT_GOAL,
  sidebar: false,
  verseNumbers: true,
  measure: 76,
  motion: "full",
  prose: false,
  studyWidth: 60,
  agent: "auto",
  hebrew: "visual",
}

export function loadConfig(file = paths.configFile): Config {
  if (!existsSync(file)) return { ...DEFAULT_CONFIG }
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Config>
    return { ...DEFAULT_CONFIG, ...raw, goal: { ...DEFAULT_CONFIG.goal, ...raw.goal } }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(config: Config, file = paths.configFile) {
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n")
}
