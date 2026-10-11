import { parseRef, type Ref } from "./data/ref"

export type CliAction =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "install"; ids: string[] }
  | { kind: "translations" }
  | { kind: "notes-export"; file?: string }
  | { kind: "mcp" }
  | { kind: "stats"; json: boolean }
  | { kind: "search"; query: string }
  | { kind: "print"; ref: Ref }
  | { kind: "tui"; ref?: Ref }
  | { kind: "error"; message: string }

export interface Cli {
  action: CliAction
  /** `-t <id>`, upper-cased. */
  translation?: string
}

/**
 * Turns argv into one action. A reference opens the app in a terminal and prints when stdout
 * is piped or -p is given; `search` always prints, as --help promises.
 */
export function parseCli(argv: string[], opts: { tty: boolean }): Cli {
  const flags = new Set(argv.filter((a) => a.startsWith("-")))
  const tIndex = argv.findIndex((a) => a === "-t" || a === "--translation")
  const translation = tIndex >= 0 ? argv[tIndex + 1]?.toUpperCase() : undefined
  const words = argv.filter((a, i) => !a.startsWith("-") && !(tIndex >= 0 && i === tIndex + 1))
  const command = words[0]?.toLowerCase()
  const done = (action: CliAction): Cli => ({ action, translation })

  if (flags.has("-h") || flags.has("--help")) return done({ kind: "help" })
  if (flags.has("-v") || flags.has("--version")) return done({ kind: "version" })
  if (command === "install") return done({ kind: "install", ids: words.slice(1).map((w) => w.toUpperCase()) })
  if (command === "translations") return done({ kind: "translations" })
  if (command === "mcp") return done({ kind: "mcp" })
  if (command === "notes" && words[1]?.toLowerCase() === "export") return done({ kind: "notes-export", file: words[2] })
  if (command === "stats") return done({ kind: "stats", json: flags.has("--json") })
  if (command === "search") {
    const query = words.slice(1).join(" ").trim()
    return done(query ? { kind: "search", query } : { kind: "tui" })
  }
  if (!words.length) return done({ kind: "tui" })

  const ref = parseRef(words.join(" "))
  if (!ref) return done({ kind: "error", message: `Not a reference: ${words.join(" ")}. Try "john 3:16" or "ps 23".` })
  const print = flags.has("-p") || flags.has("--print") || !opts.tty
  return done(print ? { kind: "print", ref } : { kind: "tui", ref })
}

// --- install: what can be installed, and what to say when it cannot -----------------------------
const PACKS: Record<string, "commentary" | "concordance" | "scenes"> = {
  COMMENTARY: "commentary",
  HENRY: "commentary",
  CONCORDANCE: "concordance",
  STRONGS: "concordance",
  WORDS: "concordance",
  SCENES: "scenes",
  DORE: "scenes",
}
const PACK_NAMES = { commentary: "Matthew Henry's Commentary", concordance: "the Hebrew and Greek", scenes: "Doré's engravings" }

/** What `selah install <id>` means: a study pack, a translation, or nothing Selah knows. */
export function installTarget(id: string, translations: readonly string[]): { pack: "commentary" | "concordance" | "scenes" } | { translation: string } | undefined {
  const up = id.toUpperCase()
  if (PACKS[up]) return { pack: PACKS[up] }
  if (translations.includes(up)) return { translation: up }
  return undefined
}

export function unknownInstall(id: string, translations: readonly string[]): string {
  return [
    `Selah has nothing called "${id.toLowerCase()}" to install. It can install:`,
    `  translations   ${translations.join(", ")}`,
    `  study packs    commentary (Matthew Henry), concordance (the Hebrew and Greek), scenes (Doré's engravings)`,
    `For example: selah install scenes`,
  ].join("\n")
}

/** One plain paragraph for a failed install, with how to try again; never a stack trace. */
export function installFailed(id: string, target: ReturnType<typeof installTarget>, error: unknown): string {
  const what = target && "pack" in target ? PACK_NAMES[target.pack] : target ? `the ${target.translation}` : id
  const message = error instanceof Error ? error.message : String(error)
  const download = error instanceof Error && error.name === "DownloadError"
  // scenes and the concordance keep every file that finished; the others start over, from a cache
  const kept = target && "pack" in target && target.pack !== "commentary" ? " What already downloaded is kept." : ""
  return [
    download ? message : `Could not install ${what}: ${message}`,
    `Run "selah install ${id.toLowerCase()}" again to try again.${kept}`,
  ].join("\n")
}
