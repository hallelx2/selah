// Builds selah.hallelx2.com into site/dist: the page, the wordmark drawn from the app's own
// block-letter logo, the two installers (copied from the repo, so there is one source for
// each), the demo video, and Cloudflare Pages headers.
//
//   bun site/build.ts            then  wrangler pages deploy site/dist --project-name selah
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import pkg from "../package.json"
import { LOGO } from "../src/ui/components/logo"

const root = join(import.meta.dir, "..")
const out = join(import.meta.dir, "dist")
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// --- the wordmark: the same glyph grid the terminal draws, as pixels ---------------------------
// Each character cell is 1 unit wide and 2 tall (upper and lower half). In the app, `_` is a
// shadowed space, `^` a lit upper half over a shadow, `~` a shadow-only upper half; colours run
// from the theme's primary to its accent across the width, shadows are 28% of the colour.
const PRIMARY = [0xfa, 0xb2, 0x83] // opencode theme, dark
const ACCENT = [0x9d, 0x7c, 0xd8]
const BG = [0x0a, 0x0a, 0x0a]
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i]! - x) * t))
const css = (c: number[]) => `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`
function wordmark(cellW: number, cellH: number, mono?: string, ground = BG): string {
  const width = LOGO[0]!.length
  const rects: string[] = []
  LOGO.forEach((line, row) => {
    Array.from(line).forEach((ch, x) => {
      const fg = mono ?? css(mix(PRIMARY, ACCENT, x / (width - 1)))
      // the shadow is the letter's colour faded into the page it sits on
      const shadow = mono ? `${mono}55` : css(mix(ground, mix(PRIMARY, ACCENT, x / (width - 1)), ground === BG ? 0.28 : 0.35))
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
writeFileSync(join(out, "logo.svg"), wordmark(4, 4))
// the favicon: the S, the first four columns of the same grid
const S = LOGO.map((l) => l.slice(0, 4))
{
  const rects: string[] = []
  S.forEach((line, row) =>
    Array.from(line).forEach((ch, x) => {
      const fg = css(mix(PRIMARY, ACCENT, x / 3))
      const shadow = css(mix(BG, mix(PRIMARY, ACCENT, x / 3), 0.35))
      const cell = (y: number, c: string) => rects.push(`<rect x="${x * 4 + 2}" y="${y * 4 + 4}" width="4" height="4" fill="${c}"/>`)
      if (ch === "█") (cell(row * 2, fg), cell(row * 2 + 1, fg))
      else if (ch === "▀") cell(row * 2, fg)
      else if (ch === "^") (cell(row * 2, fg), cell(row * 2 + 1, shadow))
      else if (ch === "_") (cell(row * 2, shadow), cell(row * 2 + 1, shadow))
    }),
  )
  writeFileSync(
    join(out, "favicon.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 32" shape-rendering="crispEdges"><rect width="20" height="32" rx="3" fill="#0a0a0a"/>${rects.join("")}</svg>`,
  )
}

// --- figures, drawn like opencode's: thin strokes on the page --------------------------------
// Fig 1: a year of reading, one cell a day, from a fixed seed (an illustration of the heatmap)
function heatmap(): string {
  let seed = 11
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31)
  const cells: string[] = []
  for (let w = 0; w < 30; w++)
    for (let d = 0; d < 7; d++) {
      const streak = w > 8 && w < 27 ? 0.8 : 0.35
      const level = rand() < streak ? 1 + Math.floor(rand() * 4) : 0
      const o = [0.08, 0.3, 0.5, 0.72, 0.95][level]
      cells.push(`<rect x="${w * 7}" y="${d * 7}" width="5" height="5" fill="currentColor" opacity="${o}"/>`)
    }
  return `<svg viewBox="0 0 208 47" aria-hidden="true">${cells.join("")}</svg>`
}
// Fig 2: the original words, one bar per book (OT then NT), as counted by the real import
// (site/words-per-book.json, measured from `selah install concordance`)
const WORDS = JSON.parse(readFileSync(join(import.meta.dir, "words-per-book.json"), "utf8")) as { total: number; perBook: number[] }
const WORDS_PER_BOOK = WORDS.perBook
function wordBars(): string {
  const max = Math.max(...WORDS_PER_BOOK)
  const bars = WORDS_PER_BOOK.map((n, i) => {
    const h = Math.max(1, Math.round((n / max) * 100))
    return `<line x1="${i * 3 + 1}" x2="${i * 3 + 1}" y1="104" y2="${104 - h}" stroke="currentColor" stroke-width="1.4" opacity="${i < 39 ? 0.55 : 0.95}"/>`
  })
  return `<svg viewBox="0 0 200 106" aria-hidden="true">${bars.join("")}</svg>`
}
// Fig 3: Doré's 100 plates, ten by ten
function plates(): string {
  const r: string[] = []
  for (let i = 0; i < 100; i++) r.push(`<rect x="${(i % 10) * 10}" y="${Math.floor(i / 10) * 10}" width="7.5" height="7.5" fill="none" stroke="currentColor" stroke-width="0.8" opacity="${0.35 + ((i * 37) % 60) / 100}"/>`)
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${r.join("")}</svg>`
}

// --- the page ---------------------------------------------------------------------------------
const page = readFileSync(join(import.meta.dir, "index.html"), "utf8")
  .replaceAll("{{version}}", pkg.version)
  .replace("{{logo}}", `<span class="logo-dark">${wordmark(3, 3)}</span><span class="logo-light">${wordmark(3, 3, undefined, [0xfd, 0xfc, 0xfc])}</span>`)
  .replace("{{fig-heatmap}}", heatmap())
  .replace("{{fig-words}}", wordBars())
  .replace("{{fig-plates}}", plates())
  .replaceAll("{{words-total}}", WORDS.total.toLocaleString("en-US"))
writeFileSync(join(out, "index.html"), page)
copyFileSync(join(import.meta.dir, "styles.css"), join(out, "styles.css"))
copyFileSync(join(import.meta.dir, "site.js"), join(out, "site.js"))

// --- the installers, at short paths on the domain ----------------------------------------------
copyFileSync(join(root, "install.sh"), join(out, "install"))
copyFileSync(join(root, "install.sh"), join(out, "install.sh"))
copyFileSync(join(root, "install.ps1"), join(out, "install.ps1"))

// --- the demo ---------------------------------------------------------------------------------
for (const f of ["selah-demo.mp4", "selah-demo.webm", "selah-demo-poster.png"]) {
  const src = join(root, "docs", "demo", f)
  if (existsSync(src)) copyFileSync(src, join(out, f))
  else console.warn(`missing ${src}; run bun scripts/demo.tsx`)
}

// --- headers: installers as text, long caching for media ------------------------------------
writeFileSync(
  join(out, "_headers"),
  `/install
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, max-age=300
/install.sh
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, max-age=300
/install.ps1
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, max-age=300
/*.mp4
  Cache-Control: public, max-age=604800
/*.webm
  Cache-Control: public, max-age=604800
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
`,
)
console.log(`built ${out}`)
