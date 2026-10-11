// A newcomer's journeys (M10): what someone who has read nothing actually does.
import { afterEach, describe, expect, test } from "bun:test"
import { harness, type Harness } from "./harness"

let h: Harness | undefined
afterEach(() => {
  h?.destroy()
  h = undefined
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** One key at a time, as a person types: each key lands before the next arrives. */
async function typeSlowly(hh: Harness, text: string) {
  for (const ch of text) await hh.type(ch)
}
const reader = (book = 43, chapter = 2) => harness({ width: 120, height: 40, initial: { route: "reader", book, chapter, verse: 1 } })

describe("typing a book name in the reader (HAL-2628)", () => {
  test("'romans 8' lands on Romans 8, though r is ignored and o opens Go to", async () => {
    h = await reader()
    await typeSlowly(h, "romans 8")
    expect(h.frame()).toContain("Romans 8")
    await h.press("return")
    expect(h.frame()).toContain("Romans 8 · KJV")
  })

  test("'john 3' lands on John 3, though j moves a verse first", async () => {
    h = await reader(1, 1)
    await typeSlowly(h, "john 3")
    await h.press("return")
    expect(h.frame()).toContain("John 3 · KJV")
  })

  test("Go to explains what to type when nothing matches", async () => {
    h = await reader()
    await h.press("o")
    await h.type("qxq")
    expect(h.frame()).toContain("No book by that name. Type a book and chapter, like")
  })

  test("Go to with a verse: 'rom 8:28'", async () => {
    h = await reader()
    await h.press("o")
    await h.type("rom 8:28")
    await h.press("return")
    expect(h.frame()).toContain("Romans 8 · KJV")
    expect(h.frame()).toContain("verse 28/39")
  })
})

describe("help and quitting from home (HAL-2629)", () => {
  test("the footer says how to get help and how to quit", async () => {
    h = await harness({ width: 140, height: 40 })
    const footer = h.frame().trimEnd().split("\n").at(-1)!
    expect(footer).toContain("? help")
    expect(footer).toContain("ctrl+c quit")
  })

  test("? with an empty box opens help; with text, it is just a character", async () => {
    h = await harness({ width: 140, height: 40 })
    await h.type("?")
    expect(h.frame()).toContain("Keyboard")
    await h.press("escape")
    await wait(20)
    await h.settle()
    await h.type("why?")
    expect(h.frame()).toContain("why?")
  })

  test("typing quit or exit and pressing enter quits; help opens help", async () => {
    for (const word of ["quit", "exit", "Quit"]) {
      h = await harness({ width: 120, height: 40 })
      await h.type(word)
      await h.press("return")
      expect(h.quit.called).toBe(true)
      h.destroy()
      h = undefined
    }
    h = await harness({ width: 120, height: 40 })
    await h.type("help")
    await h.press("return")
    expect(h.frame()).toContain("Keyboard")
  })
})

describe("the words people type into the command palette (HAL-2630)", () => {
  const expectations: [string, RegExp][] = [
    ["help", /^Keyboard shortcuts and help/],
    ["settings", /^(Theme|Daily goal|Icons|Motion|Light or dark|Bigger or smaller text|Translations)/],
    ["exit", /^Quit/],
    ["quit", /^Quit/],
    ["dark", /^Light or dark/],
    ["version", /^Translations/],
    ["pictures", /^Doré gallery/],
    ["art", /^Doré gallery/],
    ["claude", /^Ask Claude or Codex/],
    ["ai", /^Ask Claude or Codex/],
    ["chat", /^Ask Claude or Codex/],
    ["question", /^Ask Claude or Codex/],
    ["dictionary", /^Hebrew and Greek/],
    ["strongs", /^Hebrew and Greek/],
    ["greek", /^Hebrew and Greek/],
    ["commentary", /^Matthew Henry/],
    ["tutorial", /^Keyboard shortcuts and help/],
    ["bigger text", /^Bigger or smaller text/],
    ["font", /^Bigger or smaller text/],
  ]
  for (const route of ["home", "reader"] as const) {
    test(`on ${route}, each everyday word finds its command first`, async () => {
      const misses: string[] = []
      for (const [q, want] of expectations) {
        h = await harness({ width: 120, height: 40, initial: route === "reader" ? { route: "reader", book: 43, chapter: 3, verse: 1 } : undefined })
        await h.press("p", { ctrl: true })
        await h.type(q)
        const lines = h.frame().split("\n")
        const i = lines.findIndex((l) => l.trim() === q)
        const first = (lines[i + 2] ?? "").trim()
        if (!want.test(first)) misses.push(`${q} → ${first.replace(/\s{2,}.*/, "")}`)
        h.destroy()
        h = undefined
      }
      expect(misses).toEqual([])
    })
  }

  test("reader-only actions: highlight, copy, bookmark", async () => {
    for (const [q, want] of [["highlight", /^Highlight John 3:1/], ["copy", /^Copy John 3:1/], ["bookmark", /^Bookmark John 3:1/]] as const) {
      h = await harness({ width: 120, height: 40, initial: { route: "reader", book: 43, chapter: 3, verse: 1 } })
      await h.press("p", { ctrl: true })
      await h.type(q)
      const lines = h.frame().split("\n")
      expect((lines[lines.findIndex((l) => l.trim() === q) + 2] ?? "").trim()).toMatch(want)
      h.destroy()
      h = undefined
    }
  })

  test("from home, a study tool opens the reader where you left off, with the tool", async () => {
    const { UserStore } = await import("../src/data/user")
    const store = UserStore.memory()
    store.setPosition({ book: 45, chapter: 8, verse: 28, translation: "KJV" })
    h = await harness({ width: 200, height: 46, store })
    await h.press("p", { ctrl: true })
    await h.type("commentary")
    await h.press("return")
    expect(h.frame()).toContain("Romans 8 · KJV")
    expect(h.app().studyTab()).toBe("commentary")
    expect(h.app().studyFocused()).toBe(true)
  })

  test("scattered letters no longer win: 'chat' is not Go to book, 'greek' is not Progress", async () => {
    h = await harness({ width: 120, height: 40 })
    await h.press("p", { ctrl: true })
    await h.type("greek")
    expect(h.frame()).not.toMatch(/Progress and streaks/)
  })
})
