import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, win32 } from "node:path"

type Env = Record<string, string | undefined>

/**
 * Where each kind of file lives. SELAH_HOME puts everything in one directory (tests use it to
 * stay out of the real profile); an absolute XDG_* variable wins next, on any system. Otherwise
 * Windows keeps settings in %APPDATA% (they roam with the profile) and the texts, notes and
 * caches in %LOCALAPPDATA%, and everything else follows the XDG defaults.
 */
export function resolveRoot(kind: "data" | "config" | "cache", env: Env = process.env, platform = process.platform, home = homedir()): string {
  if (env.SELAH_HOME) return join(env.SELAH_HOME, kind)
  const xdg = env[{ data: "XDG_DATA_HOME", config: "XDG_CONFIG_HOME", cache: "XDG_CACHE_HOME" }[kind]]
  if (xdg && isAbsolute(xdg)) return join(xdg, "selah")
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || win32.join(home, "AppData", "Local")
    const roaming = env.APPDATA || win32.join(home, "AppData", "Roaming")
    return kind === "config" ? win32.join(roaming, "selah") : win32.join(local, "selah", kind)
  }
  return join(home, { data: ".local/share", config: ".config", cache: ".cache" }[kind], "selah")
}

const root = (kind: "data" | "config" | "cache") => resolveRoot(kind)

export const paths = {
  get data() {
    return ensure(root("data"))
  },
  get config() {
    return ensure(root("config"))
  },
  get cache() {
    return ensure(root("cache"))
  },
  get bibleDb() {
    return join(this.data, "bible.db")
  },
  /** Optional study packs (commentary, concordance): large, rebuildable, never personal. */
  get studyDb() {
    return join(this.data, "study.db")
  },
  /** Doré's engravings, downloaded once (`selah install scenes`). */
  get scenes() {
    return join(this.data, "scenes")
  },
  get userDb() {
    return join(this.data, "user.db")
  },
  get configFile() {
    return join(this.config, "config.json")
  },
  /** SELAH_SOURCES lets tests share one download of the source texts. */
  get sources() {
    return ensure(process.env.SELAH_SOURCES ?? join(this.cache, "sources"))
  },
}

function ensure(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}
