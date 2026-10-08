import { Database } from "bun:sqlite"
import { BOOKS } from "./books"
import { paths } from "./paths"

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY,
  osis TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  testament TEXT NOT NULL CHECK (testament IN ('OT', 'NT')),
  grp TEXT NOT NULL,
  chapters INTEGER NOT NULL,
  aliases TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS translations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  year INTEGER NOT NULL,
  license TEXT NOT NULL,
  source TEXT NOT NULL,
  verse_count INTEGER NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verses (
  id INTEGER PRIMARY KEY,
  translation TEXT NOT NULL,
  book INTEGER NOT NULL REFERENCES books(id),
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL,
  UNIQUE (translation, book, chapter, verse)
);

CREATE TABLE IF NOT EXISTS chapter_stats (
  translation TEXT NOT NULL,
  book INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verses INTEGER NOT NULL,
  words INTEGER NOT NULL,
  PRIMARY KEY (translation, book, chapter)
) WITHOUT ROWID;

CREATE VIRTUAL TABLE IF NOT EXISTS verses_fts USING fts5(
  text,
  content = 'verses',
  content_rowid = 'id',
  tokenize = 'porter unicode61 remove_diacritics 2'
);
`

export function openBibleDb(file = paths.bibleDb): Database {
  const db = new Database(file, { create: true })
  db.exec(SCHEMA)
  const insert = db.prepare(
    `INSERT INTO books (id, osis, name, short, testament, grp, chapters, aliases)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET osis = excluded.osis, name = excluded.name, short = excluded.short,
       testament = excluded.testament, grp = excluded.grp, chapters = excluded.chapters, aliases = excluded.aliases`,
  )
  db.transaction(() => {
    for (const b of BOOKS) insert.run(b.id, b.osis, b.name, b.short, b.testament, b.group, b.chapters, b.aliases.join(","))
  })()
  return db
}
