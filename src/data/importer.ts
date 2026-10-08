import type { Database } from "bun:sqlite"
import { join } from "node:path"
import { BOOKS } from "./books"
import { paths } from "./paths"
import { sourceUrl, translationInfo } from "./translations"

interface SourceJson {
  translation: string
  books: { name: string; chapters: { chapter: number; verses: { verse: number; text: string }[] }[] }[]
}

export type ImportProgress = (event: { phase: "download" | "import" | "index"; fraction: number }) => void

/** Downloads (or reads from cache) the source JSON for a translation. */
export async function fetchSource(id: string, onProgress?: ImportProgress): Promise<SourceJson> {
  const cached = Bun.file(join(paths.sources, `${id}.json`))
  if (await cached.exists()) return (await cached.json()) as SourceJson

  const res = await fetch(sourceUrl(id))
  if (!res.ok || !res.body) throw new Error(`Download of ${id} failed: HTTP ${res.status}`)
  const total = Number(res.headers.get("content-length")) || 8_400_000
  const chunks: Uint8Array[] = []
  let received = 0
  for await (const chunk of res.body) {
    chunks.push(chunk)
    received += chunk.length
    onProgress?.({ phase: "download", fraction: Math.min(1, received / total) })
  }
  const bytes = Buffer.concat(chunks)
  const json = JSON.parse(bytes.toString("utf8")) as SourceJson
  validate(id, json)
  await Bun.write(cached, bytes)
  return json
}

function validate(id: string, json: SourceJson) {
  if (!Array.isArray(json.books) || json.books.length !== 66) {
    throw new Error(`${id}: expected 66 books, found ${json.books?.length ?? 0}`)
  }
  json.books.forEach((book, i) => {
    const expected = BOOKS[i]!
    if (book.chapters.length !== expected.chapters) {
      throw new Error(`${id}: ${expected.name} has ${book.chapters.length} chapters, expected ${expected.chapters}`)
    }
  })
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim()
const countWords = (text: string) => (text.match(/[\p{L}\p{N}’']+/gu) ?? []).length

/** Imports one translation. Safe to run again: the translation's rows are replaced in one transaction. */
export async function importTranslation(db: Database, id: string, onProgress?: ImportProgress): Promise<number> {
  const info = translationInfo(id)
  if (!info) throw new Error(`Unknown translation ${id}`)
  const json = await fetchSource(id, onProgress)
  validate(id, json)

  const insertVerse = db.prepare(`INSERT INTO verses (translation, book, chapter, verse, text) VALUES (?, ?, ?, ?, ?)`)
  const insertStat = db.prepare(
    `INSERT INTO chapter_stats (translation, book, chapter, verses, words) VALUES (?, ?, ?, ?, ?)`,
  )
  let count = 0
  db.transaction(() => {
    db.run(`DELETE FROM verses WHERE translation = ?`, [id])
    db.run(`DELETE FROM chapter_stats WHERE translation = ?`, [id])
    json.books.forEach((book, bi) => {
      const bookId = bi + 1
      for (const ch of book.chapters) {
        let words = 0
        const seen = new Set<number>()
        for (const v of ch.verses) {
          if (seen.has(v.verse)) continue
          seen.add(v.verse)
          const text = clean(v.text)
          words += countWords(text.replace(/[[\]]/g, ""))
          insertVerse.run(id, bookId, ch.chapter, v.verse, text)
          count++
        }
        insertStat.run(id, bookId, ch.chapter, seen.size, words)
      }
      onProgress?.({ phase: "import", fraction: (bi + 1) / 66 })
    })
    db.run(
      `INSERT INTO translations (id, name, year, license, source, verse_count, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, year = excluded.year, license = excluded.license,
         source = excluded.source, verse_count = excluded.verse_count, imported_at = excluded.imported_at`,
      [id, info.name, info.year, info.license, sourceUrl(id), count, new Date().toISOString()],
    )
  })()
  onProgress?.({ phase: "index", fraction: 0 })
  db.run(`INSERT INTO verses_fts (verses_fts) VALUES ('rebuild')`)
  onProgress?.({ phase: "index", fraction: 1 })
  return count
}

export function removeTranslation(db: Database, id: string) {
  db.transaction(() => {
    db.run(`DELETE FROM verses WHERE translation = ?`, [id])
    db.run(`DELETE FROM chapter_stats WHERE translation = ?`, [id])
    db.run(`DELETE FROM translations WHERE id = ?`, [id])
  })()
  db.run(`INSERT INTO verses_fts (verses_fts) VALUES ('rebuild')`)
}
