// M5 "Rice and motion" acceptance tests (HAL-2567 to HAL-2572). Animations run on the
// harness's manual clock, so every intermediate frame here is deterministic.
import { afterEach, describe, expect, test } from "bun:test"
import { addDays } from "../src/data/dates"
import { UserStore } from "../src/data/user"
import { harness, type Harness } from "./harness"

let h: Harness | undefined
afterEach(() => {
  h?.destroy()
  h = undefined
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Lets the motion ticker (16ms timers) run, then renders. */
async function tick(hh: Harness, ms = 40) {
  await wait(ms)
  await hh.settle()
}

const lineOf = (hh: Harness, needle: string) => {
  const frame = hh.spans()
  return frame.lines.find((l) => l.spans.map((s) => s.text).join("").includes(needle))
}
const colorsOf = (line: ReturnType<typeof lineOf>) => line?.spans.filter((s) => s.text.trim()).map((s) => `${s.fg.r.toFixed(3)},${s.fg.g.toFixed(3)},${s.fg.b.toFixed(3)}`)

describe("home logo", () => {
  test("a beam of light crosses the logo, then it rests exactly as before", async () => {
    h = await harness({ config: { motion: "full" } })
    await tick(h, 60)
    const rest = colorsOf(lineOf(h, "█▀▀█ █  █"))
    await wait(750) // the first beam starts 700ms after mount
    h.advance(700) // halfway across
    await tick(h)
    const mid = colorsOf(lineOf(h, "█▀▀█ █  █"))
    expect(mid).not.toEqual(rest)
    h.advance(5_000)
    await tick(h)
    expect(colorsOf(lineOf(h, "█▀▀█ █  █"))).toEqual(rest)
  })

  test("under reduced motion the logo never changes", async () => {
    h = await harness({ config: { motion: "reduced" } })
    const rest = colorsOf(lineOf(h, "█▀▀█ █  █"))
    await wait(800)
    h.advance(700)
    await tick(h)
    expect(colorsOf(lineOf(h, "█▀▀█ █  █"))).toEqual(rest)
  })
})

describe("reader", () => {
  test("drop cap, book name and chapter length open the chapter", async () => {
    h = await harness({ initial: { route: "reader", book: 43, chapter: 3, verse: 1 } })
    const f = h.frame()
    expect(f).toContain("██████╗") // the block-font "3"
    expect(f).toContain("J O H N")
    expect(f).toContain("36 verses")
  })

  test("prose mode flows verses with superscript numbers, and j still moves by verse", async () => {
    h = await harness({ width: 130, initial: { route: "reader", book: 43, chapter: 3, verse: 16 } })
    await h.press("w")
    // Switching layout scrolls to the cursor once the new layout exists (a few frames).
    await tick(h, 250)
    expect(h.frame()).toContain("¹⁶For God so loved the world")
    expect(h.frame()).toContain("PROSE")
    expect(h.config().prose).toBe(true)
    await h.press("j")
    expect(h.frame()).toContain("verse 17/36")
    await h.press("w")
    expect(h.frame()).toMatch(/16\s+For God so loved/)
  })

  test("poetry keeps one verse per line in prose mode", async () => {
    h = await harness({ config: { prose: true }, initial: { route: "reader", book: 19, chapter: 23 } })
    const lines = h.frame().split("\n")
    expect(lines.some((l) => /^\s+¹A Psalm of David/.test(l))).toBe(true)
    expect(lines.some((l) => /^\s+²He maketh me/.test(l))).toBe(true)
  })

  test("focus mode hides the chrome; z or esc brings it back", async () => {
    h = await harness({ initial: { route: "reader", book: 43, chapter: 3, verse: 16 } })
    await h.press("z")
    expect(h.frame()).not.toContain("John 3 · KJV")
    expect(h.frame()).not.toContain("READ")
    expect(h.frame()).toContain("focus · z to return")
    expect(h.frame()).toContain("For God so loved the world")
    await h.press("escape")
    expect(h.frame()).toContain("John 3 · KJV")
    await h.press("z")
    await h.press("z")
    expect(h.frame()).toContain("John 3 · KJV")
  })

  test("the reading meter fills with real time and is complete exactly when the read is recorded", async () => {
    h = await harness({ initial: { route: "reader", book: 19, chapter: 1 } })
    const meter = () => h!.frame().split("\n")[1]!
    expect(meter()).toMatch(/^─+$/)
    await h.press("G", { shift: true })
    for (let i = 0; i < 4; i++) {
      h.advance(2_000)
      await h.press("k")
    }
    await wait(1_100) // the header refreshes each second
    await h.settle()
    expect(meter()).toMatch(/━/)
    expect(meter()).toMatch(/─/)
    expect(h.store.chapterReads()).toHaveLength(0)
    for (let i = 0; i < 4; i++) {
      h.advance(3_000)
      await h.press("j")
    }
    await h.press("G", { shift: true })
    expect(h.store.chapterReads()).toHaveLength(1)
    expect(meter()).toMatch(/^━+$/)
  })
})

describe("milestones", () => {
  function storeWithStreak(days: number) {
    const store = UserStore.memory()
    for (let i = 1; i <= days; i++) {
      store.recordRead({ book: 40, chapter: i, day: addDays("2026-10-08", -i), readAt: 0, source: "manual" })
    }
    return store
  }

  test("crossing 3 days celebrates once, and only once", async () => {
    h = await harness({ store: storeWithStreak(2), initial: { route: "reader", book: 1, chapter: 1 } })
    await h.press("m")
    expect(h.frame()).toContain("3 day streak")
    expect(h.store.get<number[]>("milestones", [])).toEqual([3])
    await h.press("n")
    await h.press("m")
    expect(h.store.get<number[]>("milestones", [])).toEqual([3])
  })

  test("a long streak marks the lower milestones as seen, so they never replay", async () => {
    h = await harness({ store: storeWithStreak(15), initial: { route: "reader", book: 1, chapter: 1 } })
    await h.press("m")
    expect(h.store.get<number[]>("milestones", [])).toEqual([3, 7, 14])
  })

  test("with motion, rings of light and the streak card play over the app, then clear", async () => {
    h = await harness({ config: { motion: "full" }, store: storeWithStreak(6), initial: { route: "reader", book: 1, chapter: 1 } })
    await h.press("m")
    h.advance(800)
    await tick(h)
    expect(h.frame()).toContain("7 day streak")
    expect(h.frame()).toContain("faithful in little, faithful in much")
    h.advance(3_000)
    await tick(h)
    expect(h.frame()).not.toContain("faithful in little")
  })
})

describe("progress intro", () => {
  test("numbers count up and settle on the exact values", async () => {
    const store = UserStore.memory()
    for (let i = 0; i < 12; i++) store.recordRead({ book: 40, chapter: i + 1, day: addDays("2026-10-08", -i), readAt: 0, source: "manual" })
    h = await harness({ config: { motion: "full" }, store, width: 130, height: 50, initial: { route: "progress" } })
    // The stat values row: current streak, then longest streak.
    const streakCard = () => h!.frame().split("\n").find((l) => /^\s+\d+ days\s+\d+ days/.test(l))
    expect(streakCard()).toMatch(/^\s+0 days\s+0 days/) // the count starts from zero
    h.advance(1_500)
    await tick(h)
    expect(streakCard()).toMatch(/12 days\s+12 days/)
  })
})

describe("dialog and toast motion", () => {
  test("keys typed while the palette is still opening reach it", async () => {
    h = await harness({ config: { motion: "full" }, initial: { route: "reader", book: 43, chapter: 3 } })
    await h.press("p", { ctrl: true })
    await h.type("prog") // no clock advance: the open animation has not run at all
    expect(h.frame()).toContain("Progress and streaks")
  })
})

describe("icons", () => {
  test("first launch asks once whether Nerd Font glyphs render", async () => {
    h = await harness({ config: { icons: undefined } })
    await tick(h, 80)
    expect(h.frame()).toContain("One question")
    await h.type("simple")
    await h.press("return")
    expect(h.config().icons).toBe("unicode")
    expect(h.frame()).not.toContain("One question")
  })

  test("nerd icons appear in the reader chrome", async () => {
    h = await harness({ config: { icons: "nerd" }, initial: { route: "reader", book: 43, chapter: 3 } })
    expect(h.frame()).toContain(" John 3 · KJV")
  })
})

describe("edge to edge", () => {
  test("the terminal's own background (and so its padding) follows the theme", async () => {
    h = await harness()
    expect(h.painted.at(-1)).toBe("#0a0a0a") // opencode dark
    await h.press("p", { ctrl: true })
    await h.type("theme")
    await h.press("return")
    await h.type("tokyonight")
    await h.press("return")
    expect(h.config().theme).toBe("tokyonight")
    expect(h.painted.at(-1)).toBe("#1a1b26")
  })
})
