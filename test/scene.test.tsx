// The scene view (HAL-2582): Doré's engraving surfacing like ink, then drifting, in blocks mode.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DRIFT_FPS, DRIFT_MS, REVEAL_MS } from "../src/ui/scene"
import { harness, type Harness } from "./harness"

let h: Harness | undefined
afterEach(() => {
  h?.destroy()
  h = undefined
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Rows of the image area that have anything drawn in them. */
function inkedRows(frame: string): number {
  const lines = frame.split("\n")
  const end = lines.findIndex((l) => l.includes("Jesus and the Woman of Samaria  ·"))
  return lines.slice(1, end).filter((l) => l.trim().length > 0).length
}
const imageArea = (frame: string) => {
  const lines = frame.split("\n")
  return lines.slice(1, lines.findIndex((l) => l.includes("  ·  John"))).join("\n")
}

async function openScene(opts: Parameters<typeof harness>[0] = {}) {
  const hh = await harness({ width: 120, height: 40, initial: { route: "reader", book: 43, chapter: 4, verse: 7 }, ...opts })
  await hh.press("i")
  await wait(150) // the image decodes off the render loop
  await hh.settle()
  return hh
}

describe("scenes in the reader", () => {
  test("the header marks a chapter with an engraving, and only then", async () => {
    h = await harness({ width: 140, height: 30, initial: { route: "reader", book: 43, chapter: 4, verse: 7 } })
    expect(h.frame().split("\n")[0]).toContain("✦ Jesus and the Woman of Samaria i")
    await h.press("p") // John 3 has none
    expect(h.frame().split("\n")[0]).not.toContain("✦")
    await h.press("i")
    expect(h.frame()).toContain("No Doré engraving for John 3")
  })

  test("i opens the scene: title, passage, caption, attribution", async () => {
    h = await openScene()
    const f = h.frame()
    expect(f).toContain("Gustave Doré · The Bible Gallery")
    expect(f).toContain("plate 78 of 100")
    expect(f).toContain("Jesus and the Woman of Samaria  ·  John 4:5–26")
    expect(f).toContain("Then cometh he to a city of Samaria")
    expect(f).toContain("public domain")
  })

  test("the footer fits a narrow terminal without the attribution running into the keys", async () => {
    h = await harness({ width: 100, height: 36, initial: { route: "reader", book: 43, chapter: 4, verse: 7 } })
    await h.press("i")
    const last = h.frame().trimEnd().split("\n").at(-1)!
    expect(last).toMatch(/Doré, 1866 · public domain\s{2,}←\/→ plates/)
  })

  test("reduced motion: the engraving is there at once, and holds still", async () => {
    h = await openScene()
    const rows = inkedRows(h.frame())
    expect(rows).toBeGreaterThan(20)
    const before = imageArea(h.frame())
    h.advance(DRIFT_MS / 2)
    await h.settle()
    expect(imageArea(h.frame())).toBe(before)
  })

  test("full motion: rows surface top to bottom over the reveal, then settle", async () => {
    h = await openScene({ config: { motion: "full" } })
    const seen: number[] = [inkedRows(h.frame())]
    for (let t = 0; t < REVEAL_MS + 400; t += 200) {
      h.advance(200)
      await h.settle()
      seen.push(inkedRows(h.frame()))
    }
    const full = seen.at(-1)!
    expect(seen[0]).toBeLessThan(full / 3) // it begins nearly blank
    expect(seen.some((n) => n > full / 3 && n < full)).toBe(true) // part way
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!) // never recedes
    expect(full).toBeGreaterThan(20)
    // the wet edge is drawn only while it surfaces
    expect(imageArea(h.frame())).not.toMatch(/[▓▒░]/)
  })

  test("after the reveal, the engraving drifts", async () => {
    h = await openScene({ config: { motion: "full" } })
    h.advance(REVEAL_MS + 100)
    await h.settle()
    h.advance(50)
    await h.settle()
    const settled = imageArea(h.frame())
    h.advance(DRIFT_MS / 2)
    await wait(1000 / DRIFT_FPS + 40) // the drift's own clock ticks
    await h.settle()
    expect(imageArea(h.frame())).not.toBe(settled)
  })

  test("→ walks the gallery, enter reads the passage, esc closes", async () => {
    h = await openScene()
    await h.press("right")
    expect(h.frame()).toContain("plate 79 of 100")
    expect(h.frame()).toContain("Jesus and the Woman Taken in Adultery")
    await h.press("left")
    await h.press("left")
    expect(h.frame()).toContain("plate 77 of 100")
    await h.press("right")
    await h.press("return")
    expect(h.app().scene()).toBeUndefined()
    expect(h.frame()).toContain("John 4 · KJV")
    expect(h.frame()).toContain("verse 5/54")
    await h.press("i")
    expect(h.app().scene()?.id).toBe("078")
    await h.press("escape")
    expect(h.app().scene()).toBeUndefined()
  })

  test("g opens the gallery over the scene; choosing a plate shows it", async () => {
    h = await openScene()
    await h.press("g")
    expect(h.frame()).toContain("Doré Bible Gallery")
    await h.type("pale horse")
    await h.press("return")
    expect(h.frame()).toContain("Death on the Pale Horse  ·  Revelation 6:7–8")
  })

  test("a failed install says why and can be retried with i", async () => {
    const dir = mkdtempSync(join(tmpdir(), "selah-scenes-ui-"))
    let failing = true
    const local = (async (url: string) => {
      const file = String(url).split("/").at(-1)!
      // a 404 is reported at once (a 503 would be retried, which the scenes unit tests cover)
      if (failing && file === "010.jpg") return new Response("missing", { status: 404 })
      await wait(2)
      return new Response(readFileSync(join(import.meta.dir, "..", ".selah-test-sources", "dore-8710", file)))
    }) as unknown as typeof fetch
    h = await openScene({ scenesDir: dir, fetch: local })
    await h.press("i")
    for (let i = 0; i < 60 && !h.frame().includes("HTTP 404"); i++) {
      await wait(50)
      await h.settle()
    }
    await wait(100) // the other downloads wind down
    await h.settle()
    expect(h.frame()).toContain("Could not download plate 010")
    expect(h.frame()).toContain("it is not there (HTTP 404)")
    expect(h.frame()).toContain("press i to install") // not a frozen bar
    failing = false
    await h.press("i")
    for (let i = 0; i < 100 && !h.frame().includes("Then cometh he"); i++) {
      await wait(100)
      await h.settle()
    }
    expect(h.frame()).toContain("Then cometh he to a city of Samaria")
  }, 60_000)

  test("not installed: it offers the download and installs with i", async () => {
    const dir = mkdtempSync(join(tmpdir(), "selah-scenes-ui-"))
    const local = (async (url: string) =>
      new Response(readFileSync(join(import.meta.dir, "..", ".selah-test-sources", "dore-8710", String(url).split("/").at(-1)!)))) as unknown as typeof fetch
    h = await openScene({ scenesDir: dir, fetch: local })
    expect(h.frame()).toContain("press i to install")
    expect(h.frame()).toMatch(/About 1\d MB/)
    await h.press("i")
    for (let i = 0; i < 100 && !h.frame().includes("Then cometh he"); i++) {
      await wait(100)
      await h.settle()
    }
    expect(h.frame()).toContain("Then cometh he to a city of Samaria")
  }, 60_000)
})
