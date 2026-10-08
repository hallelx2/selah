export type Testament = "OT" | "NT"

export interface Book {
  /** 1-based canonical position (Genesis = 1, Revelation = 66). */
  id: number
  osis: string
  name: string
  short: string
  testament: Testament
  chapters: number
  /** Lowercased spellings accepted by the reference parser, beyond the name and OSIS id. */
  aliases: string[]
  /** Section heading used by the book picker. */
  group: string
}

type Row = [osis: string, name: string, short: string, chapters: number, group: string, aliases: string[]]

const OT: Row[] = [
  ["Gen", "Genesis", "Gen", 50, "Law", ["ge", "gn", "gen"]],
  ["Exod", "Exodus", "Exod", 40, "Law", ["ex", "exo", "exod"]],
  ["Lev", "Leviticus", "Lev", 27, "Law", ["le", "lv", "lev"]],
  ["Num", "Numbers", "Num", 36, "Law", ["nu", "nm", "nb", "num"]],
  ["Deut", "Deuteronomy", "Deut", 34, "Law", ["dt", "de", "deu", "deut"]],
  ["Josh", "Joshua", "Josh", 24, "History", ["jos", "jsh", "josh"]],
  ["Judg", "Judges", "Judg", 21, "History", ["jdg", "jg", "jdgs", "judg"]],
  ["Ruth", "Ruth", "Ruth", 4, "History", ["ru", "rth", "rut"]],
  ["1Sam", "1 Samuel", "1 Sam", 31, "History", ["1sa", "1sm", "1sam", "1samuel"]],
  ["2Sam", "2 Samuel", "2 Sam", 24, "History", ["2sa", "2sm", "2sam", "2samuel"]],
  ["1Kgs", "1 Kings", "1 Kgs", 22, "History", ["1ki", "1kg", "1kgs", "1kings"]],
  ["2Kgs", "2 Kings", "2 Kgs", 25, "History", ["2ki", "2kg", "2kgs", "2kings"]],
  ["1Chr", "1 Chronicles", "1 Chr", 29, "History", ["1ch", "1chr", "1chron", "1chronicles"]],
  ["2Chr", "2 Chronicles", "2 Chr", 36, "History", ["2ch", "2chr", "2chron", "2chronicles"]],
  ["Ezra", "Ezra", "Ezra", 10, "History", ["ezr"]],
  ["Neh", "Nehemiah", "Neh", 13, "History", ["ne", "neh"]],
  ["Esth", "Esther", "Esth", 10, "History", ["es", "est", "esth"]],
  ["Job", "Job", "Job", 42, "Poetry", ["jb"]],
  ["Ps", "Psalms", "Ps", 150, "Poetry", ["ps", "psa", "psm", "pss", "psalm"]],
  ["Prov", "Proverbs", "Prov", 31, "Poetry", ["pr", "prv", "pro", "prov"]],
  ["Eccl", "Ecclesiastes", "Eccl", 12, "Poetry", ["ec", "ecc", "eccl", "eccles", "qoheleth"]],
  ["Song", "Song of Solomon", "Song", 8, "Poetry", ["so", "sos", "song", "songofsongs", "canticles", "ss"]],
  ["Isa", "Isaiah", "Isa", 66, "Major Prophets", ["is", "isa"]],
  ["Jer", "Jeremiah", "Jer", 52, "Major Prophets", ["je", "jr", "jer"]],
  ["Lam", "Lamentations", "Lam", 5, "Major Prophets", ["la", "lam"]],
  ["Ezek", "Ezekiel", "Ezek", 48, "Major Prophets", ["eze", "ezk", "ezek"]],
  ["Dan", "Daniel", "Dan", 12, "Major Prophets", ["da", "dn", "dan"]],
  ["Hos", "Hosea", "Hos", 14, "Minor Prophets", ["ho", "hos"]],
  ["Joel", "Joel", "Joel", 3, "Minor Prophets", ["jl", "joe"]],
  ["Amos", "Amos", "Amos", 9, "Minor Prophets", ["am", "amo"]],
  ["Obad", "Obadiah", "Obad", 1, "Minor Prophets", ["ob", "oba", "obad"]],
  ["Jonah", "Jonah", "Jonah", 4, "Minor Prophets", ["jnh", "jon"]],
  ["Mic", "Micah", "Mic", 7, "Minor Prophets", ["mi", "mc", "mic"]],
  ["Nah", "Nahum", "Nah", 3, "Minor Prophets", ["na", "nah"]],
  ["Hab", "Habakkuk", "Hab", 3, "Minor Prophets", ["hb", "hab"]],
  ["Zeph", "Zephaniah", "Zeph", 3, "Minor Prophets", ["zep", "zp", "zeph"]],
  ["Hag", "Haggai", "Hag", 2, "Minor Prophets", ["hg", "hag"]],
  ["Zech", "Zechariah", "Zech", 14, "Minor Prophets", ["zec", "zc", "zech"]],
  ["Mal", "Malachi", "Mal", 4, "Minor Prophets", ["ml", "mal"]],
]

const NT: Row[] = [
  ["Matt", "Matthew", "Matt", 28, "Gospels", ["mt", "mat", "matt"]],
  ["Mark", "Mark", "Mark", 16, "Gospels", ["mk", "mr", "mrk", "mar"]],
  ["Luke", "Luke", "Luke", 24, "Gospels", ["lk", "lu", "luk"]],
  ["John", "John", "John", 21, "Gospels", ["jn", "jhn", "joh"]],
  ["Acts", "Acts", "Acts", 28, "History", ["ac", "act"]],
  ["Rom", "Romans", "Rom", 16, "Pauline Epistles", ["ro", "rm", "rom"]],
  ["1Cor", "1 Corinthians", "1 Cor", 16, "Pauline Epistles", ["1co", "1cor", "1corinthians"]],
  ["2Cor", "2 Corinthians", "2 Cor", 13, "Pauline Epistles", ["2co", "2cor", "2corinthians"]],
  ["Gal", "Galatians", "Gal", 6, "Pauline Epistles", ["ga", "gal"]],
  ["Eph", "Ephesians", "Eph", 6, "Pauline Epistles", ["ep", "eph", "ephes"]],
  ["Phil", "Philippians", "Phil", 4, "Pauline Epistles", ["php", "pp", "phil"]],
  ["Col", "Colossians", "Col", 4, "Pauline Epistles", ["co", "col"]],
  ["1Thess", "1 Thessalonians", "1 Thess", 5, "Pauline Epistles", ["1th", "1thes", "1thess", "1thessalonians"]],
  ["2Thess", "2 Thessalonians", "2 Thess", 3, "Pauline Epistles", ["2th", "2thes", "2thess", "2thessalonians"]],
  ["1Tim", "1 Timothy", "1 Tim", 6, "Pauline Epistles", ["1ti", "1tim", "1timothy"]],
  ["2Tim", "2 Timothy", "2 Tim", 4, "Pauline Epistles", ["2ti", "2tim", "2timothy"]],
  ["Titus", "Titus", "Titus", 3, "Pauline Epistles", ["ti", "tit"]],
  ["Phlm", "Philemon", "Phlm", 1, "Pauline Epistles", ["phm", "phlm", "philem"]],
  ["Heb", "Hebrews", "Heb", 13, "General Epistles", ["he", "heb"]],
  ["Jas", "James", "Jas", 5, "General Epistles", ["jm", "jas", "jam"]],
  ["1Pet", "1 Peter", "1 Pet", 5, "General Epistles", ["1pe", "1pt", "1pet", "1peter"]],
  ["2Pet", "2 Peter", "2 Pet", 3, "General Epistles", ["2pe", "2pt", "2pet", "2peter"]],
  ["1John", "1 John", "1 John", 5, "General Epistles", ["1jn", "1jo", "1joh", "1jhn", "1john"]],
  ["2John", "2 John", "2 John", 1, "General Epistles", ["2jn", "2jo", "2joh", "2jhn", "2john"]],
  ["3John", "3 John", "3 John", 1, "General Epistles", ["3jn", "3jo", "3joh", "3jhn", "3john"]],
  ["Jude", "Jude", "Jude", 1, "General Epistles", ["jd", "jud"]],
  ["Rev", "Revelation", "Rev", 22, "Prophecy", ["re", "rv", "rev", "revelations", "apocalypse"]],
]

export const BOOKS: readonly Book[] = [...OT.map((r) => [r, "OT"] as const), ...NT.map((r) => [r, "NT"] as const)].map(
  ([[osis, name, short, chapters, group, aliases], testament], i) => ({
    id: i + 1,
    osis,
    name,
    short,
    testament,
    chapters,
    aliases,
    group,
  }),
)

export const TOTAL_CHAPTERS = BOOKS.reduce((sum, b) => sum + b.chapters, 0)

export function bookById(id: number): Book {
  const book = BOOKS[id - 1]
  if (!book) throw new Error(`No book with id ${id}`)
  return book
}

/** Chapters as a flat canonical sequence; index 0 is Genesis 1. */
export interface ChapterKey {
  book: number
  chapter: number
}

export const ALL_CHAPTERS: readonly ChapterKey[] = BOOKS.flatMap((b) =>
  Array.from({ length: b.chapters }, (_, i) => ({ book: b.id, chapter: i + 1 })),
)

export function chapterIndex(book: number, chapter: number): number {
  let index = 0
  for (const b of BOOKS) {
    if (b.id === book) return index + chapter - 1
    index += b.chapters
  }
  return -1
}

export function nextChapter(key: ChapterKey): ChapterKey | undefined {
  return ALL_CHAPTERS[chapterIndex(key.book, key.chapter) + 1]
}

export function prevChapter(key: ChapterKey): ChapterKey | undefined {
  const i = chapterIndex(key.book, key.chapter)
  return i > 0 ? ALL_CHAPTERS[i - 1] : undefined
}
