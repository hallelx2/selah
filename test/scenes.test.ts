// Doré's engravings (HAL-2582): the catalogue, its mapping to passages, and the install.
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseCaptionRef, titleCase } from "../scripts/dore-catalogue"
import { bookById } from "../src/data/books"
import { installScenes, PLATES, sceneAt, sceneFile, scenesFor, scenesInstalled, scenesSources } from "../src/data/scenes"
import { fixtureBible } from "./fixture"

const PLATE_DIR = join(import.meta.dir, "..", ".selah-test-sources", "dore-8710")

describe("catalogue", () => {
  test("100 plates, each with a title, a caption and a pinned image", () => {
    expect(PLATES).toHaveLength(100)
    expect(new Set(PLATES.map((p) => p.id)).size).toBe(100)
    for (const p of PLATES) {
      expect([p.id, p.title.length > 3, p.caption.length > 40, p.image.bytes > 50_000, /^[0-9a-f]{64}$/.test(p.image.sha256), p.image.width > 500]).toEqual([
        p.id,
        true,
        true,
        true,
        true,
        true,
      ])
    }
  })

  test("every plate maps to real verses of a real chapter, except the two from the Apocrypha", async () => {
    const bible = await fixtureBible()
    const unmapped = PLATES.filter((p) => !p.ref).map((p) => `${p.id} ${p.title}`)
    expect(unmapped).toEqual(["055 Daniel Confounding the Priests of Bel", "056 Heliodorus Punished in the Temple"])
    const bad: string[] = []
    for (const p of PLATES) {
      if (!p.ref) continue
      const { book, chapter, verseStart, verseEnd } = p.ref
      const last = bible.verses("KJV", { book, chapter }).at(-1)?.verse ?? 0
      if (chapter > bookById(book).chapters || verseStart < 1 || verseStart > last || (verseEnd !== null && (verseEnd < verseStart || verseEnd > last))) bad.push(`${p.id} ${p.title}`)
    }
    expect(bad).toEqual([])
  })

  test("a plate's passage names who or where its title does", async () => {
    // titles naming an event or a thing rather than a person or place: checked by reading
    const EVENTS = new Set(["001", "004", "044", "048", "057", "060", "081", "082", "085", "087", "088", "089", "093"])
    const bible = await fixtureBible()
    const STOP = new Set("the of and in on to a an his her their with from into under by at for".split(" "))
    const misses: string[] = []
    for (const p of PLATES) {
      if (!p.ref || EVENTS.has(p.id)) continue
      const r = p.ref
      const text = bible
        .verses("KJV", { book: r.book, chapter: r.chapter, verseStart: r.verseStart, verseEnd: r.verseEnd ?? 999 })
        .map((v) => v.text)
        .join(" ")
        .toLowerCase()
      const words = p.title.toLowerCase().replace(/['’]s\b/g, "").split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w))
      if (!words.some((w) => text.includes(w.replace(/s$/, "")))) misses.push(`${p.id} ${p.title}`)
    }
    expect(misses).toEqual([])
  })

  test("plates are found by chapter and by verse", () => {
    expect(scenesFor(43, 4).map((p) => p.title)).toEqual(["Jesus and the Woman of Samaria"])
    expect(scenesFor(43, 3)).toEqual([])
    // Matthew 2 has three: the star, the flight, the massacre
    expect(scenesFor(40, 2).map((p) => p.id)).toEqual(["058", "059", "060"])
    expect(sceneAt(40, 2, 14)?.id).toBe("059")
    expect(sceneAt(40, 2, 17)?.id).toBe("060")
    expect(sceneAt(40, 2, 23)?.id).toBe("060") // past the last, the nearest before
    // a whole-chapter citation ("Genesis xxiii.") covers every verse
    expect(sceneAt(1, 23, 19)?.title).toBe("The Burial of Sarah")
  })
})

describe("parsing the gallery", () => {
  test("captions end with a citation in roman numerals", () => {
    expect(parseCaptionRef("…to keep the way of the tree of life.—Genesis iii, 22-24")).toEqual({ book: 1, chapter: 3, verseStart: 22, verseEnd: 24 })
    expect(parseCaptionRef("…all the people were gathered.—I Samuel xxiv, 2—22.")).toEqual({ book: 9, chapter: 24, verseStart: 2, verseEnd: 22 })
    expect(parseCaptionRef("…a burying place.—Genesis xxiii.")).toEqual({ book: 1, chapter: 23, verseStart: 1, verseEnd: null })
    expect(parseCaptionRef("…Daniel iii, 8, 9, 12-27.")).toEqual({ book: 27, chapter: 3, verseStart: 8, verseEnd: 27 })
    expect(parseCaptionRef("No citation here.")).toBeUndefined()
    expect(parseCaptionRef("—Genesis cc, 1")).toBeUndefined() // chapter 200
  })

  test("titles in title case, with the source's typos repaired", () => {
    expect(titleCase("THE EXPULSION FROM THE GARDEN.")).toBe("The Expulsion from the Garden")
    expect(titleCase("PRAYER OF, JESUS IN THE GARDEN OF' OLIVES.")).toBe("Prayer of Jesus in the Garden of Olives")
    expect(titleCase("DANIEL IN THE LIONS' DEN.")).toBe("Daniel in the Lions' Den")
    expect(titleCase("THE MARTYRDOM OF ST. STEPHEN.")).toBe("The Martyrdom of St. Stephen")
  })
})

describe("install", () => {
  const serve = (calls: string[], corrupt?: string) =>
    (async (url: string) => {
      const file = String(url).split("/").at(-1)!
      calls.push(file)
      const data = readFileSync(join(PLATE_DIR, file))
      return new Response(file === corrupt ? data.subarray(0, data.length - 1) : data)
    }) as unknown as typeof fetch

  test("fetches only what is missing, and verifies every plate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "selah-scenes-"))
    for (const p of PLATES.slice(0, 97)) writeFileSync(sceneFile(dir, p), readFileSync(join(PLATE_DIR, p.image.file)))
    expect(scenesInstalled(dir)).toBe(false)
    const calls: string[] = []
    const seen: number[] = []
    const r = await installScenes(dir, (e) => seen.push(e.done), serve(calls))
    expect(r).toEqual({ downloaded: 3, total: 100 })
    expect(calls.sort()).toEqual(["098.jpg", "099.jpg", "100.jpg"])
    expect(seen.at(-1)).toBe(100)
    expect(scenesInstalled(dir)).toBe(true)
    const p = PLATES[99]!
    expect(createHash("sha256").update(readFileSync(sceneFile(dir, p))).digest("hex")).toBe(p.image.sha256)
  })

  test("two installs at once share one: every plate is fetched once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "selah-scenes-"))
    const calls: string[] = []
    const a: number[] = []
    const b: number[] = []
    const [ra, rb] = await Promise.all([installScenes(dir, (e) => a.push(e.done), serve(calls)), installScenes(dir, (e) => b.push(e.done), serve(calls))])
    expect(ra).toEqual(rb)
    expect(calls).toHaveLength(100)
    expect(new Set(calls).size).toBe(100)
    expect(a.at(-1)).toBe(100)
    expect(b.at(-1)).toBe(100) // the joiner hears the progress too
    expect(scenesInstalled(dir)).toBe(true)
  })

  test("a plate every source keeps failing stops the install, reports nothing after, and a later run finishes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "selah-scenes-"))
    const calls: string[] = []
    const ok = serve(calls)
    let failing = true
    const flaky = (async (url: string) => {
      if (failing && String(url).endsWith("005.jpg")) return new Response("busy", { status: 503 })
      await new Promise((r) => setTimeout(r, 5)) // the other workers are mid-download when it fails
      return ok(url as never)
    }) as unknown as typeof fetch
    const seen: number[] = []
    // the mirror twice and Gutenberg four times, then a sentence naming both
    await expect(installScenes(dir, (e) => seen.push(e.done), flaky, { sleep: async () => {} })).rejects.toThrow(
      "Could not download plate 005 from selah.hallelx2.com: the server is busy (HTTP 503). Tried 2 times. Then: Could not download plate 005 from www.gutenberg.org: the server is busy (HTTP 503). Tried 4 times.",
    )
    const after = seen.length
    await new Promise((r) => setTimeout(r, 60))
    expect(seen.length).toBe(after) // nothing reported once it has failed
    expect(calls.length).toBeLessThan(20) // the others stopped instead of fetching the rest
    failing = false
    const r = await installScenes(dir, undefined, flaky, { sleep: async () => {} })
    expect(r.total).toBe(100)
    expect(scenesInstalled(dir)).toBe(true)
  })

  // the founder's report, 2026-10-11: Gutenberg answered 504 for plate 001 and the install died
  test("a server that times out once does not stop the install", async () => {
    const dir = mkdtempSync(join(tmpdir(), "selah-scenes-"))
    const calls: string[] = []
    const ok = serve(calls)
    const failed = new Set<string>()
    const busy = (async (url: string) => {
      const file = String(url).split("/").at(-1)!
      if (!failed.has(file)) {
        failed.add(file)
        return new Response("gateway timeout", { status: 504 })
      }
      return ok(url as never)
    }) as unknown as typeof fetch
    const r = await installScenes(dir, undefined, busy, { sleep: async () => {} })
    expect(r).toEqual({ downloaded: 100, total: 100 })
    expect(scenesInstalled(dir)).toBe(true)
  })

  test("the mirror comes first, and a plate it cannot give comes from Gutenberg", async () => {
    const dir = mkdtempSync(join(tmpdir(), "selah-scenes-"))
    const urls: string[] = []
    const ok = serve([])
    const mirrorMissing007 = (async (url: string) => {
      urls.push(String(url))
      if (String(url).startsWith("https://selah.hallelx2.com/") && String(url).endsWith("007.jpg")) return new Response("not here", { status: 404 })
      return ok(url as never)
    }) as unknown as typeof fetch
    await installScenes(dir, undefined, mirrorMissing007, { sleep: async () => {} })
    expect(scenesInstalled(dir)).toBe(true)
    expect(urls.filter((u) => u.includes("gutenberg"))).toEqual(["https://www.gutenberg.org/cache/epub/8710/images/007.jpg"])
    expect(urls.filter((u) => u.startsWith("https://selah.hallelx2.com/scenes/"))).toHaveLength(100)
  })

  test("SELAH_SCENES_SOURCE replaces both sources", () => {
    expect(scenesSources({ SELAH_SCENES_SOURCE: "https://example.org/dore" })).toEqual(["https://example.org/dore/"])
    expect(scenesSources({})).toEqual(["https://selah.hallelx2.com/scenes/", "https://www.gutenberg.org/cache/epub/8710/images/"])
  })

  test("a plate that does not match its checksum is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "selah-scenes-"))
    await expect(installScenes(dir, undefined, serve([], "042.jpg"), { sleep: async () => {} })).rejects.toThrow("plate 042 did not match its pinned checksum")
  })
})
