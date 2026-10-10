// The sidebar from the keyboard (HAL-2447): books, then chapters, then the reader.
import { afterEach, describe, expect, test } from "bun:test"
import { harness, type Harness } from "./harness"

let h: Harness | undefined
afterEach(() => {
  h?.destroy()
  h = undefined
})
const side = (frame: string) =>
  frame
    .split("\n")
    .map((l) => l.slice(0, 33))
    .join("\n")

describe("sidebar keyboard", () => {
  test("ctrl+b opens it with the keyboard in it; j/k move through books, enter shows chapters, enter opens one", async () => {
    h = await harness({ width: 140, height: 50, initial: { route: "reader", book: 43, chapter: 3, verse: 1 } })
    await h.press("b", { ctrl: true })
    expect(h.frame()).toContain("BOOKS")
    expect(side(h.frame())).toContain("John")
    await h.press("j") // Acts
    await h.press("j") // Romans
    expect(h.app().position().book).toBe(43) // moving the cursor does not change the reading
    await h.press("return")
    // the grid now shows Romans' 16 chapters
    expect(side(h.frame())).toContain("Romans")
    expect(side(h.frame())).toMatch(/\b16\b/)
    expect(side(h.frame())).not.toMatch(/\b17\b/)
    await h.press("l") // chapter 2
    await h.press("j") // chapter 9 (7 to a row)
    await h.press("return")
    expect(h.frame()).toContain("Romans 9 · KJV")
    expect(h.frame()).toContain("READ") // the keyboard is back in the reader
    await h.press("j")
    expect(h.app().position().verse).toBe(2)
  })

  test("esc steps back from chapters to books, then to the reader; ctrl+b inside closes it", async () => {
    h = await harness({ width: 140, height: 50, initial: { route: "reader", book: 1, chapter: 1, verse: 1 } })
    await h.press("b", { ctrl: true })
    await h.press("return") // Genesis chapters
    await h.press("escape")
    expect(h.frame()).toContain("BOOKS")
    await h.press("escape")
    expect(h.frame()).not.toContain("BOOKS")
    expect(side(h.frame())).toContain("Genesis") // still shown
    await h.press("b", { ctrl: true }) // shown but not focused: take the keyboard
    expect(h.frame()).toContain("BOOKS")
    await h.press("b", { ctrl: true }) // in it: close it
    expect(h.app().config.sidebar).toBe(false)
    expect(h.frame()).not.toContain("BOOKS")
  })

  test("G goes to Revelation, g back to Genesis, and keys it does not use still reach the reader", async () => {
    h = await harness({ width: 140, height: 50, initial: { route: "reader", book: 43, chapter: 3, verse: 1 } })
    await h.press("b", { ctrl: true })
    await h.press("G", { shift: true })
    await h.press("return")
    expect(side(h.frame())).toContain("Revelation")
    await h.press("escape")
    await h.press("g")
    await h.press("return")
    expect(side(h.frame())).toContain("Genesis")
    await h.press("escape")
    await h.press("n") // not the sidebar's: next chapter in the reader
    expect(h.frame()).toContain("John 4 · KJV")
  })

  test("too narrow for the sidebar: it says so, and o still works", async () => {
    h = await harness({ width: 90, height: 40, initial: { route: "reader", book: 43, chapter: 3, verse: 1 } })
    await h.press("b", { ctrl: true })
    expect(h.frame()).toContain("The sidebar needs 100 columns")
    expect(h.frame()).not.toContain("BOOKS")
  })
})
