// The wordmark as SVG: the same glyph grid the terminal draws for Selah's logo, as pixels. Shared
// by the site (site/build.ts) and the product demo's title cards (scripts/product-demo.tsx).
import { LOGO } from "../src/ui/components/logo"

// Each character cell is 1 unit wide and 2 tall (upper and lower half). In the app, `_` is a
// shadowed space, `^` a lit upper half over a shadow, `~` a shadow-only upper half; colours run
// from the theme's primary to its accent across the width, shadows are 28% of the colour.
export const PRIMARY = [0xfa, 0xb2, 0x83] // opencode theme, dark
export const ACCENT = [0x9d, 0x7c, 0xd8]
export const BG = [0x0a, 0x0a, 0x0a]
export const mix = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i]! - x) * t))
export const css = (c: number[]) => `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`
export function wordmark(cellW: number, cellH: number, ground = BG): string {
  const width = LOGO[0]!.length
  const rects: string[] = []
  LOGO.forEach((line, row) => {
    Array.from(line).forEach((ch, x) => {
      const fg = css(mix(PRIMARY, ACCENT, x / (width - 1)))
      // the shadow is the letter's colour faded into the page it sits on
      const shadow = css(mix(ground, mix(PRIMARY, ACCENT, x / (width - 1)), ground === BG ? 0.28 : 0.35))
      const top = row * 2
      const cell = (y: number, color: string) => rects.push(`<rect x="${x * cellW}" y="${y * cellH}" width="${cellW}" height="${cellH}" fill="${color}"/>`)
      if (ch === "█") (cell(top, fg), cell(top + 1, fg))
      else if (ch === "▀") cell(top, fg)
      else if (ch === "▄") cell(top + 1, fg)
      else if (ch === "^") (cell(top, fg), cell(top + 1, shadow))
      else if (ch === "_") (cell(top, shadow), cell(top + 1, shadow))
      else if (ch === "~") cell(top, shadow)
    })
  })
  const w = width * cellW
  const h = LOGO.length * 2 * cellH
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges" role="img" aria-label="Selah">${rects.join("")}</svg>`
}
