import type { Database } from "bun:sqlite"
import { BOOKS, bookById, type Testament } from "./books"
import { findBook, parseRef, type Ref } from "./ref"

export interface Verse {
  book: number
  chapter: number
  verse: number
  text: string
}

export interface InstalledTranslation {
  id: string
  name: string
  year: number
  license: string
  verseCount: number
}

export interface SearchHit extends Verse {
  /** Text with matched terms wrapped in \u0001 … \u0002. */
  marked: string
  rank: number
}

export interface SearchQuery {
  /** The FTS5 MATCH expression, or "" when nothing searchable was typed. */
  match: string
  book?: number
  testament?: Testament
  /** Plain terms, for display. */
  terms: string[]
}

/** Turns what the user typed into a safe FTS5 query plus filters: `love in:1jn`, `"living water"`, `faith in:nt`. */
export function parseSearch(input: string): SearchQuery {
  let book: number | undefined
  let testament: Testament | undefined
  const terms: string[] = []
  const parts: string[] = []
  const re = /in:(\S+)|"([^"]*)"?|(\S+)/g
  for (const m of input.matchAll(re)) {
    if (m[1] !== undefined) {
      const scope = m[1].toLowerCase()
      if (scope === "ot" || scope === "old") testament = "OT"
      else if (scope === "nt" || scope === "new") testament = "NT"
      else book = findBook(scope)?.id
      continue
    }
    if (m[2] !== undefined) {
      const words = tokens(m[2])
      if (words.length) {
        parts.push(`"${words.join(" ")}"`)
        terms.push(...words)
      }
      continue
    }
    for (const word of tokens(m[3]!)) {
      parts.push(`"${word}"`)
      terms.push(word)
    }
  }
  // Prefix-match the last bare word so results appear while the user is still typing it.
  const last = parts.at(-1)
  const typed = input.replace(/in:\S*/g, "").trimEnd()
  if (last && !typed.endsWith('"')) parts[parts.length - 1] = `${last}*`
  return { match: parts.join(" "), book, testament, terms }
}

const tokens = (s: string) => s.match(/[\p{L}\p{N}’']+/gu)?.map((t) => t.replace(/[’']/g, "")).filter(Boolean) ?? []

/** Well-loved verses for the home screen, one per day. */
const VERSES_OF_THE_DAY = [
  "John 3:16", "Ps 23:1", "Phil 4:13", "Jer 29:11", "Rom 8:28", "Prov 3:5", "Isa 40:31", "Josh 1:9",
  "Matt 11:28", "Ps 46:1", "Rom 12:2", "Gal 2:20", "Heb 11:1", "2 Tim 1:7", "Ps 119:105", "Matt 6:33",
  "John 14:6", "Rom 5:8", "Eph 2:8", "1 Cor 13:4", "Isa 41:10", "Ps 27:1", "Lam 3:22", "Mic 6:8",
  "John 1:1", "Ps 37:4", "Matt 5:16", "2 Cor 5:17", "Rom 15:13", "Phil 4:6", "1 Pet 5:7", "Ps 139:14",
  "Col 3:23", "Heb 12:1", "Jas 1:5", "Ps 91:1", "John 15:5", "Rom 10:9", "Isa 53:5", "Ps 34:8",
  "Deut 31:6", "Zeph 3:17", "1 John 4:19", "Matt 28:19", "John 11:25", "Ps 51:10", "Prov 18:10", "Hab 3:19",
  "2 Cor 12:9", "Eph 3:20", "Phil 1:6", "Ps 121:1", "Isa 26:3", "John 16:33", "Rom 8:38", "Heb 4:16",
  "1 Thess 5:16", "Ps 16:11", "Gal 5:22", "Num 6:24", "Ps 103:2", "Matt 22:37", "John 10:10", "Isa 43:2",
  "Ps 62:1", "Rom 6:23", "1 Cor 10:13", "Eph 6:10", "Col 3:2", "Heb 13:8", "Jas 4:8", "Ps 145:18",
  "Prov 16:3", "Isa 55:8", "John 8:32", "Rom 12:12", "2 Cor 4:16", "Phil 4:19", "1 John 1:9", "Rev 21:4",
  "Ps 90:12", "Eccl 3:1", "Mark 10:27", "Luke 1:37", "Acts 1:8", "Ps 4:8", "Ps 19:14", "Neh 8:10",
]

export class Bible {
  constructor(readonly db: Database) {}

  translations(): InstalledTranslation[] {
    return this.db
      .query<{ id: string; name: string; year: number; license: string; verse_count: number }, []>(
        `SELECT id, name, year, license, verse_count FROM translations ORDER BY CASE id WHEN 'KJV' THEN 0 WHEN 'BSB' THEN 1 ELSE 2 END, year`,
      )
      .all()
      .map((r) => ({ id: r.id, name: r.name, year: r.year, license: r.license, verseCount: r.verse_count }))
  }

  hasTranslation(id: string): boolean {
    return !!this.db.query(`SELECT 1 FROM translations WHERE id = ?`).get(id)
  }

  chapter(translation: string, book: number, chapter: number): Verse[] {
    return this.db
      .query<Verse, [string, number, number]>(
        `SELECT book, chapter, verse, text FROM verses WHERE translation = ? AND book = ? AND chapter = ? ORDER BY verse`,
      )
      .all(translation, book, chapter)
  }

  verses(translation: string, ref: Ref): Verse[] {
    const all = this.chapter(translation, ref.book, ref.chapter)
    if (ref.verseStart === undefined) return all
    return all.filter((v) => v.verse >= ref.verseStart! && v.verse <= (ref.verseEnd ?? ref.verseStart!))
  }

  /** Words per chapter, keyed by "book:chapter", for plans and reading-time estimates. */
  chapterWords(translation: string): Map<string, number> {
    const rows = this.db
      .query<{ book: number; chapter: number; words: number }, [string]>(
        `SELECT book, chapter, words FROM chapter_stats WHERE translation = ?`,
      )
      .all(translation)
    return new Map(rows.map((r) => [`${r.book}:${r.chapter}`, r.words]))
  }

  search(translation: string, input: string, limit = 200): SearchHit[] {
    const q = parseSearch(input)
    if (!q.match) return []
    const where: string[] = [`verses_fts MATCH ?`, `v.translation = ?`]
    const params: (string | number)[] = [q.match, translation]
    if (q.book) {
      where.push(`v.book = ?`)
      params.push(q.book)
    } else if (q.testament) {
      where.push(q.testament === "OT" ? `v.book <= 39` : `v.book >= 40`)
    }
    params.push(limit)
    try {
      return this.db
        .query<SearchHit, (string | number)[]>(
          `SELECT v.book, v.chapter, v.verse, v.text,
                  highlight(verses_fts, 0, char(1), char(2)) AS marked,
                  bm25(verses_fts) AS rank
           FROM verses_fts JOIN verses v ON v.id = verses_fts.rowid
           WHERE ${where.join(" AND ")}
           ORDER BY rank LIMIT ?`,
        )
        .all(...params)
    } catch {
      return []
    }
  }

  searchCount(translation: string, input: string): number {
    const q = parseSearch(input)
    if (!q.match) return 0
    const extra = q.book ? ` AND v.book = ${q.book}` : q.testament ? (q.testament === "OT" ? ` AND v.book <= 39` : ` AND v.book >= 40`) : ""
    try {
      const row = this.db
        .query<{ n: number }, [string, string]>(
          `SELECT count(*) AS n FROM verses_fts JOIN verses v ON v.id = verses_fts.rowid WHERE verses_fts MATCH ? AND v.translation = ?${extra}`,
        )
        .get(q.match, translation)
      return row?.n ?? 0
    } catch {
      return 0
    }
  }

  verseOfTheDay(translation: string, date = new Date()): { ref: Ref; text: string } {
    const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
    const ref = parseRef(VERSES_OF_THE_DAY[day % VERSES_OF_THE_DAY.length]!)!
    const verse = this.verses(translation, ref)[0]
    return { ref, text: verse?.text ?? "" }
  }

  bookName(id: number) {
    return bookById(id).name
  }

  get books() {
    return BOOKS
  }
}
