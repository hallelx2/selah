import { describe, expect, test } from "bun:test"
import { formatRef, parseRef, type Ref } from "../src/data/ref"
import { BOOKS, TOTAL_CHAPTERS } from "../src/data/books"

const cases: [string, Ref][] = [
  ["john 3:16", { book: 43, chapter: 3, verseStart: 16, verseEnd: 16 }],
  ["jn 3:16", { book: 43, chapter: 3, verseStart: 16, verseEnd: 16 }],
  ["Jn3:16", { book: 43, chapter: 3, verseStart: 16, verseEnd: 16 }],
  ["John 3", { book: 43, chapter: 3 }],
  ["john", { book: 43, chapter: 1 }],
  ["1 Cor 13:4-7", { book: 46, chapter: 13, verseStart: 4, verseEnd: 7 }],
  ["1cor 13:4–7", { book: 46, chapter: 13, verseStart: 4, verseEnd: 7 }],
  ["I Corinthians 13", { book: 46, chapter: 13 }],
  ["first corinthians 13", { book: 46, chapter: 13 }],
  ["1jn 4:8", { book: 62, chapter: 4, verseStart: 8, verseEnd: 8 }],
  ["I John 4.8", { book: 62, chapter: 4, verseStart: 8, verseEnd: 8 }],
  ["1st John 1", { book: 62, chapter: 1 }],
  ["iii john 1:2", { book: 64, chapter: 1, verseStart: 2, verseEnd: 2 }],
  ["Song of Songs 2", { book: 22, chapter: 2 }],
  ["song of solomon 2:1", { book: 22, chapter: 2, verseStart: 1, verseEnd: 1 }],
  ["Ps 23", { book: 19, chapter: 23 }],
  ["psalm 119:105", { book: 19, chapter: 119, verseStart: 105, verseEnd: 105 }],
  ["gen 1:1", { book: 1, chapter: 1, verseStart: 1, verseEnd: 1 }],
  ["Rev 22:21", { book: 66, chapter: 22, verseStart: 21, verseEnd: 21 }],
  ["revelation of john 1", { book: 66, chapter: 1 }],
  ["phil 4:13", { book: 50, chapter: 4, verseStart: 13, verseEnd: 13 }],
  ["phlm 1", { book: 57, chapter: 1 }],
  // single-chapter books accept a bare verse number
  ["jude 3", { book: 65, chapter: 1, verseStart: 3, verseEnd: 3 }],
  ["obadiah 1:4", { book: 31, chapter: 1, verseStart: 4, verseEnd: 4 }],
  ["  ROMANS   8 : 28  ", { book: 45, chapter: 8, verseStart: 28, verseEnd: 28 }],
]

describe("parseRef", () => {
  for (const [input, expected] of cases) {
    test(JSON.stringify(input), () => expect(parseRef(input)).toEqual(expected))
  }

  for (const bad of ["", "foo 99", "john 22", "gen 51:1", "hello world", "3:16", "ps 0", "rev 22:4-2"]) {
    test(`rejects ${JSON.stringify(bad)}`, () => expect(parseRef(bad)).toBeNull())
  }

  test("every book name, OSIS id and alias resolves to its own book", () => {
    for (const book of BOOKS) {
      for (const spelling of [book.name, book.osis, book.short, ...book.aliases]) {
        expect(parseRef(`${spelling} 1`)?.book).toBe(book.id)
      }
    }
  })

  test("the canon has 1189 chapters", () => expect(TOTAL_CHAPTERS).toBe(1189))
})

describe("formatRef", () => {
  test("formats each shape", () => {
    expect(formatRef({ book: 43, chapter: 3, verseStart: 16, verseEnd: 16 })).toBe("John 3:16")
    expect(formatRef({ book: 46, chapter: 13, verseStart: 4, verseEnd: 7 })).toBe("1 Corinthians 13:4–7")
    expect(formatRef({ book: 19, chapter: 23 })).toBe("Psalms 23")
    expect(formatRef({ book: 19, chapter: 23 }, { short: true })).toBe("Ps 23")
  })

  test("round-trips every parsed case", () => {
    for (const [input] of cases) {
      const ref = parseRef(input)!
      expect(parseRef(formatRef(ref))).toEqual(ref)
    }
  })
})
