import type { Database } from "bun:sqlite"
import { BOOKS, bookById } from "./books"
import { findBook } from "./ref"

/**
 * Matthew Henry's Complete Commentary on the Whole Bible (1706-1721), from
 * lyteword/mhenry-complete (CC0), pinned to one commit so imports are reproducible.
 * Each chapter is one Markdown file of sections: a heading, the verses it covers quoted with
 * superscript numbers, then Henry's commentary.
 */
export const COMMENTARY_COMMIT = "fff64e68c59ee4597a2b451cbe4e207adc77148d"
export const COMMENTARY_URL = `https://codeload.github.com/lyteword/mhenry-complete/tar.gz/${COMMENTARY_COMMIT}`
export const COMMENTARY_ATTRIBUTION = "Matthew Henry, Commentary on the Whole Bible (1706–1721). Text from lyteword/mhenry-complete, CC0."

export const COMMENTARY_SCHEMA = `
CREATE TABLE IF NOT EXISTS commentary_sections (
  id INTEGER PRIMARY KEY,
  book INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  heading TEXT NOT NULL,
  verse_start INTEGER,
  verse_end INTEGER,
  UNIQUE (book, chapter, idx)
);
CREATE TABLE IF NOT EXISTS commentary_paragraphs (
  id INTEGER PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES commentary_sections(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  body TEXT NOT NULL,
  -- the verses of this chapter the paragraph cites, e.g. ",2,16," (empty when none)
  verses TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS commentary_sections_ch ON commentary_sections (book, chapter);
CREATE INDEX IF NOT EXISTS commentary_paragraphs_section ON commentary_paragraphs (section_id, idx);
CREATE VIRTUAL TABLE IF NOT EXISTS commentary_fts USING fts5(
  body, content = 'commentary_paragraphs', content_rowid = 'id',
  tokenize = 'porter unicode61 remove_diacritics 2'
);
`

const SUP: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" }
const fromSup = (s: string) => Number([...s].map((c) => SUP[c] ?? "").join(""))

export interface ParsedSection {
  heading: string
  verseStart?: number
  verseEnd?: number
  paragraphs: { body: string; verses: number[] }[]
}

/** Tidies Henry's Markdown: drops escape backslashes and the trailing hard-break spaces. */
const clean = (s: string) => s.replace(/\\([.()*_\-\[\]#!])/g, "$1").replace(/[ \t]+$/gm, "").trim()

/**
 * Verses of `chapter` that a paragraph cites: "v. 16", "vv. 1-3", "ver. 5", or a full
 * reference to this chapter in Henry's abbreviations ("Joh 3:2", "Joh 3:14, Joh 3:15").
 */
export function citedVerses(text: string, book: number, chapter: number): number[] {
  const out = new Set<number>()
  const add = (a: number, b?: number) => {
    if (!a) return
    const end = b && b >= a && b - a < 60 ? b : a
    for (let v = a; v <= end; v++) out.add(v)
  }
  for (const m of text.matchAll(/\b(?:vv?|ver)\.\s*(\d+)(?:\s*[-–]\s*(\d+))?/g)) add(Number(m[1]), m[2] ? Number(m[2]) : undefined)
  for (const m of text.matchAll(/\b((?:[1-3]\s?)?[A-Z][a-z]{1,4})\.?\s+(\d+):(\d+)(?:\s*[-–]\s*(\d+))?/g)) {
    if (Number(m[2]) !== chapter) continue
    if (findBook(m[1]!)?.id !== book) continue
    add(Number(m[3]), m[4] ? Number(m[4]) : undefined)
  }
  return [...out].sort((a, b) => a - b)
}

export function parseChapter(markdown: string, book: number, chapter: number): ParsedSection[] {
  // drop the front matter
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "")
  const sections: ParsedSection[] = []
  let current: ParsedSection = { heading: "Introduction", paragraphs: [] }
  let buffer: string[] = []
  const flushParagraph = () => {
    const text = clean(buffer.join("\n"))
    buffer = []
    if (text) current.paragraphs.push({ body: text, verses: citedVerses(text, book, chapter) })
  }
  const flushSection = () => {
    flushParagraph()
    if (current.paragraphs.length || current.verseStart) sections.push(current)
  }
  for (const line of body.split("\n")) {
    if (/^# /.test(line)) continue
    const h = /^##+\s+(.*)$/.exec(line)
    if (h) {
      flushSection()
      current = { heading: clean(h[1]!), paragraphs: [] }
      continue
    }
    const q = /^>\s*\*\*([⁰¹²³⁴⁵⁶⁷⁸⁹]+)\*\*/.exec(line)
    if (q) {
      const v = fromSup(q[1]!)
      current.verseStart = Math.min(current.verseStart ?? v, v)
      current.verseEnd = Math.max(current.verseEnd ?? v, v)
      continue
    }
    if (/^>/.test(line)) continue
    if (!line.trim()) {
      flushParagraph()
      continue
    }
    buffer.push(line)
  }
  flushSection()
  return sections
}

/** The book directory names used by the source repository, by canonical book id. */
export function bookSlug(id: number): string {
  const b = bookById(id)
  return b.name.toLowerCase().replace(/ /g, "-")
}

const SLUGS = new Map(BOOKS.map((b) => [bookSlug(b.id), b.id]))

/** "mhenry-complete-<sha>/volume-5/john/chapter-3.md" → { book: 43, chapter: 3 } */
export function pathToChapter(path: string): { book: number; chapter: number } | undefined {
  const m = /\/([a-z0-9-]+)\/(?:chapter|psalm)-(\d+)\.md$/.exec(path)
  if (!m) return
  const book = SLUGS.get(m[1]!)
  return book ? { book, chapter: Number(m[2]) } : undefined
}

export function importCommentary(db: Database, files: Iterable<{ path: string; text: string }>): { chapters: number; sections: number; paragraphs: number } {
  db.exec(COMMENTARY_SCHEMA)
  const insertSection = db.prepare(
    `INSERT INTO commentary_sections (book, chapter, idx, heading, verse_start, verse_end) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  )
  const insertParagraph = db.prepare(`INSERT INTO commentary_paragraphs (section_id, idx, body, verses) VALUES (?, ?, ?, ?)`)
  let chapters = 0
  let sections = 0
  let paragraphs = 0
  db.transaction(() => {
    db.run(`DELETE FROM commentary_paragraphs`)
    db.run(`DELETE FROM commentary_sections`)
    for (const f of files) {
      const key = pathToChapter(f.path)
      if (!key) continue
      const parsed = parseChapter(f.text, key.book, key.chapter)
      if (!parsed.length) continue
      chapters++
      parsed.forEach((s, i) => {
        const row = insertSection.get(key.book, key.chapter, i, s.heading, s.verseStart ?? null, s.verseEnd ?? null) as { id: number }
        sections++
        s.paragraphs.forEach((p, j) => {
          insertParagraph.run(row.id, j, p.body, p.verses.length ? `,${p.verses.join(",")},` : "")
          paragraphs++
        })
      })
    }
  })()
  db.run(`INSERT INTO commentary_fts (commentary_fts) VALUES ('rebuild')`)
  return { chapters, sections, paragraphs }
}

export interface CommentarySection {
  id: number
  heading: string
  verseStart: number | null
  verseEnd: number | null
  paragraphs: { body: string; verses: number[] }[]
}

export class Commentary {
  constructor(readonly db: Database) {
    db.exec(COMMENTARY_SCHEMA)
  }

  get installed(): boolean {
    return !!this.db.query(`SELECT 1 FROM commentary_sections LIMIT 1`).get()
  }

  chapter(book: number, chapter: number): CommentarySection[] {
    const sections = this.db
      .query<{ id: number; heading: string; verse_start: number | null; verse_end: number | null }, [number, number]>(
        `SELECT id, heading, verse_start, verse_end FROM commentary_sections WHERE book = ? AND chapter = ? ORDER BY idx`,
      )
      .all(book, chapter)
    const paras = this.db.query<{ body: string; verses: string }, [number]>(
      `SELECT body, verses FROM commentary_paragraphs WHERE section_id = ? ORDER BY idx`,
    )
    return sections.map((s) => ({
      id: s.id,
      heading: s.heading,
      verseStart: s.verse_start,
      verseEnd: s.verse_end,
      paragraphs: paras.all(s.id).map((p) => ({ body: p.body, verses: p.verses ? p.verses.split(",").filter(Boolean).map(Number) : [] })),
    }))
  }

  /**
   * Henry on one verse: the section whose quoted verses contain it, and the first paragraph in
   * that section that cites the verse (so the reader lands on his words about it).
   */
  forVerse(book: number, chapter: number, verse: number): { sections: CommentarySection[]; section: number; paragraph: number } | undefined {
    const sections = this.chapter(book, chapter)
    if (!sections.length) return
    let section = sections.findIndex((s) => s.verseStart !== null && s.verseEnd !== null && verse >= s.verseStart && verse <= s.verseEnd)
    if (section === -1) {
      // fall back to the last section that starts before the verse, else the first
      const before = sections.map((s, i) => [s.verseStart ?? 0, i] as const).filter(([start]) => start && start <= verse)
      section = before.length ? before.at(-1)![1] : 0
    }
    const paragraph = Math.max(0, sections[section]!.paragraphs.findIndex((p) => p.verses.includes(verse)))
    return { sections, section, paragraph }
  }

  /** `match` is an FTS5 expression, as built by parseSearch. */
  search(match: string, limit = 50): { book: number; chapter: number; verse: number; heading: string; snippet: string }[] {
    try {
      return this.db
        .query<{ book: number; chapter: number; verse: number; heading: string; snippet: string }, [string, number]>(
          `SELECT s.book, s.chapter, coalesce(s.verse_start, 1) AS verse, s.heading, snippet(commentary_fts, 0, char(1), char(2), '…', 24) AS snippet
           FROM commentary_fts JOIN commentary_paragraphs p ON p.id = commentary_fts.rowid
           JOIN commentary_sections s ON s.id = p.section_id
           WHERE commentary_fts MATCH ? ORDER BY bm25(commentary_fts) LIMIT ?`,
        )
        .all(match, limit)
    } catch {
      return []
    }
  }
}

export type InstallProgress = (e: { phase: "download" | "import" | "index"; fraction: number }) => void

/** Downloads (or reuses the cached) pinned tarball and imports it. */
export async function installCommentary(db: Database, cacheDir: string, onProgress?: InstallProgress) {
  const { join } = await import("node:path")
  const { existsSync, renameSync } = await import("node:fs")
  const file = join(cacheDir, `mhenry-complete-${COMMENTARY_COMMIT.slice(0, 12)}.tar.gz`)
  if (!existsSync(file)) {
    const { download } = await import("./download")
    const data = await download(COMMENTARY_URL, {
      label: "Matthew Henry's Commentary",
      onProgress: (got, total) => onProgress?.({ phase: "download", fraction: Math.min(1, got / (total ?? 14_100_000)) }),
    })
    const tmp = `${file}.${process.pid}.part`
    await Bun.write(tmp, data)
    renameSync(tmp, file)
  }
  onProgress?.({ phase: "import", fraction: 0 })
  const { readTar } = await import("./tar")
  const decoder = new TextDecoder()
  const bytes = new Uint8Array(await Bun.file(file).arrayBuffer())
  const files = [...readTar(bytes)].map((e) => ({ path: e.path, text: decoder.decode(e.data) }))
  const stats = importCommentary(db, files)
  onProgress?.({ phase: "index", fraction: 1 })
  return stats
}
