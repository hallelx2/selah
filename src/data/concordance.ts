import type { Database } from "bun:sqlite"
import { BOOKS } from "./books"

/**
 * The original-language text and Strong's concordance, from STEPBible-Data (Tyndale House,
 * Cambridge; CC BY 4.0), pinned to one commit so imports are reproducible:
 *
 * - TAHOT: every word of the Hebrew Old Testament (Leningrad codex), split into its prefixes,
 *   root and suffixes, with transliteration, an English gloss, extended Strong's numbers and
 *   morphology.
 * - TAGNT: every word of the Greek New Testament, amalgamated across editions (NA27/28, the
 *   Textus Receptus behind the KJV, and others) with which editions carry each word.
 * - TBESH / TBESG: brief lexicons keyed by extended Strong's number.
 */
export const STEP_COMMIT = "aca7d691414e00b0d669157d98bfd68195e64e1e"
export const STEP_ATTRIBUTION =
  "Hebrew and Greek words, Strong's numbers and lexicons from STEPBible.org (Tyndale House, Cambridge): TAHOT, TAGNT, TBESH and TBESG, CC BY 4.0."

const AMALGAMATED = "Translators Amalgamated OT+NT"
export const STEP_FILES: { name: string; path: string; bytes: number }[] = [
  { name: "TAHOT_Gen-Deu.txt", path: `${AMALGAMATED}/TAHOT Gen-Deu - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt`, bytes: 18_190_455 },
  { name: "TAHOT_Jos-Est.txt", path: `${AMALGAMATED}/TAHOT Jos-Est - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt`, bytes: 24_500_317 },
  { name: "TAHOT_Job-Sng.txt", path: `${AMALGAMATED}/TAHOT Job-Sng - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt`, bytes: 9_540_623 },
  { name: "TAHOT_Isa-Mal.txt", path: `${AMALGAMATED}/TAHOT Isa-Mal - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt`, bytes: 17_977_518 },
  { name: "TAGNT_Mat-Jhn.txt", path: `${AMALGAMATED}/TAGNT Mat-Jhn - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt`, bytes: 14_189_032 },
  { name: "TAGNT_Act-Rev.txt", path: `${AMALGAMATED}/TAGNT Act-Rev - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt`, bytes: 15_939_932 },
  { name: "TBESH_-.txt", path: "Lexicons/TBESH - Translators Brief lexicon of Extended Strongs for Hebrew - STEPBible.org CC BY.txt", bytes: 3_288_045 },
  { name: "TBESG_-.txt", path: "Lexicons/TBESG - Translators Brief lexicon of Extended Strongs for Greek - STEPBible.org CC BY.txt", bytes: 4_736_912 },
]
export const stepUrl = (path: string) => `https://raw.githubusercontent.com/STEPBible/STEPBible-Data/${STEP_COMMIT}/${path.split("/").map(encodeURIComponent).join("/")}`

/** STEPBible's book codes, in canonical order (index + 1 = Selah's book id). */
const STEP_BOOKS =
  "Gen Exo Lev Num Deu Jos Jdg Rut 1Sa 2Sa 1Ki 2Ki 1Ch 2Ch Ezr Neh Est Job Psa Pro Ecc Sng Isa Jer Lam Ezk Dan Hos Jol Amo Oba Jon Mic Nam Hab Zep Hag Zec Mal Mat Mrk Luk Jhn Act Rom 1Co 2Co Gal Eph Php Col 1Th 2Th 1Ti 2Ti Tit Phm Heb Jas 1Pe 2Pe 1Jn 2Jn 3Jn Jud Rev".split(" ")
const BOOK_OF = new Map(STEP_BOOKS.map((code, i) => [code, i + 1]))
if (STEP_BOOKS.length !== BOOKS.length) throw new Error("STEPBible book table out of step with books.ts")

export const CONCORDANCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY,
  book INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  -- English versification; 0 is a psalm's title, which English Bibles leave unnumbered
  verse INTEGER NOT NULL,
  position INTEGER NOT NULL,
  original TEXT NOT NULL,
  translit TEXT NOT NULL,
  gloss TEXT NOT NULL,
  -- the word's main Strong's number, e.g. H7225 or G0025, and STEPBible's extended form (H7225G)
  strongs TEXT NOT NULL,
  dstrong TEXT NOT NULL,
  -- every morpheme's number, e.g. "H9003/{H7225G}" (prefix "in" + "beginning")
  parts TEXT NOT NULL,
  grammar TEXT NOT NULL,
  -- which texts carry the word: OT "L" (Leningrad), "Q" (read), "X" (not in Leningrad);
  -- NT editions N (Nestle-Aland), K (the KJV's Textus Receptus), O (others); lower case = minor
  editions TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS words_verse ON words (book, chapter, verse, position);
CREATE INDEX IF NOT EXISTS words_strongs ON words (strongs, book, chapter, verse);
CREATE TABLE IF NOT EXISTS lexicon (
  dstrong TEXT PRIMARY KEY,
  strongs TEXT NOT NULL,
  lemma TEXT NOT NULL,
  translit TEXT NOT NULL,
  morph TEXT NOT NULL,
  gloss TEXT NOT NULL,
  definition TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lexicon_strongs ON lexicon (strongs);
`

/** "H7225G", "G25", "{H1254A}" → "H7225", "G0025", "H1254". */
export function baseStrongs(s: string): string {
  const m = /([HG])0*(\d+)/i.exec(s)
  return m ? `${m[1]!.toUpperCase()}${m[2]!.padStart(4, "0")}` : ""
}

/** The extended number, normalised: "{H7225G}" → "H7225G", "G25" → "G0025". */
export function extendedStrongs(s: string): string {
  const m = /([HG])0*(\d+)([A-Za-z]?)/i.exec(s)
  return m ? `${m[1]!.toUpperCase()}${m[2]!.padStart(4, "0")}${m[3] ?? ""}` : ""
}

export interface ParsedWord {
  book: number
  chapter: number
  verse: number
  position: number
  original: string
  translit: string
  gloss: string
  strongs: string
  dstrong: string
  parts: string
  grammar: string
  editions: string
}

/**
 * "Gen.1.1#01=L", "Psa.3.0(3.1)#01=L" (Hebrew numbering in round brackets), and in the NT
 * "2Co.13.13[13.14]#01=NKO": TAGNT numbers verses as the NRSV does and gives the KJV's
 * numbering in square brackets (NA's in round, others' in curly), and Selah's texts follow the
 * KJV's.
 */
const REF = /^([1-3A-Z][A-Za-z0-9]{2})\.(\d+)\.(\d+)((?:[[({][\d.]+[\])}])*)#(\d+)=(\S*)$/

/**
 * One TAHOT or TAGNT word row, or undefined for headers, notes and verse lines. Text is
 * normalised to NFC: the sources mix forms (Greek U+1F71 for U+03AC, Hebrew points in
 * non-canonical order), and equal-looking words must compare equal.
 */
export function parseWordLine(line: string): ParsedWord | undefined {
  const cols = line.normalize("NFC").split("\t")
  const ref = REF.exec(cols[0]?.trim() ?? "")
  if (!ref) return
  const book = BOOK_OF.get(ref[1]!)
  if (!book) return
  const kjv = /\[(\d+)\.(\d+)\]/.exec(ref[4]!)
  const at = {
    book,
    chapter: Number(kjv?.[1] ?? ref[2]),
    verse: Number(kjv?.[2] ?? ref[3]),
    position: Number(ref[5]),
    editions: ref[6]!,
  }
  if (book <= 39) {
    // Ref, Hebrew, Transliteration, Translation, dStrongs, Grammar, …
    const parts = (cols[4] ?? "").trim()
    // "/" joins prefixes and suffixes, "\\" attaches punctuation (H9016 is sof pasuq)
    const main = /\{([^}]+)\}/.exec(parts)?.[1] ?? parts.split(/[/\\]/).find((p) => !/^H9\d{3}/.test(p)) ?? parts
    return {
      ...at,
      original: (cols[1] ?? "").replace(/[/\\]/g, "").trim(),
      translit: (cols[2] ?? "").replace(/[/.]/g, "").trim().toLowerCase(),
      gloss: (cols[3] ?? "").replace(/\s*\/\s*/g, " ").replace(/\s+/g, " ").trim(),
      strongs: baseStrongs(main),
      dstrong: extendedStrongs(main),
      parts,
      grammar: (cols[5] ?? "").trim(),
    }
  }
  // Ref, Greek (translit), English, dStrongs=Grammar, Dictionary=Gloss, editions, …
  const greek = /^(.*?)\s*\(([^)]*)\)\s*$/.exec((cols[1] ?? "").trim())
  const [num = "", grammar = ""] = (cols[3] ?? "").split("=")
  return {
    ...at,
    original: (greek?.[1] ?? cols[1] ?? "").trim(),
    translit: (greek?.[2] ?? "").trim(),
    gloss: (cols[2] ?? "").trim(),
    strongs: baseStrongs(num),
    dstrong: extendedStrongs(num),
    parts: num.trim(),
    grammar: grammar.trim(),
  }
}

export interface LexiconEntry {
  dstrong: string
  strongs: string
  lemma: string
  translit: string
  morph: string
  gloss: string
  /** Lightly marked up for <Inline>: **bold**, *italic*, line breaks. */
  definition: string
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }

/** TBES definitions are HTML fragments; Selah renders **bold**, *italic* and line breaks. */
export function lexiconText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:b|strong)>/gi, "**")
    .replace(/<\/?(?:i|em)>/gi, "*")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|\w+);/g, (m, e: string) => (e.startsWith("#") ? String.fromCodePoint(Number(e.slice(1))) : (ENTITIES[e] ?? m)))
    .replace(/\*\*\s*\*\*/g, "")
    .replace(/__/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** One TBESH or TBESG row: eStrong, dStrong label, uStrong, lemma, translit, morph, gloss, definition. */
export function parseLexiconLine(line: string): LexiconEntry | undefined {
  if (!/^[HG]\d{4}[A-Za-z]?\t/.test(line)) return
  const c = line.normalize("NFC").split("\t")
  const dstrong = extendedStrongs((c[1] ?? "").split(/\s/)[0] ?? "") || extendedStrongs(c[0]!)
  return {
    dstrong,
    strongs: baseStrongs(c[0]!),
    lemma: (c[3] ?? "").trim(),
    translit: (c[4] ?? "").replace(/\./g, "").trim(),
    morph: (c[5] ?? "").trim(),
    gloss: (c[6] ?? "").trim(),
    definition: lexiconText(c[7] ?? ""),
  }
}

export function importConcordance(db: Database, files: Iterable<{ name: string; text: string }>): { words: number; entries: number; verses: number } {
  db.exec(CONCORDANCE_SCHEMA)
  const insertWord = db.prepare(
    `INSERT INTO words (book, chapter, verse, position, original, translit, gloss, strongs, dstrong, parts, grammar, editions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertEntry = db.prepare(`INSERT OR REPLACE INTO lexicon (dstrong, strongs, lemma, translit, morph, gloss, definition) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  let words = 0
  let entries = 0
  const verses = new Set<string>()
  db.transaction(() => {
    db.run(`DELETE FROM words`)
    db.run(`DELETE FROM lexicon`)
    for (const f of files) {
      const lexicon = /^TBES/.test(f.name)
      for (const line of f.text.split("\n")) {
        if (lexicon) {
          const e = parseLexiconLine(line)
          if (!e) continue
          insertEntry.run(e.dstrong, e.strongs, e.lemma, e.translit, e.morph, e.gloss, e.definition)
          entries++
        } else {
          const w = parseWordLine(line)
          if (!w) continue
          insertWord.run(w.book, w.chapter, w.verse, w.position, w.original, w.translit, w.gloss, w.strongs, w.dstrong, w.parts, w.grammar, w.editions)
          verses.add(`${w.book}.${w.chapter}.${w.verse}`)
          words++
        }
      }
    }
  })()
  return { words, entries, verses: verses.size }
}

export interface Word extends Omit<ParsedWord, "book" | "chapter"> {
  /** false when the word is not in the text the reader's translation follows */
  inText: boolean
}

/** Which source text a translation follows, for marking words it does not have. */
export function textBase(translation: string): "TR" | "critical" {
  return ["KJV", "YLT"].includes(translation.toUpperCase()) ? "TR" : "critical"
}

export function inText(editions: string, book: number, base: "TR" | "critical"): boolean {
  if (book <= 39) return !/^X/.test(editions)
  return base === "TR" ? /k/i.test(editions) : /n/i.test(editions)
}

export interface Occurrence {
  book: number
  chapter: number
  verse: number
  /** the forms used in that verse, without punctuation, e.g. "ἠγάπησεν" or "ἀγάπη, ἀγάπης" */
  forms: string
}

/** A word as a form: its letters and marks only, without the text's punctuation or ¶. */
export const bareForm = (s: string) => s.replace(/[^\p{L}\p{M}]/gu, "")

export class Concordance {
  constructor(readonly db: Database) {
    db.exec(CONCORDANCE_SCHEMA)
  }

  get installed(): boolean {
    return !!this.db.query(`SELECT 1 FROM words LIMIT 1`).get() && !!this.db.query(`SELECT 1 FROM lexicon LIMIT 1`).get()
  }

  /** The words of one verse in order; a psalm's verse 1 includes its title (verse 0) first. */
  verse(book: number, chapter: number, verse: number, translation = "KJV"): Word[] {
    const base = textBase(translation)
    const rows = this.db
      .query<ParsedWord, [number, number, number, number]>(
        `SELECT book, chapter, verse, position, original, translit, gloss, strongs, dstrong, parts, grammar, editions FROM words
         WHERE book = ? AND chapter = ? AND verse IN (?, ?) ORDER BY verse, position`,
      )
      .all(book, chapter, verse, verse === 1 ? 0 : verse)
    return rows.map(({ book: b, chapter: _c, ...w }) => ({ ...w, inText: inText(w.editions, b, base) }))
  }

  /** The lexicon entry for an extended number, or the first entry for its base number. */
  entry(strongs: string): LexiconEntry | undefined {
    const d = extendedStrongs(strongs)
    const q = `SELECT dstrong, strongs, lemma, translit, morph, gloss, definition FROM lexicon`
    return (
      this.db.query<LexiconEntry, [string]>(`${q} WHERE dstrong = ?`).get(d) ??
      this.db.query<LexiconEntry, [string]>(`${q} WHERE strongs = ? ORDER BY dstrong LIMIT 1`).get(baseStrongs(strongs)) ??
      undefined
    )
  }

  /** How often a number occurs (words, not verses), and in how many verses. */
  count(strongs: string, book?: number): { words: number; verses: number } {
    // psalm titles count with verse 1, as occurrences() lists them
    const r = this.db
      .query<{ words: number; verses: number }, [string, number]>(
        `SELECT count(*) AS words, count(DISTINCT book * 1000000 + chapter * 1000 + max(verse, 1)) AS verses FROM words WHERE strongs = ?1 AND (?2 = 0 OR book = ?2)`,
      )
      .get(baseStrongs(strongs), book ?? 0)
    return r ?? { words: 0, verses: 0 }
  }

  /** Occurrences per book, in canonical order. */
  perBook(strongs: string): { book: number; count: number }[] {
    return this.db
      .query<{ book: number; count: number }, [string]>(`SELECT book, count(*) AS count FROM words WHERE strongs = ? GROUP BY book ORDER BY book`)
      .all(baseStrongs(strongs))
  }

  /** Every verse using a number, in canonical order; psalm titles count as verse 1. */
  occurrences(strongs: string, opts: { book?: number; limit?: number; offset?: number } = {}): Occurrence[] {
    const where = opts.book ? `AND book = ${Number(opts.book)}` : ""
    // char(31) separates forms: the words themselves can carry commas
    return this.db
      .query<Occurrence, [string, number, number]>(
        `SELECT book, chapter, max(verse, 1) AS verse, group_concat(original, char(31)) AS forms FROM words
         WHERE strongs = ? ${where} GROUP BY book, chapter, max(verse, 1) ORDER BY book, chapter, max(verse, 1) LIMIT ? OFFSET ?`,
      )
      .all(baseStrongs(strongs), opts.limit ?? 10_000, opts.offset ?? 0)
      .map((o) => ({ ...o, forms: [...new Set(o.forms.split("\x1f").map(bareForm).filter(Boolean))].join(", ") }))
  }
}

export type ConcordanceProgress = (e: { phase: "download" | "import"; fraction: number; file?: string }) => void

/** Downloads (or reuses the cached) pinned STEPBible files, then imports them into study.db. */
export async function installConcordance(db: Database, cacheDir: string, onProgress?: ConcordanceProgress, fetcher: typeof fetch = fetch) {
  const { join } = await import("node:path")
  const { existsSync, mkdirSync, renameSync, statSync } = await import("node:fs")
  const dir = join(cacheDir, `stepbible-${STEP_COMMIT.slice(0, 12)}`)
  mkdirSync(dir, { recursive: true })
  const total = STEP_FILES.reduce((n, f) => n + f.bytes, 0)
  let done = 0
  for (const f of STEP_FILES) {
    const file = join(dir, f.name)
    if (existsSync(file) && statSync(file).size === f.bytes) {
      done += f.bytes
      onProgress?.({ phase: "download", fraction: done / total, file: f.name })
      continue
    }
    const res = await fetcher(stepUrl(f.path))
    if (!res.ok || !res.body) throw new Error(`Download of ${f.name} failed: HTTP ${res.status}`)
    const chunks: Uint8Array[] = []
    let got = 0
    for await (const chunk of res.body) {
      chunks.push(chunk)
      got += chunk.length
      onProgress?.({ phase: "download", fraction: (done + Math.min(got, f.bytes)) / total, file: f.name })
    }
    const data = Buffer.concat(chunks)
    // a pinned commit never changes, so a different size is a broken download, not an update
    if (data.length !== f.bytes) throw new Error(`Download of ${f.name} was ${data.length} bytes, expected ${f.bytes}`)
    const tmp = `${file}.${process.pid}.part`
    await Bun.write(tmp, data)
    renameSync(tmp, file)
    done += f.bytes
  }
  onProgress?.({ phase: "import", fraction: 0 })
  const files = await Promise.all(STEP_FILES.map(async (f) => ({ name: f.name, text: await Bun.file(join(dir, f.name)).text() })))
  const stats = importConcordance(db, files)
  onProgress?.({ phase: "import", fraction: 1 })
  return stats
}
