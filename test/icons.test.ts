import { describe, expect, test } from "bun:test"
import { ICON_NAMES, fallbackOf, icon, iconPrefix, nerdOf } from "../src/ui/icons"

describe("icons", () => {
  test("every fallback is exactly one terminal column wide", () => {
    for (const name of ICON_NAMES) expect([name, Bun.stringWidth(fallbackOf(name))]).toEqual([name, 1])
  })

  test("every Nerd glyph is a single private-use codepoint", () => {
    for (const name of ICON_NAMES) {
      const cp = nerdOf(name).codePointAt(0)!
      expect([name, [...nerdOf(name)].length, cp >= 0xe000 && cp <= 0xf8ff]).toEqual([name, 1, true])
    }
  })

  test("none renders nothing and leaves no stray space", () => {
    expect(icon("book", "none")).toBe("")
    expect(iconPrefix("book", "none")).toBe("")
    expect(iconPrefix("book", "unicode")).toBe("▤ ")
  })
})
