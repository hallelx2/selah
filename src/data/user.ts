import { Database } from "bun:sqlite"
import type { DayKey } from "./dates"
import { paths } from "./paths"

/**
 * Everything personal lives in user.db, never in bible.db, so re-importing or removing a
 * translation can never touch a reader's history, notes or streaks.
 */
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  book INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  translation TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  active_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_day ON sessions (day);

CREATE TABLE IF NOT EXISTS chapter_reads (
  book INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  day TEXT NOT NULL,
  read_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
  PRIMARY KEY (book, chapter, day)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS bookmarks (
  book INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (book, chapter, verse)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS highlights (
  book INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  color INTEGER NOT NULL CHECK (color BETWEEN 1 AND 4),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (book, chapter, verse)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS journal (
  book INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (book, chapter)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS notes (
  book INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (book, chapter, verse)
) WITHOUT ROWID;
`

export interface Session {
  id: number
  day: DayKey
  book: number
  chapter: number
  translation: string
  startedAt: number
  endedAt: number
  activeMs: number
}

export interface ChapterRead {
  book: number
  chapter: number
  day: DayKey
  readAt: number
  source: "auto" | "manual"
}

export interface VerseKey {
  book: number
  chapter: number
  verse: number
}

export interface Bookmark extends VerseKey {
  createdAt: number
}

export interface Highlight extends VerseKey {
  color: 1 | 2 | 3 | 4
}

export interface Note extends VerseKey {
  body: string
  createdAt: number
  updatedAt: number
}

export interface Position {
  book: number
  chapter: number
  verse: number
  translation: string
}

export class UserStore {
  constructor(readonly db: Database) {
    db.exec(SCHEMA)
  }

  static open(file = paths.userDb) {
    return new UserStore(new Database(file, { create: true }))
  }

  static memory() {
    return new UserStore(new Database(":memory:"))
  }

  // settings ---------------------------------------------------------------

  get<T>(key: string, fallback: T): T {
    const row = this.db.query<{ value: string }, [string]>(`SELECT value FROM settings WHERE key = ?`).get(key)
    if (!row) return fallback
    try {
      return JSON.parse(row.value) as T
    } catch {
      return fallback
    }
  }

  set(key: string, value: unknown) {
    if (value === undefined) {
      this.db.run(`DELETE FROM settings WHERE key = ?`, [key])
      return
    }
    this.db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [key, JSON.stringify(value)],
    )
  }

  // sessions ---------------------------------------------------------------

  startSession(s: Omit<Session, "id" | "endedAt" | "activeMs">): number {
    const row = this.db
      .query<{ id: number }, [string, number, number, string, number, number]>(
        `INSERT INTO sessions (day, book, chapter, translation, started_at, ended_at, active_ms)
         VALUES (?, ?, ?, ?, ?, ?, 0) RETURNING id`,
      )
      .get(s.day, s.book, s.chapter, s.translation, s.startedAt, s.startedAt)
    return row!.id
  }

  updateSession(id: number, activeMs: number, endedAt: number) {
    this.db.run(`UPDATE sessions SET active_ms = ?, ended_at = ? WHERE id = ?`, [activeMs, endedAt, id])
  }

  sessionsOn(day: DayKey): Session[] {
    return this.db
      .query<Record<string, number | string>, [string]>(`SELECT * FROM sessions WHERE day = ? ORDER BY started_at, id`)
      .all(day)
      .map(toSession)
  }

  recentSessions(limit = 50): Session[] {
    return this.db
      .query<Record<string, number | string>, [number]>(`SELECT * FROM sessions ORDER BY ended_at DESC LIMIT ?`)
      .all(limit)
      .map(toSession)
  }

  /** The most recent distinct chapters opened, newest first. */
  recentChapters(limit = 8): { book: number; chapter: number; translation: string; at: number }[] {
    return this.db
      .query<{ book: number; chapter: number; translation: string; at: number }, [number]>(
        `SELECT book, chapter, translation, max(ended_at) AS at FROM sessions
         GROUP BY book, chapter ORDER BY at DESC LIMIT ?`,
      )
      .all(limit)
  }

  // reads ------------------------------------------------------------------

  /** Records a completed chapter for a day. Returns false if it was already recorded that day. */
  recordRead(r: ChapterRead): boolean {
    const res = this.db.run(
      `INSERT OR IGNORE INTO chapter_reads (book, chapter, day, read_at, source) VALUES (?, ?, ?, ?, ?)`,
      [r.book, r.chapter, r.day, r.readAt, r.source],
    )
    return res.changes > 0
  }

  unrecordRead(book: number, chapter: number, day: DayKey) {
    this.db.run(`DELETE FROM chapter_reads WHERE book = ? AND chapter = ? AND day = ?`, [book, chapter, day])
  }

  chapterReads(): ChapterRead[] {
    return this.db
      .query<{ book: number; chapter: number; day: string; read_at: number; source: "auto" | "manual" }, []>(
        `SELECT * FROM chapter_reads ORDER BY day, read_at`,
      )
      .all()
      .map((r) => ({ book: r.book, chapter: r.chapter, day: r.day, readAt: r.read_at, source: r.source }))
  }

  isRead(book: number, chapter: number): boolean {
    return !!this.db.query(`SELECT 1 FROM chapter_reads WHERE book = ? AND chapter = ? LIMIT 1`).get(book, chapter)
  }

  readOn(book: number, chapter: number, day: DayKey): boolean {
    return !!this.db.query(`SELECT 1 FROM chapter_reads WHERE book = ? AND chapter = ? AND day = ?`).get(book, chapter, day)
  }

  /** Per-day totals: distinct chapters completed and minutes of active reading. */
  dayTotals(): Map<DayKey, { chapters: number; minutes: number }> {
    const out = new Map<DayKey, { chapters: number; minutes: number }>()
    for (const r of this.db
      .query<{ day: string; n: number }, []>(`SELECT day, count(*) AS n FROM chapter_reads GROUP BY day`)
      .all()) {
      out.set(r.day, { chapters: r.n, minutes: 0 })
    }
    for (const r of this.db
      .query<{ day: string; ms: number }, []>(`SELECT day, sum(active_ms) AS ms FROM sessions GROUP BY day`)
      .all()) {
      const entry = out.get(r.day) ?? { chapters: 0, minutes: 0 }
      entry.minutes = r.ms / 60_000
      out.set(r.day, entry)
    }
    return out
  }

  totalActiveMs(): number {
    return (this.db.query(`SELECT coalesce(sum(active_ms), 0) AS ms FROM sessions`).get() as { ms: number }).ms
  }

  // bookmarks, highlights, notes ------------------------------------------

  toggleBookmark(v: VerseKey, at = Date.now()): boolean {
    const exists = this.db
      .query(`SELECT 1 FROM bookmarks WHERE book = ? AND chapter = ? AND verse = ?`)
      .get(v.book, v.chapter, v.verse)
    if (exists) {
      this.db.run(`DELETE FROM bookmarks WHERE book = ? AND chapter = ? AND verse = ?`, [v.book, v.chapter, v.verse])
      return false
    }
    this.db.run(`INSERT INTO bookmarks (book, chapter, verse, created_at) VALUES (?, ?, ?, ?)`, [
      v.book,
      v.chapter,
      v.verse,
      at,
    ])
    return true
  }

  bookmarks(): Bookmark[] {
    return this.db
      .query<{ book: number; chapter: number; verse: number; created_at: number }, []>(
        `SELECT * FROM bookmarks ORDER BY created_at DESC`,
      )
      .all()
      .map((r) => ({ book: r.book, chapter: r.chapter, verse: r.verse, createdAt: r.created_at }))
  }

  /** Cycles a verse through highlight colours 1 → 4 → none. Returns the new colour, or 0 when cleared. */
  cycleHighlight(v: VerseKey, at = Date.now()): number {
    const row = this.db
      .query<{ color: number }, [number, number, number]>(
        `SELECT color FROM highlights WHERE book = ? AND chapter = ? AND verse = ?`,
      )
      .get(v.book, v.chapter, v.verse)
    const next = row ? (row.color >= 4 ? 0 : row.color + 1) : 1
    if (next === 0) {
      this.db.run(`DELETE FROM highlights WHERE book = ? AND chapter = ? AND verse = ?`, [v.book, v.chapter, v.verse])
    } else {
      this.db.run(
        `INSERT INTO highlights (book, chapter, verse, color, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (book, chapter, verse) DO UPDATE SET color = excluded.color`,
        [v.book, v.chapter, v.verse, next, at],
      )
    }
    return next
  }

  highlightsIn(book: number, chapter: number): Map<number, 1 | 2 | 3 | 4> {
    const rows = this.db
      .query<{ verse: number; color: 1 | 2 | 3 | 4 }, [number, number]>(
        `SELECT verse, color FROM highlights WHERE book = ? AND chapter = ?`,
      )
      .all(book, chapter)
    return new Map(rows.map((r) => [r.verse, r.color]))
  }

  bookmarksIn(book: number, chapter: number): Set<number> {
    const rows = this.db
      .query<{ verse: number }, [number, number]>(`SELECT verse FROM bookmarks WHERE book = ? AND chapter = ?`)
      .all(book, chapter)
    return new Set(rows.map((r) => r.verse))
  }

  saveNote(v: VerseKey, body: string, at = Date.now()) {
    if (!body.trim()) {
      this.db.run(`DELETE FROM notes WHERE book = ? AND chapter = ? AND verse = ?`, [v.book, v.chapter, v.verse])
      return
    }
    this.db.run(
      `INSERT INTO notes (book, chapter, verse, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (book, chapter, verse) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
      [v.book, v.chapter, v.verse, body, at, at],
    )
  }

  note(v: VerseKey): Note | undefined {
    const r = this.db
      .query<{ book: number; chapter: number; verse: number; body: string; created_at: number; updated_at: number }, [number, number, number]>(
        `SELECT * FROM notes WHERE book = ? AND chapter = ? AND verse = ?`,
      )
      .get(v.book, v.chapter, v.verse)
    return r ? { book: r.book, chapter: r.chapter, verse: r.verse, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at } : undefined
  }

  notesIn(book: number, chapter: number): Set<number> {
    const rows = this.db
      .query<{ verse: number }, [number, number]>(`SELECT verse FROM notes WHERE book = ? AND chapter = ?`)
      .all(book, chapter)
    return new Set(rows.map((r) => r.verse))
  }

  notes(): Note[] {
    return this.db
      .query<{ book: number; chapter: number; verse: number; body: string; created_at: number; updated_at: number }, []>(
        `SELECT * FROM notes ORDER BY updated_at DESC`,
      )
      .all()
      .map((r) => ({ book: r.book, chapter: r.chapter, verse: r.verse, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at }))
  }

  // chapter journal ------------------------------------------------------------

  journal(book: number, chapter: number): string {
    return (
      this.db
        .query<{ body: string }, [number, number]>(`SELECT body FROM journal WHERE book = ? AND chapter = ?`)
        .get(book, chapter)?.body ?? ""
    )
  }

  saveJournal(book: number, chapter: number, body: string, at = Date.now()) {
    if (!body.trim()) {
      this.db.run(`DELETE FROM journal WHERE book = ? AND chapter = ?`, [book, chapter])
      return
    }
    this.db.run(
      `INSERT INTO journal (book, chapter, body, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (book, chapter) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
      [book, chapter, body, at],
    )
  }

  journals(): { book: number; chapter: number; body: string; updatedAt: number }[] {
    return this.db
      .query<{ book: number; chapter: number; body: string; updated_at: number }, []>(`SELECT * FROM journal ORDER BY book, chapter`)
      .all()
      .map((r) => ({ book: r.book, chapter: r.chapter, body: r.body, updatedAt: r.updated_at }))
  }

  /** Every note and journal entry as one Markdown document, grouped by book. */
  exportMarkdown(bookName: (id: number) => string): string {
    const items = [
      ...this.journals().map((j) => ({ book: j.book, chapter: j.chapter, verse: 0, body: j.body })),
      ...this.notes().map((n) => ({ book: n.book, chapter: n.chapter, verse: n.verse, body: n.body })),
    ].sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse)
    const out: string[] = ["# Selah notes", ""]
    let lastBook = 0
    for (const it of items) {
      if (it.book !== lastBook) {
        out.push(`## ${bookName(it.book)}`, "")
        lastBook = it.book
      }
      out.push(it.verse ? `### ${bookName(it.book)} ${it.chapter}:${it.verse}` : `### ${bookName(it.book)} ${it.chapter} (journal)`, "", it.body.trim(), "")
    }
    return out.join("\n")
  }

  // position -----------------------------------------------------------------

  position(): Position | undefined {
    return this.get<Position | undefined>("position", undefined)
  }

  setPosition(p: Position) {
    this.set("position", p)
  }
}

function toSession(r: Record<string, number | string>): Session {
  return {
    id: r.id as number,
    day: r.day as string,
    book: r.book as number,
    chapter: r.chapter as number,
    translation: r.translation as string,
    startedAt: r.started_at as number,
    endedAt: r.ended_at as number,
    activeMs: r.active_ms as number,
  }
}
