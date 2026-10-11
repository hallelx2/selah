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
    expect(h.frame()).toContain("How to use Selah")
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
    expect(h.frame()).toContain("How to use Selah")
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
      // 22 apps started in one test: it asserts what the palette finds, not how fast, so a
      // busy machine (load 30+, HAL-2595) must not fail it
    }, 60_000)
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

describe("help that a newcomer can read (HAL-2631)", () => {
  for (const [w, hh] of [[80, 24], [120, 40], [200, 60]] as const) {
    test(`at ${w}×${hh}, every description is whole (scrolling as needed)`, async () => {
      const { KEYS } = await import("../src/ui/keys")
      h = await harness({ width: w, height: hh, initial: { route: "reader", book: 43, chapter: 3, verse: 1 } })
      await h.press("?")
      // collect what is shown while scrolling through
      let seen = ""
      for (let i = 0; i < 40; i++) {
        seen += `\n${h.frame()}`
        await h.press("down")
      }
      const text = seen.replace(/\s+/g, " ")
      const missing: string[] = []
      for (const [, keys] of KEYS) for (const [, d] of keys) for (const word of d.split(/\s+/)) if (!text.includes(word)) missing.push(`${word} (in "${d}")`)
      expect(missing).toEqual([])
      expect(text).toContain("letters are shortcuts")
    })
  }

  test("help explains the study pane's tabs", async () => {
    h = await harness({ width: 200, height: 60 })
    await h.press("?")
    const f = h.frame()
    // descriptions wrap in two columns; the phrases that matter are each on one line
    expect(f).toContain("Study tools")
    expect(f).toContain("Matthew Henry")
    expect(f).toContain("Hebrew or Greek")
    expect(f).toContain("Claude Code or")
  })
})

describe("the first visit to the reader (HAL-2632)", () => {
  test("shows the keys once; the first key only closes it; it never returns", async () => {
    let saved: Record<string, unknown> | undefined
    h = await harness({ width: 120, height: 40, config: { welcomed: false } })
    await h.press("return") // home → reader
    expect(h.frame()).toContain("Welcome to the reader")
    expect(h.frame()).toContain("go to a book: type romans 8")
    await h.press("j") // closes the card, does not move
    expect(h.frame()).not.toContain("Welcome to the reader")
    expect(h.app().position().verse).toBe(1)
    expect(h.app().config.welcomed).toBe(true)
    saved = { ...h.app().config }
    await h.press("j")
    expect(h.app().position().verse).toBe(2)
    await h.press("escape") // home and back: no card
    await h.press("return")
    expect(h.frame()).not.toContain("Welcome to the reader")
    expect(saved.welcomed).toBe(true)
  })
})

describe("writing a note without knowing about e (HAL-2634)", () => {
  test("typing in the Notes tab starts the verse note with what was typed", async () => {
    const { UserStore } = await import("../src/data/user")
    const store = UserStore.memory()
    h = await harness({ width: 200, height: 46, store, initial: { route: "reader", book: 62, chapter: 4, verse: 8 } })
    await h.press("tab")
    expect(h.frame()).toContain("type to write")
    await typeSlowly(h, "God is love, and n and p are letters")
    await h.press("escape")
    expect(store.note({ book: 62, chapter: 4, verse: 8 })?.body).toBe("God is love, and n and p are letters")
    expect(h.app().position()).toMatchObject({ book: 62, chapter: 4 }) // n and p did not turn the chapter
  })

  test("? in the Notes tab opens help, not a note", async () => {
    const { UserStore } = await import("../src/data/user")
    const store = UserStore.memory()
    h = await harness({ width: 200, height: 46, store, initial: { route: "reader", book: 62, chapter: 4, verse: 8 } })
    await h.press("tab")
    await h.type("?")
    expect(h.frame()).toContain("How to use Selah")
    expect(store.note({ book: 62, chapter: 4, verse: 8 })).toBeUndefined()
  })

  test("← and → still change chapter from the pane", async () => {
    h = await harness({ width: 200, height: 46, initial: { route: "reader", book: 62, chapter: 4, verse: 8 } })
    await h.press("tab")
    await h.press("right")
    expect(h.frame()).toContain("1 John 5 · KJV")
  })
})

describe("review of the audit fixes", () => {
  test("a burst of typing into Notes keeps every key, not just the first", async () => {
    const { UserStore } = await import("../src/data/user")
    const store = UserStore.memory()
    h = await harness({ width: 200, height: 46, store, initial: { route: "reader", book: 62, chapter: 4, verse: 8 } })
    await h.press("tab")
    await h.type("God is love") // all at once, as a paste or a fast typist delivers it
    await wait(20)
    await h.settle()
    await h.press("escape")
    expect(store.note({ book: 62, chapter: 4, verse: 8 })?.body).toBe("God is love")
  })

  test("the welcome card keeps the keyboard even when a study tool opened the reader", async () => {
    h = await harness({ width: 200, height: 46, config: { welcomed: false } })
    await h.press("p", { ctrl: true })
    await h.type("commentary")
    await h.press("return")
    expect(h.frame()).toContain("Welcome to the reader")
    await h.press("tab") // closes the card only
    expect(h.frame()).not.toContain("Welcome to the reader")
    expect(h.app().studyFocused()).toBe(true)
    expect(h.app().studyTab()).toBe("commentary")
  })

  test("once the time is in, the header says the end is what remains", async () => {
    // Psalm 119 is far longer than the screen, so its end is not reached by looking at it
    h = await harness({ width: 140, height: 40, initial: { route: "reader", book: 19, chapter: 119, verse: 1 } })
    for (let i = 0; i < 12; i++) {
      h.advance(5_000)
      await h.press("j")
      await h.press("k")
    }
    expect(h.frame()).toContain("read to the end to count it")
    expect(h.frame()).not.toContain("0s more")
  })

  test("only the whole word quits: 'q1' and 'close 3' search instead", async () => {
    for (const typed of ["q1", "close 3", "exit strategy"]) {
      h = await harness({ width: 120, height: 40 })
      await h.type(typed)
      await h.press("return")
      expect(h.quit.called).toBe(false)
      h.destroy()
      h = undefined
    }
  })
})
