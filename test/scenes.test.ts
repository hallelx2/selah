// Doré's engravings (HAL-2582): the catalogue, its mapping to passages, and the install.
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseCaptionRef, titleCase } from "../scripts/dore-catalogue"
import { bookById } from "../src/data/books"
import { installScenes, PLATES, sceneAt, sceneFile, scenesFor, scenesInstalled } from "../src/data/scenes"
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

  test("a plate that does not match its checksum is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "selah-scenes-"))
    await expect(installScenes(dir, undefined, serve([], "042.jpg"))).rejects.toThrow("Plate 042 did not match its pinned checksum")
  })
})
