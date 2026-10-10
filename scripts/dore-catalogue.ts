// Builds src/data/scenes.json from Project Gutenberg #8710, The Doré Bible Gallery (public
// domain): every plate's title, the passage it shows, the scripture the gallery prints with it,
// the gallery's description, and the image's size and SHA-256 so installs can be verified.
//
// Run: bun scripts/dore-catalogue.ts            (downloads the pinned page and the 100 plates)
//      bun scripts/dore-catalogue.ts --check    (fails if the committed catalogue is out of date)
//
// The page is pinned by hash: if Gutenberg ever regenerates it, this script stops rather than
// silently producing a different catalogue.
import { createHash } from "node:crypto"
import { BOOKS } from "../src/data/books"
import { findBook } from "../src/data/ref"

const PAGE = "https://www.gutenberg.org/cache/epub/8710/pg8710-images.html"
const PAGE_SHA256 = "bab94881350e7975587e356e69e583fae4b8ed17f316c8e44ed78094a10f8a6c"
const IMAGES = "https://www.gutenberg.org/cache/epub/8710/images/"
const OUT = "src/data/scenes.json"

/** verseEnd null: the whole chapter (the caption cites only "Genesis xxiii.") */
type Ref = { book: number; chapter: number; verseStart: number; verseEnd: number | null }

/**
 * Plates whose caption cites no passage, cites it in prose, or whose parsed citation is wrong.
 * Each was read against the plate's own caption and the text of the passage. Plates from the
 * Apocrypha (Bel and the Dragon, 2 Maccabees) have no passage in Selah's 66 books: null.
 */
const OVERRIDES: Record<string, Ref | null> = {
  "001": { book: 1, chapter: 2, verseStart: 21, verseEnd: 23 }, // Creation of Eve; caption "Genesis ii, 18, 21-24"
  "007": { book: 1, chapter: 18, verseStart: 1, verseEnd: 8 }, // Abraham and the three strangers; the caption ends citing Hebrews xiii, 2
  "071": { book: 41, chapter: 12, verseStart: 41, verseEnd: 44 }, // The widow's mite
  "075": { book: 42, chapter: 15, verseStart: 11, verseEnd: 32 }, // The prodigal son
  "093": { book: 42, chapter: 24, verseStart: 50, verseEnd: 53 }, // The Ascension
  "011": { book: 1, chapter: 22, verseStart: 1, verseEnd: 13 }, // The trial of the faith of Abraham
  "023": { book: 7, chapter: 11, verseStart: 34, verseEnd: 35 }, // Jephthah met by his daughter
  "025": { book: 7, chapter: 14, verseStart: 5, verseEnd: 6 }, // Samson slaying the lion
  "026": { book: 7, chapter: 16, verseStart: 4, verseEnd: 20 }, // Samson and Delilah
  "027": { book: 7, chapter: 16, verseStart: 21, verseEnd: 30 }, // Death of Samson
  "031": { book: 9, chapter: 18, verseStart: 1, verseEnd: 11 }, // Saul and David (David plays before Saul)
  "032": { book: 9, chapter: 24, verseStart: 1, verseEnd: 22 }, // David sparing Saul: 1 Samuel, the caption's "II" is the gallery's slip
  "033": { book: 9, chapter: 31, verseStart: 1, verseEnd: 6 }, // Death of Saul
  "035": { book: 10, chapter: 18, verseStart: 19, verseEnd: 33 }, // David mourning over Absalom
  "036": { book: 11, chapter: 3, verseStart: 5, verseEnd: 15 }, // Solomon (his dream at Gibeon)
  "037": { book: 11, chapter: 3, verseStart: 16, verseEnd: 28 }, // Judgment of Solomon
  "039": { book: 11, chapter: 13, verseStart: 11, verseEnd: 32 }, // The prophet slain by a lion
  "041": { book: 12, chapter: 2, verseStart: 1, verseEnd: 12 }, // Elijah's ascent
  "044": { book: 23, chapter: 6, verseStart: 1, verseEnd: 8 }, // Isaiah (his call)
  "046": { book: 24, chapter: 36, verseStart: 4, verseEnd: 8 }, // Baruch writes Jeremiah's words
  "047": { book: 26, chapter: 1, verseStart: 1, verseEnd: 3 }, // Ezekiel prophesying
  "049": { book: 27, chapter: 1, verseStart: 3, verseEnd: 7 }, // Daniel
  "053": { book: 30, chapter: 7, verseStart: 14, verseEnd: 15 }, // Amos
  "055": null, // Daniel confounding the priests of Bel: Bel and the Dragon (Apocrypha)
  "056": null, // Heliodorus punished in the temple: 2 Maccabees iii (Apocrypha)
  "057": { book: 42, chapter: 2, verseStart: 1, verseEnd: 7 }, // The Nativity
  "058": { book: 40, chapter: 2, verseStart: 1, verseEnd: 2 }, // The star in the east
  "061": { book: 42, chapter: 2, verseStart: 41, verseEnd: 50 }, // Jesus questioning the doctors
  "063": { book: 40, chapter: 5, verseStart: 1, verseEnd: 12 }, // Sermon on the Mount
  "069": { book: 40, chapter: 21, verseStart: 1, verseEnd: 11 }, // Entry into Jerusalem
  "078": { book: 43, chapter: 4, verseStart: 5, verseEnd: 26 }, // The woman of Samaria
  "081": { book: 42, chapter: 7, verseStart: 36, verseEnd: 50 }, // Mary Magdalene (the gallery reads Luke vii as her)
  "086": { book: 42, chapter: 23, verseStart: 26, verseEnd: 31 }, // Christ fainting under the cross (Simon bears it)
  "094": { book: 44, chapter: 7, verseStart: 54, verseEnd: 60 }, // Martyrdom of Stephen
  "099": { book: 44, chapter: 27, verseStart: 39, verseEnd: 44 }, // Paul's shipwreck
  "100": { book: 66, chapter: 6, verseStart: 7, verseEnd: 8 }, // Death on the pale horse
}

const SMALL = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "into", "of", "on", "the", "to", "under", "with"])
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.]$/, "")
    .replace(/,(?=\s*jesus)/, "") // "PRAYER OF, JESUS" in the source
    .replace(/\bof'(?=\s)/, "of") // "GARDEN OF' OLIVES" in the source
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/^(\p{L})/u, (c) => c.toUpperCase()).replace(/-(\p{L})/gu, (_, c: string) => `-${c.toUpperCase()}`)))
    .join(" ")
}

const roman = (r: string) => {
  const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 }
  let n = 0
  const s = r.toLowerCase()
  for (let i = 0; i < s.length; i++) {
    const a = v[s[i]!]!
    const b = v[s[i + 1]!] ?? 0
    n += a < b ? -a : a
  }
  return n
}

const REFEND = /—?\s*((?:I{1,3}|[1-3])?\s?[A-Za-z]+(?:\s(?:of\s)?[A-Z][a-z]+)?)\.?\s+([ivxlc]+)[.,]?\s*([\d, —–-]*)\.?\s*$/i

/** "Genesis iii, 22-24" (at the end of a paragraph) → a passage, if it names a real book and chapter. */
export function parseCaptionRef(text: string): Ref | undefined {
  const m = REFEND.exec(text)
  if (!m) return
  const name = m[1]!.replace(/^III\s?/, "3 ").replace(/^II\s?/, "2 ").replace(/^I\s(?=[A-Z])/, "1 ")
  const book = findBook(name)
  if (!book) return
  const chapter = roman(m[2]!)
  if (!chapter || chapter > book.chapters) return
  const nums = (m[3] ?? "").match(/\d+/g)?.map(Number) ?? []
  if (!nums.length) return { book: book.id, chapter, verseStart: 1, verseEnd: null }
  return { book: book.id, chapter, verseStart: nums[0]!, verseEnd: Math.max(nums[0]!, ...nums) }
}

const text = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "’")
    .replace(/\s+/g, " ")
    .trim()

export interface Plate {
  id: string
  title: string
  ref: Ref | null
  /** the scripture the gallery prints under the plate */
  caption: string
  /** the gallery's own description of the engraving */
  description: string
  image: { file: string; bytes: number; sha256: string; width: number; height: number }
}

function jpegSize(b: Uint8Array): { width: number; height: number } {
  let i = 2
  while (i < b.length) {
    const marker = b[i + 1]!
    const len = (b[i + 2]! << 8) | b[i + 3]!
    if (marker >= 0xc0 && marker <= 0xc3) return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]! }
    i += 2 + len
  }
  throw new Error("not a JPEG")
}

export function parsePlates(html: string): Omit<Plate, "image">[] {
  const plates: Omit<Plate, "image">[] = []
  for (const block of html.split(/<h2>/).slice(1)) {
    const id = /src="images\/(\d{3})\.jpg"/.exec(block)?.[1]
    if (!id) continue
    const title = titleCase(text(block.split("</h2>")[0]!))
    const after = block.slice(block.indexOf("</div>"))
    const paras = [...after.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => text(m[1]!)).filter(Boolean)
    // the scripture runs from the first paragraph to the one that ends with its citation
    const end = paras.slice(0, 14).findIndex((p) => parseCaptionRef(p))
    const parsed = end >= 0 ? parseCaptionRef(paras[end]!) : undefined
    const ref = id in OVERRIDES ? OVERRIDES[id]! : (parsed ?? null)
    const caption = (end >= 0 ? paras.slice(0, end + 1) : paras.slice(0, 1)).join(" ").replace(REFEND, "").replace(/[—\s]+$/, "").trim()
    // the gallery's own words about the engraving, not more scripture or Milton
    const description = paras.slice(end + 1).find((p) => /\b(Dor[ée]|picture|artist|illustration|engraving|painter)\b/i.test(p) && !/Project Gutenberg|eBook/i.test(p)) ?? ""
    plates.push({ id, title, ref, caption, description })
  }
  return plates
}

if (import.meta.main) {
  const check = process.argv.includes("--check")
  const html = await (await fetch(PAGE)).text()
  const sha = createHash("sha256").update(html).digest("hex")
  if (sha !== PAGE_SHA256) throw new Error(`The Gutenberg page changed (sha256 ${sha}); review the parse before re-pinning.`)
  const plates = parsePlates(html)
  const out: Plate[] = []
  for (const p of plates) {
    const bytes = new Uint8Array(await (await fetch(`${IMAGES}${p.id}.jpg`)).arrayBuffer())
    out.push({ ...p, image: { file: `${p.id}.jpg`, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), ...jpegSize(bytes) } })
  }
  const unmapped = out.filter((p) => p.ref === null && !(p.id in OVERRIDES))
  if (unmapped.length) throw new Error(`Plates with no passage: ${unmapped.map((p) => `${p.id} ${p.title}`).join(", ")}`)
  const json = `${JSON.stringify({ source: PAGE, sha256: PAGE_SHA256, images: IMAGES, plates: out }, null, 1)}\n`
  if (check) {
    if ((await Bun.file(OUT).text()) !== json) throw new Error(`${OUT} is out of date; run bun scripts/dore-catalogue.ts`)
    console.log(`${OUT} is current`)
  } else {
    await Bun.write(OUT, json)
    console.log(`wrote ${out.length} plates to ${OUT} (${BOOKS.length} books checked)`)
  }
}
