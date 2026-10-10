// The study desk (HAL-2578, HAL-2579, HAL-2580): pane layout, inline notes, journal, Henry.
import { afterEach, describe, expect, test } from "bun:test"
import { UserStore } from "../src/data/user"
import { harness, type Harness } from "./harness"

let h: Harness | undefined
afterEach(() => {
  h?.destroy()
  h = undefined
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("study desk layout", () => {
  test("at 200 columns the text and the pane fill the screen side by side", async () => {
    h = await harness({ width: 200, height: 40, initial: { route: "reader", book: 43, chapter: 3, verse: 16 } })
    await h.press("tab")
    const lines = h.frame().split("\n")
    expect(lines[0]).toContain("John 3 · KJV")
    const row = lines.find((l) => l.includes("Notes") && l.includes("Commentary"))!
    expect(row).toBeDefined()
    // the verse text now starts within a few columns of the left edge and runs up to the pane
    const verse = lines.find((l) => l.includes("For God so loved the world"))!
    expect(verse.indexOf("┃")).toBeLessThanOrEqual(4)
    const textEnd = Math.max(...lines.slice(3, 30).map((l) => l.slice(0, 140).trimEnd().length))
    expect(textEnd).toBeGreaterThan(120)
  })

  test("below 120 columns the pane floats over the text", async () => {
    h = await harness({ width: 110, height: 36, initial: { route: "reader", book: 43, chapter: 3, verse: 16 } })
    await h.press("tab")
    expect(h.frame()).toContain(" Notes ")
    await h.press("tab") // back to the reader
    await h.press("l", { ctrl: true })
    expect(h.frame()).not.toContain(" Commentary ")
  })

  test("[ and ] resize the pane and the width persists", async () => {
    h = await harness({ width: 200, initial: { route: "reader", book: 43, chapter: 3 } })
    await h.press("tab")
    const before = h.config().studyWidth
    await h.press("[")
    expect(h.config().studyWidth).toBe(before + 4)
    await h.press("]")
    await h.press("]")
    expect(h.config().studyWidth).toBe(before - 4)
  })

  test("- and = adjust the reading measure outside the desk", async () => {
    h = await harness({ width: 200, initial: { route: "reader", book: 43, chapter: 3 } })
    await h.press("=")
    expect(h.config().measure).toBe(84)
    await h.press("-")
    await h.press("-")
    expect(h.config().measure).toBe(68)
  })
})

describe("inline notes", () => {
  test("a verse note and a chapter journal autosave, and the pane follows the cursor", async () => {
    const store = UserStore.memory()
    h = await harness({ width: 200, store, initial: { route: "reader", book: 43, chapter: 3, verse: 16 } })
    await h.press("tab")
    expect(h.frame()).toContain("John 3:16")
    await h.press("e")
    await h.type("God loves the whole world")
    await wait(700)
    await h.settle()
    expect(store.note({ book: 43, chapter: 3, verse: 16 })?.body).toBe("God loves the whole world")
    expect(h.frame()).toContain("saved")
    await h.press("escape")
    await h.press("w")
    await h.type("Nicodemus came by night")
    await h.press("escape") // leaving saves at once
    expect(store.journal(43, 3)).toBe("Nicodemus came by night")
    await h.press("tab") // to the reader
    await h.press("j")
    expect(h.frame()).toContain("John 3:17")
    expect(h.frame()).toMatch(/16 •/) // the new note's marker shows on verse 16 in the text column
  })

  test("notes export as Markdown grouped by book", () => {
    const store = UserStore.memory()
    store.saveNote({ book: 43, chapter: 3, verse: 16 }, "the world")
    store.saveJournal(43, 3, "by night")
    store.saveNote({ book: 1, chapter: 1, verse: 1 }, "beginning")
    const md = store.exportMarkdown((id) => (id === 1 ? "Genesis" : "John"))
    expect(md).toBe(
      "# Selah notes\n\n## Genesis\n\n### Genesis 1:1\n\nbeginning\n\n## John\n\n### John 3 (journal)\n\nby night\n\n### John 3:16\n\nthe world\n",
    )
  })
})

describe("Matthew Henry in the pane", () => {
  test("the Commentary tab opens Henry on the cursor verse and follows it", async () => {
    h = await harness({ width: 200, height: 44, initial: { route: "reader", book: 43, chapter: 3, verse: 16 } })
    await h.press("tab")
    await h.press("2")
    await wait(30)
    await h.settle()
    const f = h.frame()
    expect(f).toContain("Christ's Interview with Nicodemus")
    expect(f).toContain("v. 1–21")
    await h.press("tab")
    await h.press("G", { shift: true }) // verse 36
    await wait(30)
    await h.settle()
    expect(h.frame()).toContain("v. 22–36")
  })
})

describe("searching Henry", () => {
  test("in:commentary searches the commentary and opens it in the pane", async () => {
    h = await harness({ width: 200, initial: { route: "reader", book: 1, chapter: 1 } })
    await h.press("/")
    await h.type("brazen serpent in:commentary")
    await wait(150)
    await h.settle()
    expect(h.frame()).toMatch(/\d+ passages in Matthew Henry/)
    expect(h.frame()).toContain("Henry · ")
    await h.press("return")
    expect(h.frame()).toContain(" Commentary ")
  })
})
