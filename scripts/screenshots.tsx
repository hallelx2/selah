// Renders real frames of the app (test renderer, seeded history) to SVG and PNG for the README.
// Run: bun scripts/screenshots.tsx
import type { CapturedFrame, RGBA } from "@opentui/core"
import { harness } from "../test/harness"
import { seededStore } from "../test/seed"

const CW = 9.6
const CH = 20
const hex = (c: RGBA) => `#${[c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function svg(frame: CapturedFrame, background: string): string {
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
    for (const span of line.spans) {
      const x = col * CW
      const y = row * CH
      const width = span.width * CW
      if (span.bg.a > 0) out.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${(width + 0.6).toFixed(1)}" height="${CH}" fill="${hex(span.bg)}" fill-opacity="${span.bg.a.toFixed(2)}"/>`)
      if (span.text.trim()) {
        const bold = span.attributes & 1 ? ` font-weight="bold"` : ""
        const italic = span.attributes & 4 ? ` font-style="italic"` : ""
        // Place each cell explicitly so wide and block glyphs stay on the grid.
        const chars = Array.from(span.text)
        const xs = chars.map((_, i) => (x + i * CW).toFixed(1)).join(" ")
        out.push(`<text x="${xs}" y="${y + 15}" fill="${hex(span.fg)}"${bold}${italic} xml:space="preserve">${esc(span.text)}</text>`)
      }
      col += span.width
    }
  })
  out.push("</g></svg>")
  return out.join("\n")
}

async function shot(name: string, setup: Parameters<typeof harness>[0], act?: (h: Awaited<ReturnType<typeof harness>>) => Promise<void>) {
  const h = await harness({ width: 120, height: 38, ...setup })
  await act?.(h)
  await new Promise((r) => setTimeout(r, 200))
  await h.settle()
  const frame = h.spans()
  const bg = frame.lines[0]?.spans[0]?.bg
  const file = `docs/screenshots/${name}.svg`
  await Bun.write(file, svg(frame, bg && bg.a > 0 ? hex(bg) : "#0a0a0a"))
  await Bun.$`rsvg-convert -z 1.5 ${file} -o docs/screenshots/${name}.png`.quiet()
  h.destroy()
  console.log(`wrote ${file}`)
}

const at = new Date(2026, 9, 8, 7, 30)
await shot("home", { store: seededStore(), start: at })
await shot("reader", { store: seededStore(), start: at, initial: { route: "reader", book: 43, chapter: 3, verse: 16 } }, async (h) => {
  await h.press("j")
  await h.press("h")
  await h.press("k")
})
await shot("progress", { store: seededStore(), start: at, height: 52, initial: { route: "progress" } })
await shot("palette", { store: seededStore(), start: at, initial: { route: "reader", book: 19, chapter: 23 } }, async (h) => {
  await h.press("p", { ctrl: true })
})
await shot("search", { store: seededStore(), start: at, initial: { route: "reader", book: 43, chapter: 4 } }, async (h) => {
  await h.press("/")
  await h.type("living water")
})
await shot("parallel", { store: seededStore(), start: at, width: 150, config: { theme: "catppuccin" }, initial: { route: "reader", book: 19, chapter: 23 } }, async (h) => {
  await h.press("T", { shift: true })
})
await shot("tokyonight", { store: seededStore(), start: at, config: { theme: "tokyonight", sidebar: true }, initial: { route: "reader", book: 45, chapter: 8, verse: 28 } })
process.exit(0)
