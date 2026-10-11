// HAL-2658: ctrl+o opens today's reading wherever help and the plan toast say it does.
import { afterEach, describe, expect, test } from "bun:test"
import { bookById } from "../src/data/books"
import { UserStore } from "../src/data/user"
import { harness, type Harness } from "./harness"
import { seededStore } from "./seed"

let h: Harness | undefined
afterEach(() => {
  h?.destroy()
  h = undefined
})
const at = new Date(2026, 9, 11, 7, 30)
// these assert what ctrl+o does, not how fast: a busy machine must not fail them
const SLOW = 60_000

/** The chapter the active plan says to read next, as the header names it. */
function nextReading(hh: Harness) {
  const next = hh.app().activePlan()!.status.next.chapters[0]!
  return `${bookById(next.book).name} ${next.chapter}`
}
const header = (hh: Harness) => hh.frame().split("\n")[0]!

describe("ctrl+o, today's reading", () => {
  test("in the reader, it opens the plan's next chapter (found recording the product demo)", async () => {
    h = await harness({ store: seededStore("2026-10-11"), start: at, initial: { route: "reader", book: 43, chapter: 3, verse: 1 } })
    const expected = nextReading(h)
    expect(header(h)).not.toContain(expected)
    await h.press("o", { ctrl: true })
    expect(header(h)).toContain(expected)
  }, SLOW)

  test("in the reader with no plan, it offers the plans", async () => {
    const store = UserStore.memory()
    store.setPosition({ book: 43, chapter: 3, verse: 1, translation: "KJV" })
    h = await harness({ store, start: at, initial: { route: "reader", book: 43, chapter: 3, verse: 1 } })
    await h.press("o", { ctrl: true })
    expect(h.frame()).toContain("Reading plan")
  }, SLOW)

  test("with the study pane focused, it still opens today's reading", async () => {
    h = await harness({ width: 160, store: seededStore("2026-10-11"), start: at, initial: { route: "reader", book: 43, chapter: 3, verse: 1 } })
    const expected = nextReading(h)
    await h.press("tab")
    await h.press("2")
    await h.press("o", { ctrl: true })
    expect(header(h)).toContain(expected)
  }, SLOW)

  test("right after starting a plan, as its toast says", async () => {
    h = await harness({ store: seededStore("2026-10-11"), start: at, initial: { route: "reader", book: 43, chapter: 3, verse: 1 } })
    await h.press("p", { ctrl: true })
    await h.type("plan")
    await h.press("return")
    await h.type("gospels")
    await h.press("return")
    expect(h.frame()).toContain("Ctrl+O opens today's reading")
    await h.press("o", { ctrl: true })
    expect(header(h)).toContain("Matthew 1")
  }, SLOW)

  test("on the progress screen ctrl+o is today's reading too, and o still chooses a plan", async () => {
    h = await harness({ store: seededStore("2026-10-11"), start: at, initial: { route: "progress" } })
    const expected = nextReading(h)
    await h.press("o")
    expect(h.frame()).toContain("Reading plan")
    await h.press("escape")
    await h.press("o", { ctrl: true })
    expect(header(h)).toContain(expected)
  }, SLOW)
})
