import { beforeAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { TOTAL_CHAPTERS } from "../src/data/books"
import { citedVerses, Commentary, importCommentary, parseChapter, pathToChapter } from "../src/data/commentary"
import { readTar } from "../src/data/tar"
import "./fixture"

const SOURCES = join(import.meta.dir, "..", ".selah-test-sources")
let commentary: Commentary

/** The pinned tarball, downloaded once into the shared test sources. */
async function tarball(): Promise<Uint8Array> {
  const file = join(SOURCES, "mhenry-complete.tar.gz")
  if (!existsSync(file)) {
    const { COMMENTARY_URL } = await import("../src/data/commentary")
    const res = await fetch(COMMENTARY_URL)
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    await Bun.write(file, await res.arrayBuffer())
  }
  return new Uint8Array(readFileSync(file))
}

beforeAll(async () => {
  const db = new Database(":memory:")
  const decoder = new TextDecoder()
  const files = [...readTar(await tarball())].map((e) => ({ path: e.path, text: decoder.decode(e.data) }))
  const stats = importCommentary(db, files)
  expect(stats.chapters).toBe(TOTAL_CHAPTERS)
  commentary = new Commentary(db)
}, 120_000)

describe("parsing", () => {
  test("maps source paths to chapters", () => {
    expect(pathToChapter("mhenry-complete-x/volume-5/john/chapter-3.md")).toEqual({ book: 43, chapter: 3 })
    expect(pathToChapter("x/volume-3/psalms/psalm-119.md")).toEqual({ book: 19, chapter: 119 })
    expect(pathToChapter("x/volume-6/1-john/chapter-4.md")).toEqual({ book: 62, chapter: 4 })
    expect(pathToChapter("x/volume-3/song-of-solomon/chapter-2.md")).toEqual({ book: 22, chapter: 2 })
    expect(pathToChapter("x/volume-5/john/_index.md")).toBeUndefined()
  })

  test("finds the verses a paragraph cites", () => {
    expect(citedVerses("His solemn address to our Lord Jesus Christ, Joh 3:2. See here", 43, 3)).toEqual([2])
    expect(citedVerses("as in v. 16, and again vv. 18-20", 43, 3)).toEqual([16, 18, 19, 20])
    expect(citedVerses("compare Joh 7:50 and Rom 3:2", 43, 3)).toEqual([])
  })

  test("sections carry their quoted verse range and paragraphs", () => {
    const md = `---\ntitle: x\n---\n\n# John 3\n\nIntro text.\n\n## One\n\n> **¹** a  \n> **²** b  \n\nFirst I\\. note, Joh 3:2.\n\nSecond.\n\n## Two\n\n> **³** c\n\nThird.\n`
    const s = parseChapter(md, 43, 3)
    expect(s.map((x) => [x.heading, x.verseStart, x.verseEnd, x.paragraphs.length])).toEqual([
      ["Introduction", undefined, undefined, 1],
      ["One", 1, 2, 2],
      ["Two", 3, 3, 1],
    ])
    expect(s[1]!.paragraphs[0]).toEqual({ body: "First I. note, Joh 3:2.", verses: [2] })
  })
})

describe("the imported commentary", () => {
  test("every chapter of the Bible has at least one section", () => {
    const n = (commentary.db.query(`SELECT count(*) n FROM (SELECT DISTINCT book, chapter FROM commentary_sections)`).get() as { n: number }).n
    expect(n).toBe(1189)
  })

  test("John 3:16 lands in the Nicodemus section, on a paragraph about verse 16", () => {
    const hit = commentary.forVerse(43, 3, 16)!
    const section = hit.sections[hit.section]!
    expect(section.heading).toContain("Nicodemus")
    expect(section.verseStart).toBe(1)
    expect(section.verseEnd).toBe(21)
    expect(section.paragraphs[hit.paragraph]!.verses).toContain(16)
  })

  test("John 3:30 lands in John the Baptist's testimony", () => {
    const hit = commentary.forVerse(43, 3, 30)!
    expect(hit.sections[hit.section]!.heading).toContain("John")
    expect(hit.sections[hit.section]!.verseStart).toBe(22)
  })

  test("Psalms and one-chapter books are present", () => {
    expect(commentary.chapter(19, 23).length).toBeGreaterThan(0)
    expect(commentary.chapter(65, 1).length).toBeGreaterThan(0) // Jude
    expect(commentary.chapter(31, 1).length).toBeGreaterThan(0) // Obadiah
  })

  test("full-text search across Henry", () => {
    const hits = commentary.search(`"Nicodemus" "born" "again"`)
    expect(hits.some((h) => h.book === 43 && h.chapter === 3)).toBe(true)
  })
})
