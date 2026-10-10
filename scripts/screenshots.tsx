// Renders real frames of the app (test renderer, seeded history) to SVG and PNG for the README.
// Run: bun scripts/screenshots.tsx
import { hex, svg } from "./frame-svg"
import { harness } from "../test/harness"
import { seededStore } from "../test/seed"

// SHOTS=words,study renders only those
const only = process.env.SHOTS?.split(",")

async function shot(name: string, setup: Parameters<typeof harness>[0], act?: (h: Awaited<ReturnType<typeof harness>>) => Promise<void>) {
  if (only && !only.includes(name)) return
  const h = await harness({ width: 120, height: 38, ...setup, config: { icons: "nerd", ...setup?.config } })
  await act?.(h)
  await new Promise((r) => setTimeout(r, 200))
  await h.settle()
  const frame = h.spans()
  const bg = frame.lines[0]?.spans[0]?.bg
  const file = `docs/screenshots/${name}.svg`
  await Bun.write(file, svg(frame, bg && bg.a > 0 ? hex(bg) : "#0a0a0a", h.frame()))
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
await shot("prose", { store: seededStore(), start: at, config: { prose: true, theme: "rosepine" }, initial: { route: "reader", book: 45, chapter: 8, verse: 28 } })
await shot("focus", { store: seededStore(), start: at, config: { theme: "kanagawa" }, initial: { route: "reader", book: 19, chapter: 23, verse: 4 } }, async (h) => {
  await h.press("z")
})
await shot("desk", { store: seededStore(), start: at, width: 190, height: 46, initial: { route: "reader", book: 43, chapter: 3, verse: 16 } }, async (h) => {
  await h.press("tab")
  await h.press("2")
})
await shot("words", { store: seededStore(), start: at, width: 190, height: 46, concordance: true, initial: { route: "reader", book: 19, chapter: 23, verse: 1 } }, async (h) => {
  await h.press("tab")
  await h.press("3")
  await h.press("j")
})
await shot("study", { store: seededStore(), start: at, width: 190, height: 46, concordance: true, config: { theme: "catppuccin" }, initial: { route: "reader", book: 62, chapter: 4, verse: 8 } }, async (h) => {
  await h.press("tab")
  await h.press("3")
  for (let i = 0; i < 10; i++) await h.press("j")
  await h.press("return")
})
await shot("scene", { store: seededStore(), start: at, width: 150, height: 46, config: { motion: "full", theme: "gruvbox" }, initial: { route: "reader", book: 43, chapter: 4, verse: 7 } }, async (h) => {
  await h.press("i")
  await new Promise((r) => setTimeout(r, 300))
  h.advance(2000)
  await h.settle()
})
await shot("tokyonight", { store: seededStore(), start: at, config: { theme: "tokyonight", sidebar: true }, initial: { route: "reader", book: 45, chapter: 8, verse: 28 } })
process.exit(0)
