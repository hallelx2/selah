import { afterEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Bible } from "../src/data/bible"
import { openBibleDb } from "../src/data/db"
import { harness, type Harness } from "./harness"
import { seededStore } from "./seed"
import { fixtureBible } from "./fixture"
import { buildPlan, PLANS } from "../src/data/plans"
import { portionLabel } from "../src/ui/routes/home"

let h: Harness | undefined
const afterCleanup: (() => void)[] = []
afterEach(() => {
  h?.destroy()
  h = undefined
  for (const fn of afterCleanup.splice(0)) fn()
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("home", () => {
  test("shows the logo, verse of the day, prompt and today card", async () => {
    h = await harness()
    const f = h.frame()
    expect(f).toContain("█▀▀█ █  █")
    expect(f).toContain("verse of the day")
    expect(f).toContain("Romans 8:38 · KJV") // deterministic for 2026-10-08
    expect(f).toContain("Go to a passage or search")
    expect(f).toContain("Today")
    expect(f).toContain("0/1 ch")
    expect(f).toContain("HOME")
  })

  test("typing a reference and pressing enter opens it", async () => {
    h = await harness()
    await h.type("jn 3:16")
    expect(h.frame()).toContain("press enter to go to John 3:16")
    await h.press("return")
    const f = h.frame()
    expect(f).toContain("John 3 · KJV")
    expect(f).toContain("verse 16/36")
    expect(f).toMatch(/┃\s+16\s+For God so loved the world/)
  })

  test("typing words searches", async () => {
    h = await harness()
    await h.type("living water")
    expect(h.frame()).toContain('press enter to search for "living water"')
    await h.press("return")
    await wait(150)
    await h.settle()
    expect(h.frame()).toContain("Search")
    expect(h.frame()).toMatch(/\d+ verses in KJV/)
  })
})

describe("reader", () => {
  test("renders the chapter with verse numbers and KJV italics stripped of brackets", async () => {
    h = await harness({ initial: { route: "reader", book: 62, chapter: 2, verse: 23 } })
    const f = h.frame()
    expect(f).toContain("1 John 2 · KJV")
    expect(f).toContain("hath not the Father: but he")
    expect(f).not.toContain("[but]")
  })

  test("j/k move the cursor, n/p change chapter, 16 enter jumps", async () => {
    h = await harness({ initial: { route: "reader", book: 43, chapter: 3 } })
    await h.press("j")
    await h.press("j")
    expect(h.frame()).toContain("verse 3/36")
    await h.press("k")
    expect(h.frame()).toContain("verse 2/36")
    await h.press("1")
    await h.press("6")
    await h.press("return")
    expect(h.frame()).toContain("verse 16/36")
    await h.press("n")
    expect(h.frame()).toContain("John 4 · KJV")
    await h.press("p")
    await h.press("p")
    expect(h.frame()).toContain("John 2 · KJV")
  })

  test("bookmark, note marker and copy", async () => {
    h = await harness({ initial: { route: "reader", book: 43, chapter: 11, verse: 35 } })
    await h.press("b")
    expect(h.store.bookmarks()).toEqual([expect.objectContaining({ book: 43, chapter: 11, verse: 35 })])
    expect(h.frame()).toMatch(/35 ◆ Jesus wept\./)
    await h.press("y")
    expect(h.copied[0]).toBe('"Jesus wept." (John 11:35, KJV)')
    await h.press("h")
    expect(h.store.highlightsIn(43, 11).get(35)).toBe(1)
  })

  test("visual selection copies a range", async () => {
    h = await harness({ initial: { route: "reader", book: 19, chapter: 23, verse: 1 } })
    await h.press("v")
    expect(h.frame()).toContain("SELECT")
    await h.press("j")
    await h.press("j")
    await h.press("y")
    expect(h.copied[0]).toStartWith("Psalms 23:1–3 (KJV)\n1 A Psalm of David. The Lord is my shepherd; I shall not want.\n2 He maketh me")
  })

  test("parallel view shows both translations", async () => {
    h = await harness({ width: 160, initial: { route: "reader", book: 43, chapter: 3, verse: 16 } })
    await h.press("T", { shift: true })
    const f = h.frame()
    expect(f).toContain("KJV ⇄ BSB")
    expect(f).toContain("For God so loved the world, that he gave his only begotten Son")
    expect(f).toContain("For God so loved the world that He gave His one and only Son")
  })
})

describe("tracking, end to end", () => {
  test("a skim does not count; reading to the end with real time does, and the streak starts", async () => {
    h = await harness({ initial: { route: "reader", book: 19, chapter: 1 } }) // Psalm 1: short
    await h.press("G", { shift: true }) // straight to the end
    expect(h.frame()).toContain("○ reading")
    expect(h.store.chapterReads()).toHaveLength(0)
    for (let i = 0; i < 10; i++) {
      h.advance(4_000)
      await h.press("k")
    }
    await h.press("G", { shift: true })
    expect(h.store.chapterReads()).toEqual([expect.objectContaining({ book: 19, chapter: 1, day: "2026-10-08", source: "auto" })])
    expect(h.frame()).toContain("● read today")
    expect(h.frame()).toContain("▲ 1 day")
    await h.press("s")
    const f = h.frame()
    expect(f).toContain("Current streak")
    expect(f).toMatch(/1 days?\s/)
  })

  test("m marks and unmarks the chapter", async () => {
    h = await harness({ initial: { route: "reader", book: 1, chapter: 1 } })
    await h.press("m")
    expect(h.store.readOn(1, 1, "2026-10-08")).toBe(true)
    expect(h.frame()).toContain("● read today")
    await h.press("m")
    expect(h.store.readOn(1, 1, "2026-10-08")).toBe(false)
  })
})

describe("progress", () => {
  test("shows streaks, consistency, heatmap, plan and books from recorded history", async () => {
    h = await harness({ store: seededStore(), width: 130, height: 70, initial: { route: "progress" } })
    const f = h.frame()
    expect(f).toContain("Very consistent")
    expect(f).toMatch(/Current streak\s+\S\s+Longest streak/)
    expect(f).toContain("12 days")
    expect(f).toMatch(/Mon ■/)
    expect(f).toContain("New Testament in 90 Days")
    expect(f).toMatch(/\d+ days behind/)
    expect(f).toContain("Old Testament")
  })

  test("the goal dialog changes the goal and the numbers follow", async () => {
    h = await harness({ store: seededStore(), width: 130, height: 60, initial: { route: "progress" } })
    await h.press("e")
    await h.type("3 chapters")
    await h.press("return")
    expect(h.config().goal).toEqual({ kind: "chapters", amount: 3 })
    expect(h.frame()).toContain("goal 3 chapters a day")
  })
})

describe("dialogs", () => {
  test("palette: fuzzy commands and go-to-reference", async () => {
    h = await harness({ initial: { route: "reader", book: 43, chapter: 3 } })
    await h.press("p", { ctrl: true })
    expect(h.frame()).toContain("Commands")
    await h.type("prog")
    expect(h.frame()).toContain("Progress and streaks")
    await h.press("escape")
    await h.press("p", { ctrl: true })
    await h.type("rom 8:28")
    await h.press("return")
    expect(h.frame()).toContain("Romans 8 · KJV")
    expect(h.frame()).toContain("verse 28/39")
  })

  test("theme picker previews while moving and applies on enter", async () => {
    h = await harness()
    await h.press("p", { ctrl: true })
    await h.type("theme")
    await h.press("return")
    expect(h.frame()).toContain("Catppuccin")
    await h.type("tokyo")
    await h.press("return")
    expect(h.config().theme).toBe("tokyonight")
  })

  test("plan picker starts a plan and home shows today's portion", async () => {
    h = await harness()
    await h.press("o", { ctrl: true })
    await h.type("gospels")
    await h.press("return")
    expect(h.store.get<{ id: string } | undefined>("plan", undefined)?.id).toBe("gospels-30")
    expect(h.frame()).toMatch(/The Gospels in 30 Days · day 1/)
    const words = (await fixtureBible()).chapterWords("KJV")
    const plan = buildPlan(PLANS.find((p) => p.id === "gospels-30")!, words)
    expect(h.frame()).toContain(portionLabel(plan.days[0]!))
  })

  test("book picker: book then chapter grid", async () => {
    h = await harness({ initial: { route: "reader", book: 43, chapter: 3 } })
    await h.press("o")
    await h.type("psalm")
    await h.press("return")
    expect(h.frame()).toContain("0/150 read")
    await h.press("down")
    await h.press("down")
    await h.press("right")
    await h.press("return")
    expect(h.frame()).toContain("Psalms 22 · KJV")
  })

  test("help lists the keys", async () => {
    h = await harness({ initial: { route: "reader", book: 43, chapter: 3 } })
    await h.press("?", { shift: true })
    expect(h.frame()).toContain("Keyboard")
    expect(h.frame()).toContain("mark chapter read")
  })
})

describe("first run", () => {
  test("setup imports the library, then thresholds use real word counts", async () => {
    // regression: an eager memo cached the empty pre-import word map, so every chapter needed 1s
    const file = join(tmpdir(), `selah-first-run-${process.pid}.db`)
    rmSync(file, { force: true })
    const db = openBibleDb(file)
    const empty = new Bible(db)
    afterCleanup.push(() => {
      db.close()
      for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true })
    })
    h = await harness({ bible: empty })
    expect(h.frame()).toContain("Setting up your library")
    for (let i = 0; i < 100 && !h.frame().includes("verse of the day"); i++) {
      await wait(100)
      await h.settle()
    }
    expect(h.frame()).toContain("verse of the day")
    await h.type("ps 23")
    await h.press("return")
    expect(h.frame()).toMatch(/of [5-9]s/)
  }, 30_000)
})

describe("performance", () => {
  test("moving the cursor reuses every renderable instead of rebuilding the chapter", async () => {
    // regression: verses() depended on the whole position, so each j rebuilt all 176 rows of
    // Psalm 119 until the native allocator failed and the screen froze
    h = await harness({ width: 140, config: { sidebar: true }, initial: { route: "reader", book: 19, chapter: 119, verse: 100 } })
    await h.press("j")
    const before = new Set(h.renderables())
    for (let i = 0; i < 15; i++) await h.press("j")
    const after = h.renderables()
    const created = after.filter((r) => !before.has(r)).length
    expect(h.frame()).toContain("verse 116/176")
    expect(created).toBeLessThan(10)
  })
})

describe("segments", () => {
  test("Henry's [1.] numbering survives; his *italics* render as italics", async () => {
    const { segments } = await import("../src/ui/components/verse")
    expect(segments("[1.] Jesus \u0001Christ\u0002 came", { brackets: false, emphasis: true })).toEqual([
      { text: "[1.] Jesus ", italic: false, match: false },
      { text: "Christ", italic: false, match: true },
      { text: " came", italic: false, match: false },
    ])
    expect(segments("a *word* here", { brackets: false, emphasis: true }).map((s) => [s.text, s.italic])).toEqual([
      ["a ", false],
      ["word", true],
      [" here", false],
    ])
    // the KJV default is unchanged
    expect(segments("hath not the Father: [but] he").map((s) => [s.text, s.italic])).toEqual([
      ["hath not the Father: ", false],
      ["but", true],
      [" he", false],
    ])
  })
})
