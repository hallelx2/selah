import { beforeAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Bible, parseSearch } from "../src/data/bible"
import { openBibleDb } from "../src/data/db"
import { importTranslation } from "../src/data/importer"
import { fixtureBible } from "./fixture"

let bible: Bible
beforeAll(async () => {
  bible = await fixtureBible()
}, 120_000)

const count = (sql: string, ...p: (string | number)[]) =>
  (bible.db.query(sql).get(...p) as { n: number }).n

describe("bible.db", () => {
  test("books: 66 in canonical order with OSIS ids", () => {
    expect(count(`SELECT count(*) n FROM books`)).toBe(66)
    const rows = bible.db.query(`SELECT id, osis FROM books ORDER BY id`).all() as { id: number; osis: string }[]
    expect(rows[0]).toEqual({ id: 1, osis: "Gen" })
    expect(rows[42]).toEqual({ id: 43, osis: "John" })
    expect(rows[65]).toEqual({ id: 66, osis: "Rev" })
  })

  test("KJV: 1189 chapters and 31,102 verses", () => {
    expect(count(`SELECT count(*) n FROM verses WHERE translation = 'KJV'`)).toBe(31102)
    expect(count(`SELECT count(*) n FROM (SELECT DISTINCT book, chapter FROM verses WHERE translation = 'KJV')`)).toBe(1189)
    expect(count(`SELECT count(*) n FROM chapter_stats WHERE translation = 'KJV'`)).toBe(1189)
  })

  test("BSB: same versification; omitted verses kept as empty rows", () => {
    expect(count(`SELECT count(*) n FROM verses WHERE translation = 'BSB'`)).toBe(31102)
    const omitted = bible.chapter("BSB", 40, 17).find((v) => v.verse === 21)
    expect(omitted?.text).toBe("")
  })

  test("John 3:16 reads correctly in both translations", () => {
    expect(bible.verses("KJV", { book: 43, chapter: 3, verseStart: 16 })[0]?.text).toStartWith("For God so loved the world")
    expect(bible.verses("BSB", { book: 43, chapter: 3, verseStart: 16 })[0]?.text).toStartWith("For God so loved the world")
  })

  test("word counts are plausible (whole KJV is ~790k words)", () => {
    const total = [...bible.chapterWords("KJV").values()].reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(770_000)
    expect(total).toBeLessThan(800_000)
  })
})

describe("search", () => {
  test("FTS ranks John 3:16 in the top 3 for 'God so loved the world'", () => {
    const hits = bible.search("KJV", "God so loved the world", 3)
    expect(hits.some((h) => h.book === 43 && h.chapter === 3 && h.verse === 16)).toBe(true)
  })

  test("in:1jn restricts to 1 John", () => {
    const hits = bible.search("KJV", "love in:1jn")
    expect(hits.length).toBeGreaterThan(10)
    expect(hits.every((h) => h.book === 62)).toBe(true)
  })

  test("in:nt and in:ot restrict by testament", () => {
    expect(bible.search("KJV", "shepherd in:nt").every((h) => h.book >= 40)).toBe(true)
    expect(bible.search("KJV", "shepherd in:ot").every((h) => h.book <= 39)).toBe(true)
  })

  test("phrase search matches the phrase, not the words apart", () => {
    const hits = bible.search("KJV", '"living water"')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => /living\s+water/i.test(h.text))).toBe(true)
  })

  test("matches are marked for highlighting", () => {
    const [hit] = bible.search("KJV", "begotten in:john", 1)
    expect(hit?.marked).toContain("\u0001begotten\u0002")
  })

  test("the last word prefix-matches while typing", () => {
    expect(parseSearch("bego").match).toBe('"bego"*')
    expect(bible.search("KJV", "bego in:john").length).toBeGreaterThan(0)
  })

  test("hostile input never throws", () => {
    for (const q of ['"', "AND", "NEAR(", "*", "in:", "-", "''", "a OR"]) expect(() => bible.search("KJV", q)).not.toThrow()
  })
})

describe("import", () => {
  test("re-importing is idempotent", async () => {
    const file = join(tmpdir(), `selah-idem-${process.pid}.db`)
    const db = openBibleDb(file)
    await importTranslation(db, "KJV")
    await importTranslation(db, "KJV")
    expect((db.query(`SELECT count(*) n FROM verses`).get() as { n: number }).n).toBe(31102)
    expect((db.query(`SELECT count(*) n FROM verses_fts`).get() as { n: number }).n).toBe(31102)
    db.close()
  }, 60_000)

  test("verse of the day is deterministic per date and resolves to text", () => {
    const a = bible.verseOfTheDay("KJV", new Date(2026, 9, 8))
    const b = bible.verseOfTheDay("KJV", new Date(2026, 9, 8))
    const c = bible.verseOfTheDay("KJV", new Date(2026, 9, 9))
    expect(a).toEqual(b)
    expect(a.ref).not.toEqual(c.ref)
    expect(a.text.length).toBeGreaterThan(10)
  })
})

void Database
