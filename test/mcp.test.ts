// `selah mcp` over real stdio, driven by the official MCP client (HAL-2583).
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { UserStore } from "../src/data/user"
import { Database } from "bun:sqlite"
import { CONCORDANCE_SCHEMA } from "../src/data/concordance"
import { fixtureBible, fixtureCommentary, fixtureConcordance } from "./fixture"

const root = join(import.meta.dir, "..")
let client: Client
let home: string

beforeAll(async () => {
  await fixtureBible()
  await fixtureCommentary()
  await fixtureConcordance()
  home = mkdtempSync(join(tmpdir(), "selah-mcp-"))
  mkdirSync(join(home, "data"), { recursive: true })
  copyFileSync(join(root, ".selah-test-home", "fixture-bible.db"), join(home, "data", "bible.db"))
  copyFileSync(join(root, ".selah-test-home", "fixture-study.db"), join(home, "data", "study.db"))
  // study.db holds every study pack: add the concordance next to Henry
  const study = new Database(join(home, "data", "study.db"))
  study.exec(CONCORDANCE_SCHEMA)
  study.run(`ATTACH '${join(root, ".selah-test-home", "fixture-concordance.db")}' AS c`)
  study.run(`INSERT INTO words SELECT * FROM c.words`)
  study.run(`INSERT INTO lexicon SELECT * FROM c.lexicon`)
  study.run(`DETACH c`)
  study.close()
  const store = UserStore.open(join(home, "data", "user.db"))
  store.setPosition({ book: 43, chapter: 3, verse: 16, translation: "KJV" })
  store.saveNote({ book: 43, chapter: 3, verse: 16 }, "the heart of the gospel")
  store.db.close()

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "src", "index.tsx"), "mcp"],
    cwd: root,
    env: { ...process.env, SELAH_HOME: home } as Record<string, string>,
    stderr: "pipe",
  })
  client = new Client({ name: "selah-test", version: "1.0.0" })
  await client.connect(transport)
}, 120_000)

afterAll(async () => {
  await client?.close()
})

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean }
  return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError }
}

describe("selah mcp", () => {
  test("lists every tool, all read-only", async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["concordance", "get_commentary", "get_notes", "get_original_words", "get_passage", "reading_context", "search_bible", "search_commentary", "suggest_note"].sort(),
    )
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true)
  })

  test("get_passage reads a verse and a range", async () => {
    const r = await call("get_passage", { reference: "John 3:16" })
    expect(r.text).toContain("16 For God so loved the world")
    const bsb = await call("get_passage", { reference: "Ps 23:1-2", translation: "bsb" })
    expect(bsb.text).toContain("(BSB)")
    expect(bsb.text.split("\n")).toHaveLength(3)
  })

  test("bad references come back as tool errors, not crashes", async () => {
    const r = await call("get_passage", { reference: "Hezekiah 4:2" })
    expect(r.isError).toBe(true)
    expect(r.text).toContain("not a Bible reference")
  })

  test("search_bible ranks and filters", async () => {
    const r = await call("search_bible", { query: "born again in:john", limit: 5 })
    expect(r.text).toContain("John 3:3")
  })

  test("get_commentary returns Henry's section and marks the paragraph on the verse", async () => {
    const r = await call("get_commentary", { reference: "John 3:16" })
    expect(r.text).toContain("Matthew Henry on John 3: Christ's Interview with Nicodemus (v. 1-21)")
    expect(r.text).toContain(">> ")
  })

  test("search_commentary", async () => {
    const r = await call("search_commentary", { query: "brazen serpent" })
    expect(r.text).toMatch(/John 3 · /)
  })

  test("reading_context and get_notes see what the reader is doing", async () => {
    const ctx = await call("reading_context")
    expect(ctx.text).toContain("Reading: John 3:16 in KJV")
    const notes = await call("get_notes")
    expect(notes.text).toContain("v16: the heart of the gospel")
  })

  test("suggest_note never writes", async () => {
    const r = await call("suggest_note", { reference: "John 3:16", note: "x" })
    expect(r.text).toContain("for the reader to accept")
    const notes = await call("get_notes", { reference: "John 3" })
    expect(notes.text).not.toContain("v16: x")
  })
})

describe("tool output fits an agent's budget", () => {
  test("get_commentary returns a focused window on the verse, not the whole section", async () => {
    const r = await call("get_commentary", { reference: "John 3:5" })
    expect(r.text.length).toBeLessThan(8_000)
    expect(r.text).toContain(">> ") // the paragraph about verse 5
    expect(r.text).toMatch(/part 1 of \d+/)
    const next = await call("get_commentary", { reference: "John 3:5", part: 2 })
    expect(next.isError).toBe(false)
    expect(next.text).toMatch(/part 2 of \d+/)
    expect(next.text).not.toBe(r.text)
  })

  test("search_commentary falls back to any-word ranking when every word cannot match", async () => {
    const r = await call("search_commentary", { query: "necessity of regeneration baptism sign water Nicodemus" })
    expect(r.text).not.toContain("never discusses")
    expect(r.text).toContain("John 3")
  })
})

describe("word studies", () => {
  test("get_original_words gives each word with its number, lexicon form and grammar", async () => {
    const r = await call("get_original_words", { reference: "John 3:16" })
    expect(r.isError).toBe(false)
    expect(r.text).toContain('3. ἠγάπησεν (ēgapēsen) "loved" G0025 = ἀγαπάω agapaō: to love; verb · aorist active indicative · 3rd person singular')
    const gen = await call("get_original_words", { reference: "Gen 1:1" })
    expect(gen.text).toContain("Genesis 1:1 (Hebrew, Leningrad codex)")
    expect(gen.text.split("\n")[1]).toContain("H7225")
  })

  test("get_original_words caps a range at five verses", async () => {
    const r = await call("get_original_words", { reference: "Ps 119:1-50" })
    expect(r.text.match(/^Psalms 119:\d+ \(Hebrew/gm)).toHaveLength(5)
  })

  test("concordance traces a word through scripture, and narrows to a book", async () => {
    const r = await call("concordance", { strongs: "G26" })
    expect(r.text).toMatch(/^G0026 ἀγάπη \(agapē\)/)
    expect(r.text).toMatch(/\d+ occurrences in \d+ verses\. By book: .*1 John 18/)
    const john = await call("concordance", { strongs: "G0026", book: "1 John", limit: 30 })
    expect(john.text).toContain("1 John 4:8 [ἀγάπη]: He that loveth not knoweth not God; for God is love.")
    expect(john.text.length).toBeLessThan(8_000)
  })

  test("a word that never occurs in the book says so, with the count elsewhere", async () => {
    const r = await call("concordance", { strongs: "H7225", book: "John" })
    expect(r.isError).toBe(false)
    expect(r.text).toMatch(/^H7225 does not occur in John\. It occurs \d+ times in \d+ verses elsewhere/)
    const john = await call("concordance", { strongs: "G0026", book: "1 John" })
    expect(john.text).toContain("In 1 John: 18 occurrences in 14 verses.")
  })

  test("bad numbers and books are tool errors", async () => {
    expect((await call("concordance", { strongs: "love" })).isError).toBe(true)
    expect((await call("concordance", { strongs: "G26", book: "Hezekiah" })).isError).toBe(true)
  })
})
