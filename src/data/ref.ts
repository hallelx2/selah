import { BOOKS, bookById, type Book } from "./books"

export interface Ref {
  book: number
  chapter: number
  verseStart?: number
  verseEnd?: number
}

/** The longest chapter in the canon is Psalm 119, with 176 verses. */
const MAX_VERSE = 176

const normalize = (s: string) => s.toLowerCase().replace(/[\s.]/g, "")

const lookup = new Map<string, Book>()
for (const book of BOOKS) {
  for (const spelling of [book.name, book.osis, book.short, ...book.aliases]) lookup.set(normalize(spelling), book)
}
lookup.set("revelationofjohn", bookById(66))

const ORDINALS: [RegExp, string][] = [
  [/^(?:iii|3rd|third)\s+/, "3"],
  [/^(?:ii|2nd|second)\s+/, "2"],
  [/^(?:i|1st|first)\s+/, "1"],
]

/** Resolves a book spelling: exact name, OSIS id or alias first, then a unique prefix of a name. */
export function findBook(input: string): Book | undefined {
  let text = input.trim().toLowerCase()
  for (const [pattern, digit] of ORDINALS) text = text.replace(pattern, digit)
  const key = normalize(text)
  if (!key) return undefined
  const exact = lookup.get(key)
  if (exact) return exact
  if (key.length < 3) return undefined
  const matches = BOOKS.filter((b) => normalize(b.name).startsWith(key))
  return matches.length === 1 ? matches[0] : undefined
}

const PATTERN = /^\s*(\d?\s*[a-z][a-z\s.]*?)\s*(?:(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–—]\s*(\d+))?)?)?\s*$/i

/** Parses "jn 3:16", "1 Cor 13:4-7", "Song of Songs 2", "jude 3". Returns null for anything that is not a real reference. */
export function parseRef(input: string): Ref | null {
  let text = input.trim().toLowerCase()
  for (const [pattern, digit] of ORDINALS) text = text.replace(pattern, digit)
  const m = PATTERN.exec(text)
  if (!m) return null
  const book = findBook(m[1]!)
  if (!book) return null

  const a = m[2] ? Number(m[2]) : undefined
  const b = m[3] ? Number(m[3]) : undefined
  const c = m[4] ? Number(m[4]) : undefined

  if (a === undefined) return { book: book.id, chapter: 1 }

  // In a one-chapter book, "jude 3" means verse 3.
  if (book.chapters === 1 && b === undefined && a > 1) {
    return a <= MAX_VERSE ? { book: book.id, chapter: 1, verseStart: a, verseEnd: a } : null
  }

  if (a < 1 || a > book.chapters) return null
  if (b === undefined) return { book: book.id, chapter: a }
  const end = c ?? b
  if (b < 1 || b > MAX_VERSE || end < b || end > MAX_VERSE) return null
  return { book: book.id, chapter: a, verseStart: b, verseEnd: end }
}

export function formatRef(ref: Ref, opts: { short?: boolean } = {}): string {
  const book = bookById(ref.book)
  const name = opts.short ? book.short : book.name
  let out = `${name} ${ref.chapter}`
  if (ref.verseStart !== undefined) {
    out += `:${ref.verseStart}`
    if (ref.verseEnd !== undefined && ref.verseEnd !== ref.verseStart) out += `–${ref.verseEnd}`
  }
  return out
}

/**
 * What a person types to get somewhere: a reference, optionally after a verb they might reach
 * for ("resume luke 21", "go to john 3", "open ps 23", "read romans 8").
 */
const VERBS = /^\s*(?:resume|continue|go\s+to|goto|go|open|read|show(?:\s+me)?|turn\s+to|jump\s+to|take\s+me\s+to)\s+/i
export function parseGoTo(input: string): Ref | null {
  return parseRef(input) ?? (VERBS.test(input) ? parseRef(input.replace(VERBS, "")) : null)
}
