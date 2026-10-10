import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { BASE_TOKENS, THEME_NAMES, resolveTheme, systemTheme, themeJson } from "../src/theme"

describe("themes", () => {
  test("ships opencode's full set", () => {
    expect(THEME_NAMES.length).toBeGreaterThanOrEqual(33)
    expect(THEME_NAMES[0]).toBe("opencode")
    for (const name of ["catppuccin", "tokyonight", "rosepine", "gruvbox", "nord", "everforest", "kanagawa", "dracula"]) {
      expect(THEME_NAMES).toContain(name)
    }
  })

  for (const name of THEME_NAMES) {
    test(`${name}: every token resolves in dark and light`, () => {
      const json = themeJson(name)!
      for (const mode of ["dark", "light"] as const) {
        const t = resolveTheme(name, json, mode)
        for (const token of BASE_TOKENS) expect(t[token]).toBeInstanceOf(RGBA)
        expect(t.highlight).toHaveLength(4)
        expect(t.heat).toHaveLength(5)
      }
    })
  }

  test("heat levels get steadily closer to the success colour", () => {
    const t = resolveTheme("opencode", themeJson("opencode")!, "dark")
    const dist = (c: RGBA) => Math.hypot(c.r - t.success.r, c.g - t.success.g, c.b - t.success.b)
    for (let i = 2; i < 5; i++) expect(dist(t.heat[i]!)).toBeLessThan(dist(t.heat[i - 1]!))
  })

  test("the system theme follows the terminal palette", () => {
    const json = systemTheme({
      palette: ["#1e1e2e", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de"],
      defaultBackground: "#1e1e2e",
      defaultForeground: "#cdd6f4",
    } as never)
    const t = resolveTheme("system", json, "dark")
    expect(t.primary).toEqual(RGBA.fromHex("#89b4fa"))
    expect(t.background.a).toBe(0)
    expect(t.text).toEqual(RGBA.fromHex("#cdd6f4"))
  })
})
