// The Hebrew and Greek concordance (HAL-2581), imported from the pinned STEPBible files.
import { beforeAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  baseStrongs,
  Concordance,
  extendedStrongs,
  importConcordance,
  installConcordance,
  lexiconText,
  parseLexiconLine,
  parseWordLine,
  STEP_FILES,
} from "../src/data/concordance"
import { displayHebrew, stripCantillation } from "../src/data/hebrew"
import { describeGreek, describeHebrew } from "../src/data/morphology"
import { fixtureBible, fixtureConcordance } from "./fixture"

let c: Concordance

beforeAll(async () => {
  c = await fixtureConcordance()
}, 300_000)

describe("spot checks", () => {
  test("John 3:16 contains G0025 (agapaō)", () => {
    const w = c.verse(43, 3, 16).find((x) => x.strongs === "G0025")
    expect(w).toMatchObject({ original: "ἠγάπησεν", translit: "ēgapēsen", gloss: "loved", grammar: "V-AAI-3S" })
    expect(c.entry("G0025")).toMatchObject({ lemma: "ἀγαπάω", gloss: "to love" })
  })

  test("Genesis 1:1 starts with H7225 (rēšît), behind its prefix 'in'", () => {
    const [first] = c.verse(1, 1, 1)
    expect(first).toMatchObject({ position: 1, strongs: "H7225", dstrong: "H7225G", parts: "H9003/{H7225G}", gloss: "in beginning", translit: "bereshit" })
    expect(c.entry(first!.dstrong)).toMatchObject({ lemma: "רֵאשִׁית", gloss: "first: beginning" })
  })

  test("G0026 occurs in 1 John 4:8", () => {
    const inFirstJohn = c.occurrences("G0026", { book: 62 }).map((o) => `${o.chapter}:${o.verse}`)
    expect(inFirstJohn).toContain("4:8")
    expect(c.perBook("G0026").find((p) => p.book === 62)?.count).toBe(18)
  })
})

describe("coverage", () => {
  test("every KJV verse has its original words, and none fall outside the KJV's verses", async () => {
    const bible = await fixtureBible()
    const db = c.db
    db.run(`ATTACH '${(bible as unknown as { db: Database }).db.filename}' AS b`)
    try {
      const missing = db.query(`SELECT v.book, v.chapter, v.verse FROM b.verses v WHERE v.translation = 'KJV' AND NOT EXISTS (SELECT 1 FROM words w WHERE w.book = v.book AND w.chapter = v.chapter AND w.verse = v.verse)`).all()
      const extra = db.query(`SELECT DISTINCT w.book, w.chapter, w.verse FROM words w WHERE w.verse > 0 AND NOT EXISTS (SELECT 1 FROM b.verses v WHERE v.translation = 'KJV' AND v.book = w.book AND v.chapter = w.chapter AND v.verse = w.verse)`).all()
      expect(missing).toEqual([])
      expect(extra).toEqual([])
    } finally {
      db.run(`DETACH b`)
    }
  })

  test("all 66 books, and 116 psalm titles kept as verse 0", () => {
    expect(c.db.query<{ n: number }, []>(`SELECT count(DISTINCT book) AS n FROM words`).get()!.n).toBe(66)
    expect(c.db.query<{ n: number }, []>(`SELECT count(*) AS n FROM (SELECT DISTINCT book, chapter FROM words WHERE verse = 0)`).get()!.n).toBe(116)
  })

  test("a psalm's verse 1 opens with its title", () => {
    const words = c.verse(19, 3, 1)
    expect(words[0]).toMatchObject({ verse: 0, gloss: "a psalm" })
    expect(words.at(-1)!.verse).toBe(1)
  })

  test("KJV-numbered verses land where the KJV has them (2 Cor 13:14, Rom 16:25, John 7:53)", () => {
    expect(c.verse(47, 13, 14).map((w) => w.gloss).join(" ")).toMatch(/grace/)
    expect(c.verse(45, 16, 25).length).toBeGreaterThan(0)
    expect(c.verse(43, 7, 53).map((w) => w.strongs)).toContain("G3624") // οἶκον, "house"
  })
})

describe("which text a word is in", () => {
  test("John 5:4 is in the Textus Receptus (KJV) but not in Nestle-Aland (BSB)", () => {
    const kjv = c.verse(43, 5, 4, "KJV")
    const bsb = c.verse(43, 5, 4, "BSB")
    expect(kjv.length).toBeGreaterThan(10)
    expect(kjv.every((w) => w.inText)).toBe(true)
    expect(bsb.every((w) => !w.inText)).toBe(true)
  })

  test("1 John 5:7's 'in heaven, the Father, the Word' is the KJV's alone", () => {
    const tr = c.verse(62, 5, 7, "KJV").filter((w) => w.inText).map((w) => w.strongs)
    const na = c.verse(62, 5, 7, "BSB").filter((w) => w.inText).map((w) => w.strongs)
    expect(tr).toContain("G3962") // πατήρ
    expect(na).not.toContain("G3962")
  })
})

describe("parsing", () => {
  test("a TAHOT row", () => {
    const line =
      "Gen.1.1#01=L\tבְּ/רֵאשִׁ֖ית\tbe./re.Shit\tin/ beginning\tH9003/{H7225G}\tHR/Ncfsa\t\t\tH7225G\t\t\tH9003=ב=in/{H7225G=רֵאשִׁית=: beginning»first:1_beginning}"
    expect(parseWordLine(line)).toEqual({
      book: 1,
      chapter: 1,
      verse: 1,
      position: 1,
      original: "בְּרֵאשִׁ֖ית",
      translit: "bereshit",
      gloss: "in beginning",
      strongs: "H7225",
      dstrong: "H7225G",
      parts: "H9003/{H7225G}",
      grammar: "HR/Ncfsa",
      editions: "L",
    })
  })

  test("a TAGNT row, and the KJV's numbering in square brackets wins", () => {
    const w = parseWordLine("Jhn.3.16#03=NKO\tἠγάπησεν (ēgapēsen)\tloved\tG0025=V-AAI-3S\tἀγαπάω=to love\tNA28+NA27+Tyn+SBL+WH+Treg+TR+Byz")
    expect(w).toMatchObject({ book: 43, chapter: 3, verse: 16, position: 3, original: "ἠγάπησεν", translit: "ēgapēsen", strongs: "G0025", grammar: "V-AAI-3S", editions: "NKO" })
    expect(parseWordLine("2Co.13.13[13.14]#01=NKO\tἩ (Hē)\t[14] The\tG3588=T-NSF\tὁ=the")).toMatchObject({ chapter: 13, verse: 14 })
    expect(parseWordLine("Rom.16.25{14.24}#01=NKO\tΤῷ (Tō)\t{14.24} To Him\tG3588=T-DSM\tὁ=the")).toMatchObject({ chapter: 16, verse: 25 })
  })

  test("punctuation attached with a backslash is part of the word, not a separator", () => {
    const w = parseWordLine("Psa.23.1#06=L\tאֶחְסָֽר\\׃\t'ech.Sar\tI lack\t{H2637}\\H9016\tHVqi1cs")
    expect(w).toMatchObject({ original: "אֶחְסָֽר׃".normalize("NFC"), strongs: "H2637" })
    expect(parseWordLine("Gen.1.1#07=L\tהָ/אָֽרֶץ\\׃\tha./'A.retz\tthe/ earth\tH9009/H0776G\\H9016\tHTd/Ncbsa")).toMatchObject({ strongs: "H0776", original: "הָאָֽרֶץ׃".normalize("NFC") })
  })

  test("headers, verse lines and notes are skipped", () => {
    for (const l of ["# Mat.1.1\tΒίβλος", "Word & Type\tGreek", "", "Reference:\tVersification as used by NRSV."]) expect(parseWordLine(l)).toBeUndefined()
  })

  test("Strong's numbers normalise", () => {
    expect(baseStrongs("G25")).toBe("G0025")
    expect(baseStrongs("{H7225G}")).toBe("H7225")
    expect(extendedStrongs("h1254a")).toBe("H1254a")
    expect(baseStrongs("nothing")).toBe("")
  })

  test("a lexicon row, with its HTML made readable", () => {
    const e = parseLexiconLine("G0025\tG0025 =\tG0025\tἀγαπάω\tagapaō\tG:V\tto love\t <b>ἀγαπάω</b>, -ῶ, <BR /> [in LXX chiefly for אהב ;] <BR /><b>to love</b> &amp; more")
    expect(e).toMatchObject({ dstrong: "G0025", strongs: "G0025", lemma: "ἀγαπάω", translit: "agapaō", gloss: "to love" })
    expect(e!.definition).toBe("**ἀγαπάω**, -ῶ,\n [in LXX chiefly for אהב ;]\n**to love** & more")
    expect(parseLexiconLine("H7225\tH7225H = a Meaning of\tH7225G\tרֵאשִׁית\tre.shit\tH:N-F\tfirst: best\t: best")).toMatchObject({ dstrong: "H7225H", strongs: "H7225" })
    expect(lexiconText("a<br>b<i>c</i>")).toBe("a\nb*c*")
  })
})

describe("morphology in plain English", () => {
  test("Greek", () => {
    expect(describeGreek("V-AAI-3S")).toBe("verb · aorist active indicative · 3rd person singular")
    expect(describeGreek("V-PAP-NSM")).toBe("verb · present active participle · nominative singular masculine")
    expect(describeGreek("N-NSM-P")).toBe("noun · nominative singular masculine · proper name (person)")
    expect(describeGreek("P-1GS")).toBe("personal pronoun · 1st person genitive singular")
    expect(describeGreek("PRT-N")).toBe("particle · negative")
    expect(describeGreek("CONJ")).toBe("conjunction")
  })

  test("Hebrew, morpheme by morpheme", () => {
    expect(describeHebrew("HR/Ncfsa")).toBe("preposition + noun, feminine singular absolute")
    expect(describeHebrew("Hc/Vqw3ms")).toBe("conjunction + verb, qal sequential imperfect (wayyiqtol), 3rd person masculine singular")
    expect(describeHebrew("HR/Vqcc")).toBe("preposition + verb, qal infinitive construct")
    expect(describeHebrew("AVhp3ms")).toBe("Aramaic: verb, haphel perfect (qatal), 3rd person masculine singular")
  })

  test("every code in the data decodes to words, never back to the code", () => {
    const codes = c.db.query<{ grammar: string; book: number }, []>(`SELECT grammar, min(book) AS book FROM words GROUP BY grammar`).all()
    const raw = codes.filter((x) => x.grammar && (x.book <= 39 ? describeHebrew(x.grammar) : describeGreek(x.grammar)) === x.grammar)
    expect(raw.map((x) => x.grammar)).toEqual([])
    // a GROUP BY over all 447,744 words: it checks the decoding, not the speed (HAL-2595)
  }, 60_000)
})

describe("Hebrew in the terminal", () => {
  test("cantillation goes, vowel points stay, and each word reads right to left", () => {
    expect(stripCantillation("בְּרֵאשִׁ֖ית")).toBe("בְּרֵאשִׁית")
    // reversed by grapheme: the last letter is drawn first, each letter keeps its points
    expect(displayHebrew("בָּרָא")).toBe("ארָבָּ")
    expect(displayHebrew("בָּרָא", "logical")).toBe("בָּרָא")
    expect(displayHebrew("ἀγάπη")).toBe("ἀγάπη")
  })
})

describe("import", () => {
  const small = [
    { name: "TAGNT_x.txt", text: "Jhn.3.16#03=NKO\tἠγάπησεν (ēgapēsen)\tloved\tG0025=V-AAI-3S\tἀγαπάω=to love\tNA28" },
    { name: "TBESG_x.txt", text: "G0025\tG0025 =\tG0025\tἀγαπάω\tagapaō\tG:V\tto love\tlove" },
  ]

  test("never blocks the event loop, and keeps serving the old data until the swap", async () => {
    const db = new Database(":memory:")
    await importConcordance(db, small)
    const live = new Concordance(db)
    expect(live.verse(43, 3, 16)).toHaveLength(1)
    const files = await Promise.all(STEP_FILES.map(async (f) => ({ name: f.name, text: await Bun.file(join(import.meta.dir, "..", ".selah-test-sources", `stepbible-aca7d691414e`, f.name)).text() })))
    let ticks = 0
    const timer = setInterval(() => ticks++, 1)
    let midway: number | undefined
    const progress: number[] = []
    const stats = await importConcordance(db, files, (f) => {
      progress.push(f)
      if (midway === undefined && f > 0.5) midway = live.verse(43, 3, 16).length
    })
    clearInterval(timer)
    expect(ticks).toBeGreaterThan(20) // timers ran throughout
    expect(progress.length).toBeGreaterThan(50)
    expect(progress.at(-1)).toBe(1)
    expect(midway).toBe(1) // still the old import while the new one was being built
    expect(stats.words).toBeGreaterThan(440_000)
    expect(live.verse(43, 3, 16).length).toBe(26)
  }, 120_000)

  test("each import swaps index generations, so indexes never pile up", async () => {
    const db = new Database(":memory:")
    new Concordance(db)
    const names = () => db.query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((r) => r.name)
    expect(names()).toEqual(["lexicon_strongs_a", "words_strongs_a", "words_verse_a"])
    await importConcordance(db, small)
    expect(names()).toEqual(["lexicon_strongs_b", "words_strongs_b", "words_verse_b"])
    await importConcordance(db, small)
    new Concordance(db)
    expect(names()).toEqual(["lexicon_strongs_a", "words_strongs_a", "words_verse_a"])
    expect(db.query(`SELECT name FROM sqlite_master WHERE name LIKE '%_import'`).all()).toEqual([])
  })
})

describe("install", () => {
  test("reuses complete cached files and never refetches them", async () => {
    const db = new Database(":memory:")
    let fetched = 0
    const stats = await installConcordance(db, join(import.meta.dir, "..", ".selah-test-sources"), undefined, (async () => (fetched++, new Response("x"))) as never)
    expect(fetched).toBe(0)
    expect(stats.words).toBeGreaterThan(440_000)
    expect(stats.entries).toBeGreaterThan(20_000)
  }, 120_000)

  test("a truncated download is refused, not imported", async () => {
    const dir = mkdtempSync(join(tmpdir(), "selah-step-"))
    // a short file is fetched again, every attempt, then refused with the reason
    let calls = 0
    const short = (async () => (calls++, new Response("only a little"))) as never
    await expect(installConcordance(new Database(":memory:"), dir, undefined, short, { sleep: async () => {} })).rejects.toThrow(
      `${STEP_FILES[0]!.name} was 13 bytes, expected ${STEP_FILES[0]!.bytes}. Tried 4 times.`,
    )
    expect(calls).toBe(4)
    const failing = (async () => new Response("nope", { status: 404 })) as never
    await expect(installConcordance(new Database(":memory:"), dir, undefined, failing)).rejects.toThrow("it is not there (HTTP 404)")
  })
})
