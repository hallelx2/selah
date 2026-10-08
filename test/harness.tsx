import { testRender } from "@opentui/solid"
import { App } from "../src/ui/app"
import { DEFAULT_CONFIG, type Config } from "../src/data/config"
import { ReadingTracker } from "../src/data/tracker"
import { UserStore } from "../src/data/user"
import type { Route } from "../src/ui/state"
import { fixtureBible } from "./fixture"
import type { Bible } from "../src/data/bible"

const NAMED: Record<string, string> = {
  return: "RETURN",
  enter: "RETURN",
  escape: "ESCAPE",
  esc: "ESCAPE",
  up: "ARROW_UP",
  down: "ARROW_DOWN",
  left: "ARROW_LEFT",
  right: "ARROW_RIGHT",
  tab: "TAB",
  backspace: "BACKSPACE",
  home: "HOME",
  end: "END",
}

export interface Harness {
  frame: () => string
  press: (key: string, mods?: { ctrl?: boolean; shift?: boolean }) => Promise<void>
  type: (text: string) => Promise<void>
  advance: (ms: number) => void
  settle: () => Promise<void>
  store: UserStore
  config: () => Config
  copied: string[]
  quit: { called: boolean }
  destroy: () => void
  /** Every renderable in the tree, for leak checks. */
  renderables: () => unknown[]
}

export async function harness(opts: {
  width?: number
  height?: number
  initial?: { route: Route; book?: number; chapter?: number; verse?: number }
  start?: Date
  config?: Partial<Config>
  store?: UserStore
  bible?: Bible
} = {}): Promise<Harness> {
  const bible = opts.bible ?? (await fixtureBible())
  const store = opts.store ?? UserStore.memory()
  let now = (opts.start ?? new Date(2026, 9, 8, 7, 0, 0)).getTime()
  const clock = () => now
  const tracker = new ReadingTracker(store, clock)
  let config: Config = { ...DEFAULT_CONFIG, ...opts.config }
  const copied: string[] = []
  const quit = { called: false }
  const t = await testRender(
    () => (
      <App
        deps={{
          bible,
          store,
          tracker,
          config,
          saveConfig: (c) => (config = c),
          now: clock,
          quit: () => (quit.called = true),
          copy: (text) => (copied.push(text), true),
        }}
        initial={opts.initial}
      />
    ),
    { width: opts.width ?? 120, height: opts.height ?? 40 },
  )
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 15))
    await t.renderOnce()
    await new Promise((r) => setTimeout(r, 5))
    await t.renderOnce()
  }
  await settle()
  return {
    frame: () => t.captureCharFrame(),
    press: async (key, mods) => {
      t.mockInput.pressKey((NAMED[key] ?? key) as never, mods)
      await settle()
    },
    type: async (text) => {
      await t.mockInput.typeText(text)
      await settle()
    },
    advance: (ms) => {
      now += ms
    },
    settle,
    store,
    config: () => config,
    copied,
    quit,
    destroy: () => t.renderer.destroy(),
    renderables: () => {
      const out: unknown[] = []
      const walk = (r: { getChildren(): unknown[] }) => {
        for (const c of r.getChildren() as { getChildren(): unknown[] }[]) {
          out.push(c)
          walk(c)
        }
      }
      walk(t.renderer.root as never)
      return out
    },
  }
}
