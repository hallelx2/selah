// Turns a captured OpenTUI frame (text, colours, attributes per cell run) into an SVG that
// looks like a terminal window. Shared by the screenshot and GIF scripts.
import type { CapturedFrame, RGBA } from "@opentui/core"

export const CW = 9.6
export const CH = 20
/** Where the cell grid starts inside the window the SVG draws. */
export const ORIGIN = { x: 24, y: 44 }
export const hex = (c: RGBA) => `#${[c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" })
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/**
 * `chars` is the same frame from captureCharFrame(). OpenTUI's captureSpans slices span text by
 * code point, so a grapheme with combining marks (pointed Hebrew, accented Greek) shifts every
 * later character in its span; the char frame has one grapheme per cell and is right. Glyphs
 * come from it, colours and widths from the spans.
 */
export function svg(frame: CapturedFrame, background: string, chars?: string): string {
  const grid = chars?.split("\n").map((l) => [...graphemes.segment(l)].map((g) => g.segment))
  const w = Math.ceil(frame.cols * CW) + 48
  const h = frame.rows * CH + 48 + 28
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="100%" height="100%" rx="12" fill="${background}"/>`,
    `<circle cx="24" cy="20" r="6" fill="#ff5f57"/><circle cx="44" cy="20" r="6" fill="#febc2e"/><circle cx="64" cy="20" r="6" fill="#28c840"/>`,
    `<g transform="translate(24 44)" font-family="JetBrainsMono Nerd Font, JetBrains Mono, monospace" font-size="16">`,
  ]
  frame.lines.forEach((line, row) => {
    let col = 0
    for (const original of line.spans) {
      const cells = grid?.[row]
      const span = cells && cells.length >= col + original.width ? { ...original, text: cells.slice(col, col + original.width).join("") } : original
      const x = col * CW
      const y = row * CH
      const width = span.width * CW
      if (span.bg.a > 0) out.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${(width + 0.6).toFixed(1)}" height="${CH}" fill="${hex(span.bg)}" fill-opacity="${span.bg.a.toFixed(2)}"/>`)
      if (span.text.trim()) {
        const bold = span.attributes & 1 ? ` font-weight="bold"` : ""
        const italic = span.attributes & 4 ? ` font-style="italic"` : ""
        // One cell per grapheme, as the terminal draws it. Runs of plain characters get an x per
        // character; a grapheme with combining marks (Hebrew points, Greek accents) or a
        // right-to-left letter gets its own element, so the SVG renderer can neither split its
        // marks into cells nor reorder it with bidi.
        const attrs = `y="${y + 15}" fill="${hex(span.fg)}"${bold}${italic} xml:space="preserve"`
        let run: { x: number; chars: string[] } | undefined
        const flush = () => {
          if (run?.chars.length) out.push(`<text x="${run.chars.map((_, i) => (run!.x + i * CW).toFixed(1)).join(" ")}" ${attrs}>${esc(run.chars.join(""))}</text>`)
          run = undefined
        }
        let cell = 0
        for (const { segment: g } of graphemes.segment(span.text)) {
          const gx = x + cell * CW
          if ([...g].length > 1 || /[\u0590-\u08FF]/.test(g)) {
            flush()
            if (g.trim()) out.push(`<text x="${gx.toFixed(1)}" ${attrs}>${esc(g)}</text>`)
          } else {
            run ??= { x: gx, chars: [] }
            run.chars.push(g)
          }
          cell += 1
        }
        flush()
      }
      col += span.width
    }
  })
  out.push("</g></svg>")
  return out.join("\n")
}

