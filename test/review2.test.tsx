// Regression tests for the PR #2 review findings (HAL-2574), one per finding.
import { afterEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Bible } from "../src/data/bible"
import { openBibleDb } from "../src/data/db"
import { addDays } from "../src/data/dates"
import { UserStore } from "../src/data/user"
import { harness, type Harness } from "./harness"
import { seededStore } from "./seed"

let h: Harness | undefined
afterEach(() => {
  h?.destroy()
  h = undefined
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const tick = async (hh: Harness, ms = 40) => {
  await wait(ms)
  await hh.settle()
}
const count = (s: string, ch: string) => s.split(ch).length - 1
const BARS = /[▁▂▃▄▅▆▇█]/g

async function progressFrame(motion: "full" | "reduced") {
  const hh = await harness({ config: { motion }, store: seededStore(), width: 130, height: 70, initial: { route: "progress" } })
  hh.advance(3_000)
  await tick(hh)
  const f = hh.frame()
  hh.destroy()
  return f
}

describe("1 and 2. the progress intro settles on the full picture", () => {
  test("with motion, the heatmap and the bars end exactly as with reduced motion", async () => {
    const reduced = await progressFrame("reduced")
    const full = await progressFrame("full")
    expect(count(full, "■")).toBe(count(reduced, "■"))
    expect(full.match(BARS)?.length).toBe(reduced.match(BARS)?.length)
    expect(full).toBe(reduced)
  })
})

describe("3. first launch", () => {
  test("asks the icon question once the library is set up", async () => {
    const file = join(tmpdir(), `selah-first-icons-${process.pid}.db`)
    rmSync(file, { force: true })
    const db = openBibleDb(file)
    try {
      h = await harness({ bible: new Bible(db), config: { icons: undefined } })
      for (let i = 0; i < 100 && !h.frame().includes("One question"); i++) {
        await wait(100)
        await h.settle()
      }
      expect(h.frame()).toContain("One question")
    } finally {
      h?.destroy()
      h = undefined
      db.close()
      for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true })
    }
  }, 30_000)
})

describe("4. the streak nudge", () => {
  test("is driven by the motion clock: without clock time passing, nothing re-renders", async () => {
    const store = UserStore.memory()
    store.recordRead({ book: 40, chapter: 1, day: addDays("2026-10-08", -1), readAt: 0, source: "manual" })
    h = await harness({ config: { motion: "full" }, store, initial: { route: "reader", book: 43, chapter: 3 } })
    const colour = () => {
      const last = h!.spans().lines.at(-1)!
      const s = last.spans.find((x) => x.text.includes("▲"))
      return s ? `${s.fg.r},${s.fg.g},${s.fg.b}` : "missing"
    }
    await tick(h)
    const a = colour()
    await wait(1_700) // real time only: the breath has been scheduled, but the clock has not moved
    await h.settle()
    expect(colour()).toBe(a)
    expect(a).not.toBe("missing")
    h.advance(1_200) // mid-breath
    await tick(h)
    expect(colour()).not.toBe(a)
    h.advance(5_000) // breath over: back to rest, and nothing ticks until the next one
    await tick(h)
    expect(colour()).toBe(a)
  })
})

describe("5. prose label in parallel view", () => {
  test("the footer says READ, and w explains why prose is unavailable", async () => {
    h = await harness({ width: 160, config: { prose: true }, initial: { route: "reader", book: 43, chapter: 3 } })
    expect(h.frame()).toContain("PROSE")
    await h.press("T", { shift: true })
    expect(h.frame()).toContain("KJV ⇄ BSB")
    expect(h.frame()).not.toContain("PROSE")
    await h.press("w")
    expect(h.frame()).toContain("parallel")
  })
})
