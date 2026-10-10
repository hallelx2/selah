// Regression tests for the findings of the PR #1 code review (HAL-2566), one per finding.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseCli } from "../src/cli"
import { openBibleDb } from "../src/data/db"
import { importTranslation } from "../src/data/importer"
import { fixtureBible } from "./fixture"
import { harness, type Harness } from "./harness"

let h: Harness | undefined
afterEach(() => {
  h?.destroy()
  h = undefined
})

describe("1. a translation that is not installed", () => {
  test("the app falls back to an installed one instead of opening an empty reader", async () => {
    h = await harness({ config: { translation: "ASV" }, initial: { route: "reader", book: 43, chapter: 3 } })
    expect(h.frame()).toContain("John 3 · KJV")
    expect(h.frame()).toContain("There was a man of the Pharisees")
    // and nothing can be recorded from an empty chapter
    for (let i = 0; i < 3; i++) {
      h.advance(1_000)
      await h.press("j")
    }
    expect(h.store.chapterReads()).toHaveLength(0)
  })
})

describe("2. CLI parsing", () => {
  test("search prints in a terminal, as --help says", () => {
    expect(parseCli(["search", "living", "water"], { tty: true }).action).toEqual({ kind: "search", query: "living water" })
    expect(parseCli(["search", '"living water"'], { tty: false }).action).toEqual({ kind: "search", query: '"living water"' })
  })

  test("references open the app in a terminal and print when piped or with -p", () => {
    expect(parseCli(["john", "3:16"], { tty: true }).action).toMatchObject({ kind: "tui", ref: { book: 43, chapter: 3, verseStart: 16 } })
    expect(parseCli(["john", "3:16"], { tty: false }).action).toMatchObject({ kind: "print" })
    expect(parseCli(["ps", "23", "-p"], { tty: true }).action).toMatchObject({ kind: "print", ref: { book: 19, chapter: 23 } })
  })

  test("flags, commands and errors", () => {
    expect(parseCli([], { tty: true }).action).toEqual({ kind: "tui" })
    expect(parseCli(["--help"], { tty: true }).action).toEqual({ kind: "help" })
    expect(parseCli(["-v"], { tty: true }).action).toEqual({ kind: "version" })
    expect(parseCli(["stats", "--json"], { tty: true }).action).toEqual({ kind: "stats", json: true })
    expect(parseCli(["install", "asv", "ylt"], { tty: true }).action).toEqual({ kind: "install", ids: ["ASV", "YLT"] })
    expect(parseCli(["-t", "bsb", "rom", "8"], { tty: true })).toMatchObject({ translation: "BSB", action: { kind: "tui", ref: { book: 45 } } })
    expect(parseCli(["foo", "99"], { tty: true }).action).toMatchObject({ kind: "error" })
  })
})

describe("3. search", () => {
  test("quoted phrases with possessives match", async () => {
    const bible = await fixtureBible()
    const hits = bible.search("KJV", `"Lord's supper"`)
    expect(hits.some((x) => x.book === 46 && x.chapter === 11 && x.verse === 20)).toBe(true)
    expect(bible.search("BSB", `"God's love"`).length).toBeGreaterThan(0)
  })
})

describe("4. marking read across midnight", () => {
  test("m marks the session's day, the header shows it, and m again unmarks it", async () => {
    h = await harness({ start: new Date(2026, 9, 8, 23, 59, 30), initial: { route: "reader", book: 1, chapter: 1 } })
    h.advance(60_000) // now 00:00:30 on the 9th
    await h.press("j")
    await h.press("m")
    expect(h.store.readOn(1, 1, "2026-10-08")).toBe(true)
    expect(h.frame()).toContain("● read")
    await h.press("m")
    expect(h.store.readOn(1, 1, "2026-10-08")).toBe(false)
    expect(h.frame()).toContain("○ reading")
    await h.press("m")
    expect(h.store.readOn(1, 1, "2026-10-08")).toBe(true)
  })
})

describe("5. chapter grid", () => {
  test("typing 1 then 2 selects chapter 12", async () => {
    h = await harness({ initial: { route: "reader", book: 43, chapter: 3 } })
    await h.press("o")
    await h.type("genesis")
    await h.press("return")
    await h.press("1")
    await h.press("2")
    await h.press("return")
    expect(h.frame()).toContain("Genesis 12 · KJV")
  })
})

describe("6. counts", () => {
  test("5G goes to verse 5 and clears the count", async () => {
    h = await harness({ initial: { route: "reader", book: 43, chapter: 3 } })
    await h.press("5")
    await h.press("G", { shift: true })
    expect(h.frame()).toContain("verse 5/36")
    expect(h.frame()).not.toContain(":5 ")
    await h.press("j")
    expect(h.frame()).toContain("verse 6/36")
  })
})

describe("7. palette parallel", () => {
  test("uses the same checks as T", async () => {
    h = await harness({ width: 160, config: { parallel: "KJV" }, initial: { route: "reader", book: 43, chapter: 3 } })
    await h.press("p", { ctrl: true })
    await h.type("parallel")
    await h.press("return")
    expect(h.frame()).toContain("KJV ⇄ BSB")
  })
})

describe("8. ctrl+c", () => {
  test("credits the last stretch of reading before quitting", async () => {
    h = await harness({ initial: { route: "reader", book: 43, chapter: 3 } })
    h.advance(20_000)
    await h.press("c", { ctrl: true })
    expect(h.quit.called).toBe(true)
    expect(h.store.sessionsOn("2026-10-08")[0]?.activeMs).toBe(20_000)
  })
})

describe("9. a truncated source cache", () => {
  test("is discarded and downloaded again instead of failing forever", async () => {
    const dir = mkdtempSync(join(tmpdir(), "selah-cache-"))
    const full = readFileSync(join(import.meta.dir, "..", ".selah-test-sources", "KJV.json"))
    writeFileSync(join(dir, "KJV.json"), full.subarray(0, 1000)) // interrupted download
    const previous = process.env.SELAH_SOURCES
    const realFetch = globalThis.fetch
    process.env.SELAH_SOURCES = dir
    globalThis.fetch = (async () => new Response(full, { headers: { "content-length": String(full.length) } })) as never
    try {
      const db = openBibleDb(join(dir, "bible.db"))
      expect(await importTranslation(db, "KJV")).toBe(31102)
      expect(readFileSync(join(dir, "KJV.json")).length).toBe(full.length)
      db.close()
    } finally {
      process.env.SELAH_SOURCES = previous
      globalThis.fetch = realFetch
    }
  }, 60_000)
})
