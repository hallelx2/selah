// The Words tab (HAL-2581): the original words of the cursor verse and word studies.
import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Concordance } from "../src/data/concordance"
import { displayHebrew } from "../src/data/hebrew"
import { harness, type Harness } from "./harness"

let h: Harness | undefined
afterEach(() => {
  h?.destroy()
  h = undefined
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function openWords(initial: { book: number; chapter: number; verse: number }, opts: Parameters<typeof harness>[0] = {}) {
  const hh = await harness({ width: 200, height: 50, initial: { route: "reader", ...initial }, concordance: true, ...opts })
  await hh.press("tab")
  await hh.press("3")
  return hh
}

describe("Words tab", () => {
  test("lists the Greek of the cursor verse with transliteration, gloss and Strong's number", async () => {
    h = await openWords({ book: 43, chapter: 3, verse: 16 })
    const f = h.frame()
    expect(f).toContain("John 3:16")
    expect(f).toContain("Greek · Textus Receptus, as KJV")
    expect(f).toMatch(/ἠγάπησεν {2}ēgapēsen\s+G0025/)
    expect(f).toContain("loved")
    // the selected word's grammar, in words
    expect(f).toContain("adverb")
    await h.press("j")
    await h.press("j")
    expect(h.frame()).toContain("verb · aorist active indicative · 3rd person singular")
  })

  test("Hebrew is drawn right to left, without cantillation", async () => {
    h = await openWords({ book: 1, chapter: 1, verse: 1 })
    const f = h.frame()
    expect(f).toContain("Hebrew · Leningrad codex")
    expect(f).toContain(`${displayHebrew("בְּרֵאשִׁ֖ית")}  bereshit`)
    expect(f).toContain("in beginning")
    expect(f).toContain("preposition + noun, feminine singular absolute")
  })

  test("Hebrew stays in logical order when the terminal does bidi itself", async () => {
    h = await openWords({ book: 1, chapter: 1, verse: 1 }, { config: { hebrew: "logical" } })
    expect(h.frame()).toContain("בְּרֵאשִׁית  bereshit")
  })

  test("the pane follows the cursor verse", async () => {
    h = await openWords({ book: 43, chapter: 3, verse: 16 })
    await h.press("tab") // back to the reader
    await h.press("j") // verse 17
    expect(h.frame()).toContain("John 3:17")
    expect(h.frame()).toMatch(/ἀπέστειλεν/)
  })

  test("enter opens a word study: lexicon, counts per book, and every verse", async () => {
    h = await openWords({ book: 62, chapter: 4, verse: 8 })
    // ὁ μὴ ἀγαπῶν οὐκ ἔγνω τὸν θεόν, ὅτι ὁ θεὸς ἀγάπη ἐστίν: ἀγάπη is the 11th word
    for (let i = 0; i < 10; i++) await h.press("j")
    await h.press("return")
    const f = h.frame()
    expect(f).toContain("ἀγάπη  agapē  G0026")
    expect(f).toContain("Here: ἀγάπη “love”, noun · nominative singular feminine")
    expect(f).toMatch(/\d+ times in \d+ verses, \d+ books/)
    expect(f).toMatch(/1 John\s+\S+\s+18/)
    // the selection starts on the verse being read: one step on is 1 John 4:9
    await h.press("j")
    expect(h.frame()).toMatch(/┃ 1 John 4:9/)
    await h.press("k")
    expect(h.frame()).toMatch(/┃ 1 John 4:8 {2}ἀγάπη {2}He that loveth not knoweth not God;/)
  })

  test("a word too common to list whole opens on the book being read, at the verse", async () => {
    h = await openWords({ book: 62, chapter: 4, verse: 8 })
    for (let i = 0; i < 9; i++) await h.press("j") // θεὸς
    await h.press("return")
    const f = h.frame()
    expect(f).toContain("θεός  theos  G2316")
    expect(f).toMatch(/1,\d{3} times in 1,\d{3} verses, 27 books/)
    expect(f).toMatch(/In 1 John: \d+ verses · f all books/)
    expect(f).not.toContain("undefined") // the per-book bars round cleanly
    await h.press("j")
    await h.press("k")
    expect(h.frame()).toMatch(/┃ 1 John 4:8 {2}θεόν, θεὸς {2}He that loveth not/)
    await h.press("f")
    expect(h.frame()).toMatch(/the first 300 of 1,?\d{3} verses · f only 1 John/)
  })

  test("f narrows the study to the book being read; enter opens a verse and keeps the study", async () => {
    h = await openWords({ book: 62, chapter: 4, verse: 8 })
    for (let i = 0; i < 10; i++) await h.press("j")
    await h.press("return")
    await h.press("f")
    expect(h.frame()).toContain("In 1 John: 14 verses · f all books")
    // still on 4:8; up six to 2:5, the first in the book (2:5, 2:15, 3:1, 3:16, 3:17, 4:7, 4:8)
    for (let i = 0; i < 6; i++) await h.press("k")
    await h.press("return")
    const f = h.frame()
    expect(f).toContain("1 John 2 · KJV")
    expect(f).toContain("ἀγάπη  agapē  G0026") // still studying the word
    await h.press("escape") // back to the verse's words
    expect(h.frame()).toContain("1 John 2:5")
    expect(h.frame()).not.toContain("G0026  ·")
    await h.press("escape") // and back to the reader
    expect(h.app().studyFocused()).toBe(false)
  })

  test("a Strong's number in search lists its verses and opens the study", async () => {
    h = await harness({ width: 200, height: 50, initial: { route: "reader", book: 43, chapter: 3, verse: 1 }, concordance: true })
    await h.press("/")
    await h.type("G26")
    await wait(150)
    await h.settle()
    expect(h.frame()).toMatch(/G0026 agapē: \d+ verses/)
    expect(h.frame()).toContain("Matthew 24:12")
    await h.press("return")
    const f = h.frame()
    expect(f).toContain("Matthew 24 · KJV")
    expect(f).toContain("ἀγάπη  agapē  G0026")
  })

  test("a Strong's search from focus mode leaves it, so the study opens now", async () => {
    h = await harness({ width: 200, height: 50, initial: { route: "reader", book: 43, chapter: 3, verse: 1 }, concordance: true })
    await h.press("z")
    expect(h.app().focus()).toBe(true)
    await h.press("/")
    await h.type("G26")
    await wait(150)
    await h.settle()
    await h.press("return")
    expect(h.app().focus()).toBe(false)
    expect(h.frame()).toContain("ἀγάπη  agapē  G0026")
    expect(h.app().wordStudy()).toBeUndefined()
  })

  test("not installed: it offers the download, and i installs it", async () => {
    const empty = new Concordance(new Database(":memory:"))
    h = await openWords({ book: 43, chapter: 1, verse: 1 }, { concordance: empty })
    expect(h.frame()).toContain("Hebrew and Greek")
    expect(h.frame()).toContain("press i to install")
    await h.press("i") // the pinned files are already in the shared test cache, so this imports offline
    for (let i = 0; i < 120 && !empty.installed; i++) await wait(250)
    await wait(100)
    await h.settle()
    expect(empty.installed).toBe(true)
    expect(h.frame()).toContain("Ἐν  En")
  }, 120_000)
})
