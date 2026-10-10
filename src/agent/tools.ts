import { z } from "zod"
import type { Bible } from "../data/bible"
import { bookById } from "../data/books"
import type { Commentary } from "../data/commentary"
import { baseStrongs, type Concordance } from "../data/concordance"
import { describeMorphology } from "../data/morphology"
import { findBook, formatRef, parseRef } from "../data/ref"
import type { UserStore } from "../data/user"

/**
 * Selah's data as agent tools. One definition serves every agent: the in-app Ask tab (Claude
 * through the Agent SDK's in-process MCP server), Codex and any MCP client (through
 * `selah mcp`). Every tool is read-only; the agent can only *suggest* a note, and the reader
 * accepts it.
 */
export interface ToolContext {
  bible: Bible
  commentary?: Commentary
  concordance?: Concordance
  store: UserStore
  translation: () => string
}

export interface SelahTool {
  name: string
  description: string
  shape: z.ZodRawShape
  run: (ctx: ToolContext, args: Record<string, unknown>) => string
}

const plain = (t: string) => t.replace(/[[\]\u0001\u0002]/g, "")

/** The most any one tool returns. Agent harnesses spill larger outputs to files the agent cannot read here. */
export const TOOL_BUDGET = 7_000
const clip = (t: string) => (t.length > TOOL_BUDGET ? `${t.slice(0, TOOL_BUDGET)}\n…(truncated; narrow the request)` : t)

function refOrThrow(reference: string) {
  const ref = parseRef(reference)
  if (!ref) throw new Error(`"${reference}" is not a Bible reference. Use a form like "John 3:16", "Ps 23" or "1 Cor 13:4-7".`)
  return ref
}

export const TOOLS: SelahTool[] = [
  {
    name: "get_passage",
    description:
      "Read a passage of the Bible. Accepts references like 'John 3:16', 'Psalm 23', 'Rom 8:28-39' or a whole chapter 'Genesis 1'. Returns numbered verses.",
    shape: {
      reference: z.string().describe("A Bible reference, e.g. 'John 3:1-21'"),
      translation: z.string().optional().describe("KJV, BSB, ASV, YLT or NHEB; defaults to the reader's translation"),
    },
    run: (ctx, a) => {
      const ref = refOrThrow(String(a.reference))
      const tr = String(a.translation ?? ctx.translation()).toUpperCase()
      if (!ctx.bible.hasTranslation(tr)) throw new Error(`${tr} is not installed. Installed: ${ctx.bible.translations().map((t) => t.id).join(", ")}`)
      const verses = ctx.bible.verses(tr, ref)
      if (!verses.length) throw new Error(`No verses found for ${formatRef(ref)}`)
      return clip(`${formatRef(ref)} (${tr})\n${verses.map((v) => `${v.verse} ${plain(v.text) || "[not in the manuscripts this translation follows]"}`).join("\n")}`)
    },
  },
  {
    name: "search_bible",
    description:
      "Full-text search of the Bible, ranked by relevance. Quote phrases (\"living water\"), and narrow with in:book (in:john), in:ot or in:nt.",
    shape: {
      query: z.string().describe("Words to find, e.g. 'born again in:john'"),
      translation: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    run: (ctx, a) => {
      const tr = String(a.translation ?? ctx.translation()).toUpperCase()
      const hits = ctx.bible.search(tr, String(a.query), Number(a.limit ?? 25))
      if (!hits.length) return `No verses match ${a.query} in ${tr}.`
      return clip(hits.map((h) => `${formatRef({ book: h.book, chapter: h.chapter, verseStart: h.verse })}: ${plain(h.text)}`).join("\n"))
    },
  },
  {
    name: "get_commentary",
    description:
      "Matthew Henry's Complete Commentary on a verse: his paragraphs on that verse first, with the section heading and verse range. Long sections come in parts; pass part to read on.",
    shape: {
      reference: z.string().describe("e.g. 'John 3:16' or 'John 3'"),
      part: z.number().int().min(1).optional().describe("Which part of a long section, from 1"),
    },
    run: (ctx, a) => {
      if (!ctx.commentary?.installed) throw new Error("Matthew Henry's Commentary is not installed. The reader can install it with `selah install commentary`.")
      const ref = refOrThrow(String(a.reference))
      const hit = ctx.commentary.forVerse(ref.book, ref.chapter, ref.verseStart ?? 1)
      if (!hit) throw new Error(`No commentary for ${formatRef(ref)}`)
      const s = hit.sections[hit.section]!
      const range = s.verseStart !== null ? ` (v. ${s.verseStart}${s.verseEnd !== s.verseStart ? `-${s.verseEnd}` : ""})` : ""
      // Parts are windows of paragraphs under a size budget, starting at the paragraph about
      // the verse, so part 1 is always Henry on that verse. Whole sections run to 50 KB+, more
      // than an agent's tool output can carry.
      const order = [...s.paragraphs.keys()]
      const start = ref.verseStart ? hit.paragraph : 0
      const rotated = [...order.slice(start), ...order.slice(0, start)]
      const parts: number[][] = []
      let cur: number[] = []
      let size = 0
      for (const i of rotated) {
        const len = s.paragraphs[i]!.body.length + 2
        if (cur.length && size + len > TOOL_BUDGET) {
          parts.push(cur)
          cur = []
          size = 0
        }
        cur.push(i)
        size += len
      }
      if (cur.length) parts.push(cur)
      const n = Math.min(parts.length, Math.max(1, Number(a.part ?? 1)))
      const body = parts[n - 1]!
        .sort((x, y) => x - y)
        .map((i) => {
          const text = s.paragraphs[i]!.body
          const clipped = text.length > TOOL_BUDGET ? `${text.slice(0, TOOL_BUDGET)}…` : text
          return i === hit.paragraph && ref.verseStart ? `>> ${clipped}` : clipped
        })
      const more = n < parts.length ? `\n\n(part ${n} of ${parts.length}; call again with part: ${n + 1} for more)` : `\n\n(part ${n} of ${parts.length})`
      return `Matthew Henry on ${formatRef({ book: ref.book, chapter: ref.chapter })}: ${s.heading}${range}\n\n${body.join("\n\n")}${more}`
    },
  },
  {
    name: "search_commentary",
    description: "Full-text search across Matthew Henry's Commentary. Returns matching passages with the chapter and section they belong to.",
    shape: { query: z.string(), limit: z.number().int().min(1).max(50).optional() },
    run: (ctx, a) => {
      if (!ctx.commentary?.installed) throw new Error("Matthew Henry's Commentary is not installed.")
      const words = String(a.query).match(/[\p{L}\p{N}]+/gu) ?? []
      if (!words.length) return "Nothing to search for."
      const limit = Number(a.limit ?? 15)
      // every word first; if Henry never puts them all in one paragraph, rank by any of them
      let hits = ctx.commentary.search(words.map((w) => `"${w}"`).join(" "), limit)
      if (!hits.length && words.length > 1) hits = ctx.commentary.search(words.map((w) => `"${w}"`).join(" OR "), limit)
      if (!hits.length) return `Henry never discusses ${a.query} in those words.`
      return clip(hits.map((h) => `${formatRef({ book: h.book, chapter: h.chapter })} · ${h.heading}: ${plain(h.snippet)}`).join("\n"))
    },
  },
  {
    name: "get_original_words",
    description:
      "The Hebrew or Greek words behind a verse (up to 5 verses): each word with its transliteration, English gloss, Strong's number, lexicon form and parsed grammar. Use it for word studies and questions about what the original says.",
    shape: { reference: z.string().describe("A verse or short range, e.g. 'John 3:16' or 'Gen 1:1-3'") },
    run: (ctx, a) => {
      const c = ctx.concordance
      if (!c?.installed) throw new Error("The Hebrew and Greek concordance is not installed. The reader can install it with `selah install concordance`.")
      const ref = refOrThrow(String(a.reference))
      const start = ref.verseStart ?? 1
      const end = Math.min(ref.verseEnd ?? (ref.verseStart ? ref.verseStart : start + 4), start + 4)
      const out: string[] = []
      for (let v = start; v <= end; v++) {
        const words = c.verse(ref.book, ref.chapter, v, ctx.translation())
        if (!words.length) continue
        out.push(`${formatRef({ book: ref.book, chapter: ref.chapter, verseStart: v })} (${ref.book <= 39 ? "Hebrew, Leningrad codex" : "Greek"})`)
        for (const w of words) {
          const lex = c.entry(w.dstrong)
          const title = w.verse === 0 ? " [title]" : ""
          const variant = w.inText ? "" : ` [not in the text ${ctx.translation()} follows]`
          out.push(
            `${w.position}. ${w.original} (${w.translit}) "${w.gloss}" ${w.strongs}${lex ? ` = ${lex.lemma} ${lex.translit}: ${lex.gloss}` : ""}; ${describeMorphology(w.grammar, ref.book)}${title}${variant}`,
          )
        }
      }
      if (!out.length) throw new Error(`No original-language words for ${formatRef(ref)}`)
      return clip(out.join("\n"))
    },
  },
  {
    name: "concordance",
    description:
      "Every use of one Hebrew or Greek word (by Strong's number, e.g. G0026 or H2617): its lexicon entry, how often it occurs, counts per book, and the verses with the reader's translation. Filter to one book with book.",
    shape: {
      strongs: z.string().describe("A Strong's number, e.g. 'G0026', 'H7225' or 'G25'"),
      book: z.string().optional().describe("Only this book, e.g. '1 John'"),
      limit: z.number().int().min(1).max(60).optional().describe("How many verses to list (default 25)"),
    },
    run: (ctx, a) => {
      const c = ctx.concordance
      if (!c?.installed) throw new Error("The Hebrew and Greek concordance is not installed. The reader can install it with `selah install concordance`.")
      const strongs = baseStrongs(String(a.strongs))
      if (!strongs) throw new Error(`"${a.strongs}" is not a Strong's number. Use a form like G0026 or H7225.`)
      const book = a.book ? findBook(String(a.book)) : undefined
      if (a.book && !book) throw new Error(`"${a.book}" is not a book of the Bible.`)
      const lex = c.entry(strongs)
      const n = c.count(strongs)
      if (!n.words) return `${strongs} does not occur in the text.`
      const per = c.perBook(strongs).map((p) => `${bookById(p.book).short} ${p.count}`)
      const occ = c.occurrences(strongs, { book: book?.id, limit: Number(a.limit ?? 25) })
      const tr = ctx.translation()
      const verses = occ.map((o) => {
        const v = ctx.bible.verses(tr, { book: o.book, chapter: o.chapter, verseStart: o.verse })[0]
        return `${formatRef({ book: o.book, chapter: o.chapter, verseStart: o.verse })} [${o.forms}]: ${v ? plain(v.text) : ""}`
      })
      return clip(
        [
          lex ? `${strongs} ${lex.lemma} (${lex.translit}), ${lex.morph}: ${lex.gloss}` : strongs,
          lex ? lex.definition.replace(/\*/g, "").slice(0, 1200) : "",
          `${n.words} occurrences in ${n.verses} verses. By book: ${per.join(", ")}`,
          `${book ? `In ${book.name}` : "Verses"} (${tr}, first ${verses.length}):`,
          ...verses,
        ]
          .filter(Boolean)
          .join("\n"),
      )
    },
  },
  {
    name: "get_notes",
    description:
      "The reader's own notes, chapter journal and highlights for a chapter. Use it to connect an answer to what they have already written.",
    shape: { reference: z.string().optional().describe("A chapter or verse; defaults to the chapter being read") },
    run: (ctx, a) => {
      const pos = ctx.store.position()
      const ref = a.reference ? refOrThrow(String(a.reference)) : pos ? { book: pos.book, chapter: pos.chapter } : undefined
      if (!ref) return "The reader has not opened a chapter yet."
      const notes = ctx.store.notes().filter((n) => n.book === ref.book && n.chapter === ref.chapter)
      const journal = ctx.store.journal(ref.book, ref.chapter)
      const hl = [...ctx.store.highlightsIn(ref.book, ref.chapter).keys()].sort((x, y) => x - y)
      const parts = [`Notes on ${bookById(ref.book).name} ${ref.chapter}:`]
      parts.push(journal ? `Journal: ${journal}` : "Journal: (empty)")
      parts.push(notes.length ? notes.map((n) => `v${n.verse}: ${n.body}`).join("\n") : "Verse notes: none")
      parts.push(hl.length ? `Highlighted verses: ${hl.join(", ")}` : "Highlighted verses: none")
      return clip(parts.join("\n"))
    },
  },
  {
    name: "reading_context",
    description:
      "What the reader is doing right now: the passage and verse open, the translation, recent chapters and whether they have read today. Call this first when a question says 'this', 'here' or 'today'.",
    shape: {},
    run: (ctx) => {
      const pos = ctx.store.position()
      const recent = ctx.store.recentChapters(6).map((r) => formatRef({ book: r.book, chapter: r.chapter }))
      return [
        pos ? `Reading: ${formatRef({ book: pos.book, chapter: pos.chapter, verseStart: pos.verse })} in ${ctx.translation()}` : "Reading: nothing open yet",
        `Recent chapters: ${recent.join(", ") || "none"}`,
        `Installed translations: ${ctx.bible.translations().map((t) => t.id).join(", ")}`,
        `Matthew Henry installed: ${ctx.commentary?.installed ? "yes" : "no"}`,
      ].join("\n")
    },
  },
  {
    name: "suggest_note",
    description:
      "Offer the reader a short note to save on a verse (a summary, a cross-reference, a question to pray over). It is shown as a suggestion; nothing is saved unless the reader accepts.",
    shape: { reference: z.string().describe("The verse, e.g. 'John 3:16'"), note: z.string().describe("The note, in one to three sentences") },
    run: (_ctx, a) => {
      const ref = refOrThrow(String(a.reference))
      if (ref.verseStart === undefined) throw new Error("Suggest a note on one verse, e.g. 'John 3:16'.")
      return `Suggested a note on ${formatRef(ref)} for the reader to accept.`
    },
  },
]

export function callTool(ctx: ToolContext, name: string, args: Record<string, unknown>): { text: string; isError: boolean } {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return { text: `Unknown tool ${name}`, isError: true }
  try {
    const parsed = z.object(tool.shape).parse(args ?? {})
    return { text: tool.run(ctx, parsed), isError: false }
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true }
  }
}

export const SYSTEM_PROMPT = `You are a study companion inside Selah, a Bible reader in the terminal. The reader is studying scripture and asks you questions about what they are reading.

Ground every answer in the text. Use Selah's tools: read the passage with get_passage, find related verses with search_bible, and consult Matthew Henry with get_commentary when it helps. For what a word means in the original, read the Hebrew or Greek with get_original_words, then trace that word through scripture with concordance. Cite references in the standard form (John 3:16, Rom 8:28) so the reader can open them. When you draw on Henry, say so.

Be clear about what scripture says, what Henry or the wider Christian tradition says, and where Christians differ. Do not invent quotations. Keep answers focused: a few short paragraphs, or a short list, unless the reader asks for depth.

If a point is worth keeping, you may offer it with suggest_note; the reader decides whether to save it.`
