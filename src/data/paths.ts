import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

function xdg(variable: string, fallback: string): string {
  const value = process.env[variable]
  return value && value.startsWith("/") ? value : join(homedir(), fallback)
}

/** SELAH_HOME puts everything in one directory; tests use it to stay out of the real profile. */
function root(kind: "data" | "config" | "cache"): string {
  const home = process.env.SELAH_HOME
  if (home) return join(home, kind)
  if (kind === "data") return join(xdg("XDG_DATA_HOME", ".local/share"), "selah")
  if (kind === "config") return join(xdg("XDG_CONFIG_HOME", ".config"), "selah")
  return join(xdg("XDG_CACHE_HOME", ".cache"), "selah")
}

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
