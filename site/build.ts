// Builds selah.hallelx2.com into site/dist.
//
//   bun site/build.ts            then  wrangler pages deploy site/dist --project-name selah
//
// Every figure on the site is measured here from the app's own data (the test fixture's imported
// KJV, the scenes catalogue, the theme files, the tracker's rules), every key comes from KEYS,
// the release pages come from the GitHub API, and the installers are copied from the repo, so
// there is one source for each. Network: the GitHub API (releases), and Project Gutenberg for
// any engraving not already cached; both are cached in site/.cache.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import pkg from "../package.json"
import { TOOLS } from "../src/agent/tools"
import { BOOKS, bookById, TOTAL_CHAPTERS } from "../src/data/books"
import { formatRef } from "../src/data/ref"
import { installScenes, PLATES } from "../src/data/scenes"
import { IDLE_MS, minimumReadMs } from "../src/data/tracker"
import { CATALOG } from "../src/data/translations"
import { LOGO } from "../src/ui/components/logo"
import { KEYS } from "../src/ui/keys"
import { fixtureBible } from "../test/fixture"
import { home } from "./home"
import { layout, ORIGIN, type Page } from "./layout"
import { changelogPage, downloadPage, engravingsPage, keyboard, keysPage, latestRelease, markdownPage, notFoundPage, type Plate, type Release } from "./pages"

const root = join(import.meta.dir, "..")
const out = join(import.meta.dir, "dist")
const cache = join(import.meta.dir, ".cache")
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
mkdirSync(cache, { recursive: true })
const write = (path: string, data: string | Uint8Array) => {
  mkdirSync(join(out, path, ".."), { recursive: true })
  writeFileSync(join(out, path), data)
}

// --- the wordmark: the same glyph grid the terminal draws, as pixels ---------------------------
// Each character cell is 1 unit wide and 2 tall (upper and lower half). In the app, `_` is a
// shadowed space, `^` a lit upper half over a shadow, `~` a shadow-only upper half; colours run
// from the theme's primary to its accent across the width, shadows are 28% of the colour.
const PRIMARY = [0xfa, 0xb2, 0x83] // opencode theme, dark
const ACCENT = [0x9d, 0x7c, 0xd8]
const BG = [0x0a, 0x0a, 0x0a]
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i]! - x) * t))
const css = (c: number[]) => `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`
function wordmark(cellW: number, cellH: number, ground = BG): string {
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
write("logo.svg", wordmark(4, 4))
const LOGO_HTML = `<span class="logo-dark">${wordmark(3, 3)}</span><span class="logo-light">${wordmark(3, 3, [0xfd, 0xfc, 0xfc])}</span>`
// the favicon: the S, the first four columns of the same grid
{
  const rects: string[] = []
  LOGO.map((l) => l.slice(0, 4)).forEach((line, row) =>
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
  write("favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 32" shape-rendering="crispEdges"><rect width="20" height="32" rx="3" fill="#0a0a0a"/>${rects.join("")}</svg>`)
}

// --- measurements -----------------------------------------------------------------------------
const bible = await fixtureBible()
const verses = (bible.db.query(`SELECT count(*) AS n FROM verses WHERE translation = 'KJV'`).get() as { n: number }).n
const WORDS = JSON.parse(readFileSync(join(import.meta.dir, "words-per-book.json"), "utf8")) as { total: number; perBook: number[] }
const themeCount = readdirSync(join(root, "src/theme/assets")).filter((f) => f.endsWith(".json")).length
const words = bible.chapterWords("KJV")
const example = (book: number, chapter: number) => {
  const n = words.get(`${book}:${chapter}`) ?? 0
  const name = bookById(book).name === "Psalms" ? "Psalm" : bookById(book).name // one psalm is a Psalm
  return { name: `${name} ${chapter}`, words: n, seconds: Math.round(minimumReadMs(n) / 1000) }
}
const stats = { books: BOOKS.length, chapters: TOTAL_CHAPTERS, verses, translations: CATALOG.length, words: WORDS.total, plates: PLATES.length, themes: themeCount }
console.log("measured", stats)

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
function wordBars(): string {
  const max = Math.max(...WORDS.perBook)
  const bars = WORDS.perBook.map((n, i) => {
    const h = Math.max(1, Math.round((n / max) * 100))
    return `<line x1="${i * 3 + 1}" x2="${i * 3 + 1}" y1="104" y2="${104 - h}" stroke="currentColor" stroke-width="1.4" opacity="${i < 39 ? 0.55 : 0.95}"/>`
  })
  return `<svg viewBox="0 0 200 106" aria-hidden="true">${bars.join("")}</svg>`
}
// Fig 3: Doré's plates, ten by ten
function plates(): string {
  const r: string[] = []
  for (let i = 0; i < PLATES.length; i++)
    r.push(`<rect x="${(i % 10) * 10}" y="${Math.floor(i / 10) * 10}" width="7.5" height="7.5" fill="none" stroke="currentColor" stroke-width="0.8" opacity="${0.35 + ((i * 37) % 60) / 100}"/>`)
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${r.join("")}</svg>`
}

// --- the releases, from GitHub ----------------------------------------------------------------
async function releases(): Promise<Release[]> {
  const file = join(cache, "releases.json")
  try {
    const res = await fetch("https://api.github.com/repos/hallelx2/selah/releases?per_page=100", { headers: { accept: "application/vnd.github+json", "user-agent": "selah-site-build" } })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    type Asset = { name: string; size: number; browser_download_url: string }
    const raw = (await res.json()) as { tag_name: string; name: string; published_at: string; body: string; html_url: string; draft: boolean; prerelease: boolean; assets: Asset[] }[]
    const list: Release[] = []
    for (const r of raw.filter((r) => !r.draft)) {
      const sumsAsset = r.assets.find((a) => a.name === "SHA256SUMS")
      const sums = new Map<string, string>()
      if (sumsAsset) {
        const text = await (await fetch(sumsAsset.browser_download_url)).text()
        for (const line of text.split("\n")) {
          const [hash, name] = line.trim().split(/\s+\*?/)
          if (hash && name) sums.set(name, hash)
        }
      }
      list.push({
        tag: r.tag_name,
        name: r.name,
        date: r.published_at,
        html: Bun.markdown.html(r.body ?? ""),
        url: r.html_url,
        prerelease: r.prerelease,
        assets: r.assets.map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url, sha256: sums.get(a.name) })),
      })
    }
    writeFileSync(file, JSON.stringify(list))
    return list
  } catch (e) {
    if (!existsSync(file)) throw e
    console.warn(`releases: ${(e as Error).message}; using the cached copy`)
    return JSON.parse(readFileSync(file, "utf8"))
  }
}
const allReleases = await releases()
const latest = latestRelease(allReleases)

// --- the engravings: the app's own installer fetches and checks each plate --------------------
const dore = join(cache, "dore")
mkdirSync(dore, { recursive: true })
const testCopy = join(root, ".selah-test-sources", "dore-8710")
for (const p of PLATES) {
  const src = join(testCopy, p.image.file)
  if (!existsSync(join(dore, p.image.file)) && existsSync(src)) copyFileSync(src, join(dore, p.image.file))
}
await installScenes(dore)
const webp = join(cache, "dore-webp")
mkdirSync(join(webp, "thumb"), { recursive: true })
mkdirSync(join(webp, "full"), { recursive: true })
for (let i = 0; i < PLATES.length; i += 12)
  await Promise.all(
    PLATES.slice(i, i + 12).map(async (p) => {
      const src = join(dore, p.image.file)
      const thumb = join(webp, "thumb", `${p.id}.webp`)
      const full = join(webp, "full", `${p.id}.webp`)
      if (!existsSync(thumb)) await Bun.$`vips thumbnail ${src} ${thumb}[Q=76,strip] 360`.quiet()
      if (!existsSync(full)) await Bun.$`vips copy ${src} ${full}[Q=84,strip]`.quiet()
    }),
  )
cpSync(webp, join(out, "engravings"), { recursive: true })
// the app's first source for the plates (SCENES_MIRROR): the pinned JPEGs, byte for byte, each
// already checked against its SHA-256 by installScenes above
mkdirSync(join(out, "scenes"), { recursive: true })
for (const p of PLATES) copyFileSync(join(dore, p.image.file), join(out, "scenes", p.image.file))
const plateList: Plate[] = PLATES.map((p) => ({
  id: p.id,
  title: p.title,
  // two plates show the Apocrypha, which is on none of the 66 books
  ref: p.ref ? formatRef({ book: p.ref.book, chapter: p.ref.chapter, verseStart: p.ref.verseStart, verseEnd: p.ref.verseEnd ?? undefined } as never) : "The Apocrypha",
  testament: p.ref ? (bookById(p.ref.book).testament as "OT" | "NT") : "AP",
  caption: p.caption,
  width: p.image.width,
  height: p.image.height,
}))

// --- the docs' pictures: the README's real screenshots, as WebP --------------------------------
mkdirSync(join(out, "docs-img"), { recursive: true })
await Promise.all(
  ["home", "reader", "prose", "desk", "words", "study", "scene", "search", "palette", "progress", "parallel"].map(
    (n) => Bun.$`vips thumbnail ${join(root, "docs/screenshots", `${n}.png`)} ${join(out, "docs-img", `${n}.webp`)}[Q=82,strip] 1400`.quiet(),
  ),
)
const help = (await Bun.$`bun ${join(root, "src/index.tsx")} --help`.env({ ...process.env, SELAH_HOME: "/selah-home" }).text())
  .replace(/^Data lives in.*$/m, "")
  .trim()

// --- the pages --------------------------------------------------------------------------------
const pages: Page[] = [
  {
    path: "/",
    title: "Selah, a Bible for the terminal",
    description: "Read the Bible in your terminal. Notes, Matthew Henry, the Hebrew and Greek, Doré's engravings, an honest reading streak, and your own Claude or Codex to ask. Open source.",
    body: home({
      version: pkg.version,
      stats,
      streak: { idleMinutes: IDLE_MS / 60_000, short: example(19, 117), long: example(19, 119) },
      themes: [
        ["opencode", "opencode"],
        ["tokyonight", "Tokyo Night"],
        ["catppuccin", "Catppuccin"],
        ["gruvbox", "Gruvbox"],
        ["rosepine", "Rosé Pine"],
        ["nord", "Nord"],
        ["everforest", "Everforest"],
        ["github", "GitHub"],
      ].map(([id, name]) => ({ id: id!, name: name! })),
      keyboard: keyboard(KEYS),
      tools: TOOLS.map((t) => ({ name: t.name, summary: t.description.split(/(?<=\.)\s/)[0]! })),
      figures: { heatmap: heatmap(), words: wordBars(), plates: plates() },
    }),
    scripts: ["/tour.js"],
  },
  { path: "/keys", title: "Every key · Selah", description: "Every key in Selah, in plain words, generated from the app's own help.", body: keysPage(KEYS) },
  {
    path: "/engravings",
    title: "Doré's 100 Bible engravings · Selah",
    description: "Gustave Doré's 100 Bible engravings (1866), each with the passage it shows and the gallery's caption. Public domain.",
    body: engravingsPage(plateList),
    scripts: ["/gallery.js"],
  },
  { path: "/download", title: `Download Selah ${latest.tag}`, description: "Selah for Linux, macOS and Windows: one-line installers, every build with its SHA-256, and how to check it.", body: downloadPage(latest) },
  { path: "/changelog", title: "Changelog · Selah", description: "What changed in every release of Selah.", body: changelogPage(allReleases) },
  {
    path: "/docs",
    title: "Getting started · Selah",
    description: "Install Selah, open a passage, use the study desk, Matthew Henry, the Hebrew and Greek, Ask, search, plans and settings. With pictures.",
    body: markdownPage(Bun.markdown.html(readFileSync(join(import.meta.dir, "content/docs.md"), "utf8").replace("{{help}}", help)), "docs"),
  },
  {
    path: "/privacy",
    title: "Privacy · Selah",
    description: "What Selah stores, where, and every request it makes. No accounts, no telemetry.",
    body: markdownPage(Bun.markdown.html(readFileSync(join(import.meta.dir, "content/privacy.md"), "utf8")), "privacy"),
  },
  { path: "/404", title: "Not found · Selah", description: "There is no page here.", body: notFoundPage() },
]

// Open Graph cards: the wordmark, the page's title, and the opencode theme's own reading frame
const ogDir = join(out, "og")
mkdirSync(ogDir, { recursive: true })
const OG_WORDMARK = wordmark(5, 5)
const ogFrame = join(import.meta.dir, "media", "theme-opencode.webp")
const ogFramePng = join(cache, "og-frame.png")
await Bun.$`vips thumbnail ${ogFrame} ${ogFramePng} 760`.quiet()
const ogFrameData = `data:image/png;base64,${Buffer.from(readFileSync(ogFramePng)).toString("base64")}`
for (const p of pages) {
  const name = p.path === "/" ? "home" : p.path.slice(1)
  p.og = `/og/${name}.png`
  const heading = p.path === "/" ? "A Bible for the terminal" : p.title.replace(/ · Selah$/, "")
  const lines = heading.length > 22 ? heading.replace(/^(.{1,22})\s(.*)$/, "$1\n$2").split("\n") : [heading]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0a0a0a"/>
  <rect x="0.5" y="0.5" width="1199" height="629" fill="none" stroke="#2a2626"/>
  <g transform="translate(64 70) scale(0.9)">${OG_WORDMARK.replace(/^<svg[^>]*>|<\/svg>$/g, "")}</g>
  ${lines.map((l, i) => `<text x="64" y="${300 + i * 60}" font-family="IBM Plex Mono, JetBrains Mono, monospace" font-size="48" font-weight="600" fill="#f2eded">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`).join("")}
  <text x="64" y="${330 + lines.length * 60}" font-family="IBM Plex Mono, JetBrains Mono, monospace" font-size="24" fill="#7d7a7a">selah.hallelx2.com</text>
  <image href="${ogFrameData}" x="600" y="210" width="760" height="449" preserveAspectRatio="xMinYMin slice"/>
</svg>`
  const svgFile = join(cache, `og-${name}.svg`)
  writeFileSync(svgFile, svg)
  await Bun.$`rsvg-convert -w 1200 -h 630 ${svgFile} -o ${join(ogDir, `${name}.png`)}`.quiet()
}
for (const p of pages) write(p.path === "/" ? "index.html" : `${p.path.slice(1)}.html`, layout(p, LOGO_HTML))

// --- static files -----------------------------------------------------------------------------
for (const f of ["styles.css", "site.js", "tour.js", "gallery.js"]) copyFileSync(join(import.meta.dir, f), join(out, f))
cpSync(join(import.meta.dir, "media"), join(out, "media"), { recursive: true })
copyFileSync(join(root, "install.sh"), join(out, "install"))
copyFileSync(join(root, "install.sh"), join(out, "install.sh"))
copyFileSync(join(root, "install.ps1"), join(out, "install.ps1"))
for (const f of ["selah-demo.mp4", "selah-demo.webm", "selah-demo-poster.png"]) {
  const src = join(root, "docs", "demo", f)
  if (existsSync(src)) copyFileSync(src, join(out, f))
  else console.warn(`missing ${src}; run bun scripts/demo.tsx`)
}
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`)
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .filter((p) => p.path !== "/404")
    .map((p) => `  <url><loc>${ORIGIN}${p.path}</loc></url>`)
    .join("\n")}\n</urlset>\n`,
)
// headers: installers as text, long caching for media, and the usual hardening
write(
  "_headers",
  `/install
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, max-age=300
/install.sh
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, max-age=300
/install.ps1
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, max-age=300
/media/*
  Cache-Control: public, max-age=604800
/engravings/*
  Cache-Control: public, max-age=2592000
/scenes/*
  Cache-Control: public, max-age=31536000, immutable
/*.mp4
  Cache-Control: public, max-age=604800
/*.webm
  Cache-Control: public, max-age=604800
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`,
)
console.log(`built ${out}: ${pages.length} pages`)
process.exit(0)
