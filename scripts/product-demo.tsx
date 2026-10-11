// The product demo: every screen of Selah and what you can do on it, recorded from the real app
// and stitched into one 1080p film with title cards, a caption for each chapter, the keys as they
// are pressed, camera moves and fades through black.
//
//   bun scripts/product-demo.tsx              (rsvg-convert, ffmpeg; the Ask chapter needs Claude Code)
//   CHAPTERS=reading,ask bun scripts/product-demo.tsx   re-record only those, then stitch with the rest
//   FRESH=1 bun scripts/product-demo.tsx      start from nothing
//   MARKS_ONLY=1 bun scripts/product-demo.tsx only rewrite the chapter marks from the parts
//
// Nothing in a chapter is mocked: each drives the app through the test harness key by key, and
// every frame is what the renderer drew, paced to the real clock so the app's own timers keep
// their timing. The command-line chapter shows the CLI's real output. Ask is Claude Code answering
// live, captured every 120ms and played at 25 fps (3x), and its caption says so.
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { claudeProvider } from "../src/agent/claude"
import { addDays } from "../src/data/dates"
import { UserStore } from "../src/data/user"
import { harness, type Harness } from "../test/harness"
import { fixtureBible, fixtureCommentary, fixtureConcordance } from "../test/fixture"
import { seededStore } from "../test/seed"
import { wordmark } from "../site/wordmark"
import { CH, CW, ORIGIN, hex, svg } from "./frame-svg"

const FPS = 25
const W = 1920
const H = 1080
const COLS = 120
const ROWS = 34
// the terminal window: 1440 wide holds 120 columns at 1.25x; the caption sits below it
const WIN = { x: 240, y: 36, w: 1440, bar: 34 }
const CONTENT = { x: WIN.x, y: WIN.y + WIN.bar, w: WIN.w, h: Math.round((WIN.w * ROWS * CH) / (COLS * CW)) }
const CAPTION_Y = CONTENT.y + CONTENT.h + 58
const FADE = 0.4 // seconds through black at each chapter's ends
const FONT = "JetBrainsMono Nerd Font, JetBrains Mono, monospace"
const PRIMARY = "#fab283"
const ACCENT = "#9d7cd8"

const work = join(process.env.TMPDIR ?? "/tmp", "selah-product-demo")
const only = process.env.CHAPTERS?.split(",")
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const at = new Date(2026, 9, 11, 7, 30)

// finished chapters are kept, so CHAPTERS=… re-records only those and the film is stitched again
if (process.env.FRESH) rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
mkdirSync("docs/demo", { recursive: true })

// --- the camera, in cells of the terminal ------------------------------------------------------
type Rect = { x: number; y: number; w: number; h: number }
const FULL: Rect = { x: 0, y: 0, w: COLS, h: ROWS }
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const lerp = (a: Rect, b: Rect, t: number): Rect => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t })
function fit(r: Rect): Rect {
  const aspect = CONTENT.w / CONTENT.h
  let w = r.w * CW
  let h = r.h * CH
  if (w / h < aspect) w = h * aspect
  else h = w / aspect
  const cw = Math.min(COLS, w / CW)
  const ch = Math.min(ROWS, h / CH)
  return { x: Math.min(Math.max(0, r.x + r.w / 2 - cw / 2), COLS - cw), y: Math.min(Math.max(0, r.y + r.h / 2 - ch / 2), ROWS - ch), w: cw, h: ch }
}
const viewBox = (r: Rect) => `${(ORIGIN.x + r.x * CW).toFixed(2)} ${(ORIGIN.y + r.y * CH).toFixed(2)} ${(r.w * CW).toFixed(2)} ${(r.h * CH).toFixed(2)}`

// --- the frame around the app: window, caption, keys, fades ----------------------------------
// The app is captured every APP_STEP ms of its own time (a frame costs ~70ms to settle and read),
// while the film runs at FPS: the camera, the keycaps and the fades are composed for each film
// frame at its own moment, so they move smoothly however often the app was captured.
const APP_STEP = 80
interface Caption {
  kicker: string
  title: string
  line: string
}
interface Shot {
  /** The app's frame as SVG, or the whole picture for a card. */
  file: string
  /** When it was taken, in film time (ms from the chapter's start). */
  vt: number
  card?: boolean
  ground: string
  caption: Caption
}

function windowChrome(title: string, ground: string) {
  return `<rect x="${WIN.x - 1}" y="${WIN.y - 1}" width="${WIN.w + 2}" height="${WIN.bar + CONTENT.h + 2}" rx="12" fill="#2a2626"/>
<rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="${WIN.bar + CONTENT.h}" rx="11" fill="${ground}"/>
<path d="M${WIN.x} ${WIN.y + 11} a11 11 0 0 1 11 -11 h${WIN.w - 22} a11 11 0 0 1 11 11 v${WIN.bar - 11} h-${WIN.w} z" fill="#161414"/>
<circle cx="${WIN.x + 20}" cy="${WIN.y + 17}" r="6" fill="#4a4545"/><circle cx="${WIN.x + 40}" cy="${WIN.y + 17}" r="6" fill="#4a4545"/><circle cx="${WIN.x + 60}" cy="${WIN.y + 17}" r="6" fill="#4a4545"/>
<text x="${W / 2}" y="${WIN.y + 22}" font-family="${FONT}" font-size="14" fill="#7d7a7a" text-anchor="middle">${esc(title)}</text>`
}

function caption({ kicker, title, line }: Caption) {
  return `<text x="${WIN.x}" y="${CAPTION_Y}" font-family="${FONT}" font-size="17" fill="${PRIMARY}" letter-spacing="1">${esc(kicker)}</text>
<text x="${WIN.x}" y="${CAPTION_Y + 42}" font-family="${FONT}" font-size="34" font-weight="bold" fill="#f2eded">${esc(title)}</text>
<text x="${WIN.x}" y="${CAPTION_Y + 80}" font-family="${FONT}" font-size="21" fill="#9a9595">${esc(line)}</text>`
}

/** The keys pressed in the last moment, as keycaps at the right of the caption, newest last. */
function keycaps(keys: { label: string; age: number }[]) {
  const shown = keys.filter((k) => k.age >= 0 && k.age < 1.3).slice(-5)
  let x = WIN.x + WIN.w
  const out: string[] = []
  for (const k of [...shown].reverse()) {
    const w = Math.max(54, k.label.length * 15 + 28)
    x -= w
    const o = k.age < 0.9 ? 1 : Math.max(0, 1 - (k.age - 0.9) / 0.4)
    const pop = k.age < 0.08 ? 3 : 0
    out.push(`<g opacity="${o.toFixed(2)}"><rect x="${x}" y="${CAPTION_Y + 8 - pop}" width="${w}" height="52" rx="9" fill="#1f1c1c" stroke="${k.age < 0.25 ? PRIMARY : "#3a3535"}" stroke-width="2"/>
<rect x="${x}" y="${CAPTION_Y + 54 - pop}" width="${w}" height="6" rx="3" fill="#000" opacity="0.35"/>
<text x="${x + w / 2}" y="${CAPTION_Y + 42 - pop}" font-family="${FONT}" font-size="24" font-weight="bold" fill="#f2eded" text-anchor="middle">${esc(k.label)}</text></g>`)
    x -= 12
  }
  return out.join("\n")
}

const BACKDROP = `<defs><radialGradient id="glow" cx="50%" cy="0%" r="90%"><stop offset="0" stop-color="#1c1616"/><stop offset="1" stop-color="#070606"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#glow)"/>`

// --- a chapter of the film ---------------------------------------------------------------------
type Move = { from: Rect; to: Rect; t0: number; dur: number }

class Chapter {
  shots: Shot[] = []
  vt = 0
  deadline = Date.now()
  behind = 0
  moves: Move[] = [{ from: FULL, to: FULL, t0: 0, dur: 0 }]
  keys: { label: string; at: number }[] = []
  text: [string, string] = ["", ""]
  kicker = ""
  index = 0
  dir: string
  constructor(
    public name: string,
    public title: string,
    public h?: Harness,
  ) {
    this.dir = join(work, name)
    mkdirSync(this.dir, { recursive: true })
  }
  /** Sets the caption: a short title and one line saying what you are seeing. */
  say(title: string, line: string) {
    this.text = [title, line]
  }
  /** Where the camera is at film time t. */
  camera(t: number): Rect {
    const m = [...this.moves].reverse().find((x) => x.t0 <= t)!
    return m.dur <= 0 ? m.to : lerp(m.from, m.to, ease(Math.min(1, Math.max(0, (t - m.t0) / m.dur))))
  }
  zoom(r: Rect | "full", ms = 1100) {
    this.moves.push({ from: this.camera(this.vt), to: r === "full" ? FULL : fit(r), t0: this.vt, dur: ms })
  }
  /**
   * Moves the app's clock `step` ms, waits until real time has moved as far, and takes the frame.
   * `film` is how much film time the frame stands for: the same, except in Ask, which is sped up.
   */
  async frame(step = APP_STEP, film = step) {
    const h = this.h!
    h.advance(step)
    this.deadline += step
    // when behind, no wait at all, so a run of slow frames is caught up
    const ahead = this.deadline - Date.now()
    if (ahead > 0) await wait(ahead)
    await h.settle()
    this.behind = Math.max(this.behind, Date.now() - this.deadline)
    const spans = h.spans()
    const bg = spans.lines[0]?.spans[0]?.bg
    const ground = bg && bg.a > 0 ? hex(bg) : "#0a0a0a"
    const file = join(this.dir, `${String(this.shots.length).padStart(5, "0")}.svg`)
    await Bun.write(file, svg(spans, ground, h.frame()))
    this.shots.push({ file, vt: this.vt, ground, caption: { kicker: this.kicker, title: this.text[0], line: this.text[1] } })
    this.vt += film
  }
  async hold(seconds: number) {
    for (let i = 0; i < Math.round((seconds * 1000) / APP_STEP); i++) await this.frame()
  }
  shown(label: string) {
    this.keys.push({ label, at: this.vt })
  }
  async key(name: string, mods?: { ctrl?: boolean; shift?: boolean }, after = 0.7) {
    const label = (mods?.ctrl ? "ctrl+" : "") + ({ return: "enter", escape: "esc", up: "↑", down: "↓", left: "←", right: "→", tab: "tab", space: "space" }[name] ?? name)
    this.shown(label)
    await this.h!.press(name, mods)
    await this.hold(after)
  }
  async type(text: string, perKey = 95) {
    for (const ch of text) {
      this.shown(ch === " " ? "space" : ch)
      await this.h!.type(ch)
      for (let i = 0; i < Math.max(1, Math.round(perKey / APP_STEP)); i++) await this.frame()
    }
  }
  /** A whole picture (a card, the shell) as the next shot, lasting `ms` of film. */
  async picture(svgText: string, ms = 1000 / FPS) {
    const file = join(this.dir, `${String(this.shots.length).padStart(5, "0")}.svg`)
    await Bun.write(file, svgText)
    this.shots.push({ file, vt: this.vt, card: true, ground: "#000", caption: { kicker: "", title: "", line: "" } })
    this.vt += ms
  }
}

async function compose(c: Chapter, shot: Shot, t: number, fade: number): Promise<string> {
  const body = await Bun.file(shot.file).text()
  const black = fade > 0 ? `<rect width="${W}" height="${H}" fill="#000" opacity="${fade.toFixed(3)}"/>` : ""
  if (shot.card) return body.replace(/<\/svg>\s*$/, `${black}</svg>`)
  const inner = body.replace(
    /^<svg [^>]*>/,
    `<svg x="${CONTENT.x}" y="${CONTENT.y}" width="${CONTENT.w}" height="${CONTENT.h}" viewBox="${viewBox(c.camera(t))}" preserveAspectRatio="xMidYMid slice">`,
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${BACKDROP}
${windowChrome(c.title, shot.ground)}
<clipPath id="content"><rect x="${CONTENT.x}" y="${CONTENT.y}" width="${CONTENT.w}" height="${CONTENT.h}"/></clipPath>
<g clip-path="url(#content)">${inner}</g>
${caption(shot.caption)}
${keycaps(c.keys.map((k) => ({ label: k.label, age: (t - k.at) / 1000 })))}
${black}
</svg>`
}

/** Composes the chapter at FPS, fades its ends through black, and encodes it to a high-quality part. */
async function finish(c: Chapter) {
  c.h?.destroy()
  const step = 1000 / FPS
  const n = Math.max(1, Math.round(c.vt / step))
  const fadeFrames = Math.round(FADE * FPS)
  const pngs = join(c.dir, "png")
  mkdirSync(pngs, { recursive: true })
  // the shot on screen at film time t: the last one taken at or before it
  const shotAt = (t: number) => {
    let lo = 0
    for (let i = 0; i < c.shots.length && c.shots[i]!.vt <= t + 0.001; i++) lo = i
    return c.shots[lo]!
  }
  for (let i = 0; i < n; i += 16)
    await Promise.all(
      Array.from({ length: Math.min(16, n - i) }, async (_, k) => {
        const index = i + k
        const t = index * step
        const fade = index < fadeFrames ? 1 - index / fadeFrames : index >= n - fadeFrames ? (index - (n - fadeFrames) + 1) / fadeFrames : 0
        const file = join(c.dir, `c${String(index).padStart(5, "0")}.svg`)
        writeFileSync(file, await compose(c, shotAt(t), t, fade))
        await Bun.$`rsvg-convert -w ${W} -h ${H} ${file} -o ${join(pngs, `${String(index).padStart(5, "0")}.png`)}`.quiet()
        rmSync(file)
      }),
    )
  // named by the chapter's place in the film, so a re-recording replaces it
  const mp4 = join(work, `${String(c.index).padStart(2, "0")}-${c.name}.mp4`)
  await Bun.$`ffmpeg -y -loglevel error -framerate ${FPS} -i ${pngs}/%05d.png -c:v libx264 -preset medium -crf 14 -pix_fmt yuv420p ${mp4}`
  rmSync(c.dir, { recursive: true, force: true })
  console.log(`${c.name}: ${(n / FPS).toFixed(1)}s${c.h ? `, worst lag ${Math.round(c.behind)}ms` : ""}`)
}

// --- the chapters ------------------------------------------------------------------------------
const bible = await fixtureBible()
const LOOK = { icons: "nerd", motion: "full", theme: "opencode", welcomed: true } as const
// MARKS_ONLY=1 rewrites the chapter marks from the parts on disk, recording and encoding nothing
const marksOnly = !!process.env.MARKS_ONLY
const want = (name: string) => !marksOnly && (!only || only.includes(name))
let index = 0
/** Every chapter of this film, in order, as its part's file name: the stitch uses exactly these. */
const expected: string[] = []
const part = (name: string) => (expected.push(`${String(index).padStart(2, "0")}-${name}.mp4`), name)
async function chapter(name: string, title: string, setup: Parameters<typeof harness>[0] | null, run: (c: Chapter) => Promise<void>) {
  index++
  part(name)
  if (!want(name)) return
  const h = setup ? await harness({ width: COLS, height: ROWS, store: seededStore("2026-10-11"), start: at, bible, ...setup, config: { ...LOOK, ...setup.config } }) : undefined
  const c = new Chapter(name, title, h)
  c.index = index
  c.kicker = `${String(index).padStart(2, "0")}  ·  ${title.replace(/^selah( · )?/, "").toUpperCase() || "HOME"}`
  await run(c)
  await finish(c)
}

// a full-frame card: the wordmark, a headline, and lines under it, each surfacing in turn
async function card(name: string, lines: { text: string; size: number; color: string; at: number; mono?: boolean }[], seconds: number, markAt = 0) {
  index++
  part(name)
  if (!want(name)) return
  const c = new Chapter(name, "")
  c.index = index
  const drawn = wordmark(12, 12)
  const mark = drawn.replace(/^<svg[^>]*>|<\/svg>$/g, "")
  const markW = Number(/width="(\d+)"/.exec(drawn)![1])
  const markH = Number(/height="(\d+)"/.exec(drawn)![1])
  // the logo and the lines as one group, centred on the frame
  const gap = 70
  const total = markH + gap + lines.reduce((n, l) => n + l.size * 1.7, 0)
  const top = (H - total) / 2
  const frames = Math.round(seconds * FPS)
  for (let i = 0; i < frames; i++) {
    const t = i / FPS
    const appear = (start: number) => Math.min(1, Math.max(0, (t - start) / 0.6))
    const rise = (start: number) => (1 - ease(appear(start))) * 18
    let y = top + markH + gap - 0.5 * (lines[0]?.size ?? 0)
    const parts = [BACKDROP]
    parts.push(`<g transform="translate(${(W - markW) / 2} ${top + rise(markAt)})" opacity="${appear(markAt).toFixed(3)}">${mark}</g>`)
    for (const l of lines) {
      y += l.size * 1.7
      parts.push(
        `<text x="${W / 2}" y="${y + rise(l.at)}" font-family="${FONT}" font-size="${l.size}" ${l.size > 40 ? 'font-weight="bold"' : ""} fill="${l.color}" text-anchor="middle" opacity="${appear(l.at).toFixed(3)}" xml:space="preserve">${esc(l.text)}</text>`,
      )
    }
    await c.picture(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`)
  }
  await finish(c)
}

// 01 Welcome
await card(
  "welcome",
  [
    { text: "Welcome to Selah", size: 64, color: "#f2eded", at: 0.9 },
    { text: "your terminal app for studying the Scriptures", size: 30, color: "#b4aeae", at: 1.7 },
    { text: "read · study · the Hebrew and Greek · Henry · Doré · Ask · an honest streak", size: 21, color: ACCENT, at: 2.6 },
  ],
  6.5,
)

// 02 Install
await card(
  "install",
  [
    { text: "Install it in one line", size: 46, color: "#f2eded", at: 0.2 },
    { text: "Linux and macOS", size: 20, color: "#7d7a7a", at: 0.9 },
    { text: "curl -fsSL https://selah.hallelx2.com/install | sh", size: 28, color: PRIMARY, at: 1.1 },
    { text: "Windows, in PowerShell", size: 20, color: "#7d7a7a", at: 1.9 },
    { text: "irm https://selah.hallelx2.com/install.ps1 | iex", size: 28, color: PRIMARY, at: 2.1 },
    { text: "Then type  selah  and press enter.", size: 22, color: "#b4aeae", at: 3.0 },
  ],
  6,
  0,
)

await chapter("home", "selah", {}, async (c) => {
  c.say("Home", "The verse of the day, your progress today, and where you left off")
  await c.hold(3.2)
  c.zoom({ x: 20, y: 7, w: 80, h: 14 })
  await c.hold(2.6)
  c.zoom("full")
  await c.hold(1.4)
})

await chapter("open", "selah · opening a passage", { config: { welcomed: false } }, async (c) => {
  c.say("Open any passage by typing it", "Books, chapters and verses, in the forms people write them: john 3, jn 3:16, ps 23")
  await c.hold(0.8)
  await c.type("john 3", 130)
  await c.hold(0.6)
  await c.key("return", undefined, 1)
  c.say("The first time, it shows you the keys that matter", "Letters are shortcuts here. Press any key and start reading.")
  c.zoom({ x: 26, y: 8, w: 70, h: 18 })
  await c.hold(3.6)
  c.zoom("full")
  await c.key("j", undefined, 1.2)
})

const TEXT: Rect = { x: 26, y: 1, w: 72, h: 24 }
await chapter("reading", "selah · John 3", { initial: { route: "reader", book: 43, chapter: 3, verse: 1 } }, async (c) => {
  c.say("Read like a book", "j and k move verse by verse; the header counts the time until the chapter is read")
  await c.hold(0.8)
  c.zoom(TEXT)
  for (let i = 0; i < 4; i++) await c.key("j", undefined, 0.45)
  c.say("Highlight, in four colours", "h highlights the verse; press it again for another colour")
  await c.key("h", undefined, 0.8)
  await c.key("j", undefined, 0.4)
  await c.key("h", undefined, 0.35)
  await c.key("h", undefined, 1)
  c.say("Bookmark it", "b bookmarks the verse; B lists your bookmarks")
  await c.key("b", undefined, 1.4)
  c.zoom("full")
  c.say("Prose, or one verse per line", "w lets the chapter flow as paragraphs, with the verse numbers raised")
  await c.key("w", undefined, 2.2)
  await c.key("w", undefined, 0.8)
  c.say("Focus", "z fades everything but the verse you are on")
  await c.key("z", undefined, 2.2)
  await c.key("z", undefined, 0.8)
})

await chapter("goto", "selah · go to", { initial: { route: "reader", book: 43, chapter: 3, verse: 1 } }, async (c) => {
  c.say("Go anywhere", "o, then a book and chapter. Abbreviations work.")
  await c.hold(0.5)
  await c.key("o", undefined, 0.6)
  await c.type("romans 8", 120)
  await c.hold(0.8)
  await c.key("return", undefined, 2.2)
})

await chapter("search", "selah · search", { initial: { route: "reader", book: 43, chapter: 4, verse: 1 } }, async (c) => {
  c.say("Search every verse", "/ searches the whole Bible, ranked, with your words highlighted")
  await c.hold(0.5)
  await c.key("/", undefined, 0.5)
  c.zoom({ x: 18, y: 2, w: 84, h: 26 })
  await c.type("living water", 110)
  await c.hold(1.8)
  c.say("Phrases, books and Strong's numbers", '"in quotes", in:psalms, in:nt, or G26 for every use of a Greek word')
  await c.key("down", undefined, 0.5)
  await c.key("down", undefined, 0.8)
  c.zoom("full")
  await c.key("return", undefined, 1.8)
})

await chapter("palette", "selah · commands", { config: { mode: "dark" }, initial: { route: "reader", book: 19, chapter: 23, verse: 1 } }, async (c) => {
  c.say("Commands, in plain words", "ctrl+p, then say what you want: dark, pictures, bigger text, commentary, quit")
  await c.hold(0.6)
  await c.key("p", { ctrl: true }, 0.6)
  c.zoom({ x: 28, y: 2, w: 66, h: 22 })
  await c.type("light", 140)
  await c.hold(1)
  await c.key("return", undefined, 1.4)
  c.zoom("full")
  c.say("Light, when you want it", "Dark, light, or whatever your terminal is")
  await c.hold(2)
})

await chapter("parallel", "selah · Psalm 23", { config: { theme: "catppuccin" }, initial: { route: "reader", book: 19, chapter: 23, verse: 1 } }, async (c) => {
  c.say("Two translations, side by side", "T opens a second translation beside the first, verse by verse")
  await c.hold(0.6)
  await c.key("T", { shift: true }, 1.2)
  c.zoom({ x: 4, y: 1, w: 112, h: 20 })
  for (let i = 0; i < 3; i++) await c.key("j", undefined, 0.6)
  c.say("Five public-domain translations", "The King James and the Berean Standard come with it; ASV, YLT and NHEB are one command away")
  await c.hold(2)
  c.zoom("full")
  await c.key("T", { shift: true }, 1)
})

const PANE: Rect = { x: 75, y: 1, w: 45, h: 16 }
await chapter("notes", "selah · study desk", { initial: { route: "reader", book: 43, chapter: 3, verse: 16 } }, async (c) => {
  c.say("The study desk", "tab opens it beside the text; it follows the verse you are on")
  await c.hold(0.6)
  await c.key("tab", undefined, 1)
  c.say("Notes as you read", "Just type. Your note on the verse, and a journal for the chapter, save as you go")
  c.zoom(PANE)
  await c.hold(0.8)
  await c.type("For God so loved: the whole gospel in one sentence.", 55)
  await c.hold(1)
  await c.key("escape", undefined, 0.8)
  c.zoom("full")
  await c.hold(1)
})

await chapter("henry", "selah · commentary", { initial: { route: "reader", book: 19, chapter: 23, verse: 1 } }, async (c) => {
  c.say("Matthew Henry, at your verse", "2 opens his Complete Commentary where you are reading, and follows you")
  await c.key("tab", undefined, 0.3)
  await c.key("2", undefined, 0.6)
  c.zoom(PANE)
  await c.hold(1.4)
  for (let i = 0; i < 3; i++) await c.key("j", undefined, 0.9)
  c.zoom("full")
  await c.hold(0.8)
})

await chapter("words", "selah · Hebrew and Greek", { concordance: true, initial: { route: "reader", book: 43, chapter: 3, verse: 16 } }, async (c) => {
  c.say("The Greek behind every verse", "3 lists each original word: transliteration, meaning, Strong's number, and its grammar in plain words")
  await c.key("tab", undefined, 0.3)
  await c.key("3", undefined, 0.6)
  c.zoom(PANE)
  await c.hold(1)
  await c.key("j", undefined, 0.5)
  await c.key("j", undefined, 1)
  c.say("A word study", "enter: the dictionary entry, where the word occurs, and every verse that uses it")
  await c.key("return", undefined, 2.2)
  c.zoom({ ...PANE, y: 17 }, 1400)
  await c.key("j", undefined, 0.6)
  await c.key("j", undefined, 1.6)
  c.zoom("full")
  await c.key("escape", undefined, 1)
})

if (want("ask")) {
  const claudePath = Bun.which("claude")
  if (!claudePath) throw new Error("the Ask chapter needs Claude Code on PATH")
  await chapter(
    "ask",
    "selah · Ask",
    {
      agents: [claudeProvider({ bible, commentary: await fixtureCommentary(), concordance: await fixtureConcordance(), store: seededStore("2026-10-11"), translation: () => "KJV" }, claudePath)],
      initial: { route: "reader", book: 43, chapter: 4, verse: 14 },
    },
    async (c) => {
      c.say("Ask your own Claude Code or Codex", "Answers grounded in the text, every reference openable. Selah holds no keys.")
      await c.key("tab", undefined, 0.3)
      await c.key("4", undefined, 0.6)
      c.zoom(PANE)
      await c.hold(0.6)
      await c.type("What does Jesus mean by a well of water springing up?", 40)
      c.shown("enter")
      await c.h!.press("return")
      c.say("Ask, answering live", "Claude Code, really answering through Selah's tools. Shown at three times speed.")
      const started = Date.now()
      const live = () => /thinking \d+s · esc stop/.test(c.h!.frame())
      while (Date.now() - started < 120_000) {
        // 120ms of the agent's real time is 40ms of film: three times speed
        await c.frame(120, 40)
        if (Date.now() - started > 3_000 && !live()) break
      }
      console.log(`ask: answered live in ${((Date.now() - started) / 1000).toFixed(1)}s`)
      c.zoom({ x: 75, y: 1, w: 45, h: 30 }, 1200)
      await c.hold(3.5)
    },
  )
} else (index++, part("ask"))

await chapter("dore", "selah · Doré", { config: { theme: "gruvbox" }, initial: { route: "reader", book: 43, chapter: 4, verse: 7 } }, async (c) => {
  c.say("Doré's engravings, at the passage they show", "All 100 of Doré's engravings. Drawn here in half-blocks; kitty, Ghostty and sixel terminals show the full engraving")
  await c.hold(0.8)
  await c.key("i", undefined, 5.5)
  c.say("Walk the gallery", "← and → go plate to plate; g lists all 100; enter opens the passage")
  await c.key("right", undefined, 3.4)
  await c.key("g", undefined, 2.2)
  await c.key("escape", undefined, 0.4)
  await c.key("escape", undefined, 0.8)
})

await chapter("books", "selah · books", { initial: { route: "reader", book: 43, chapter: 3, verse: 16 } }, async (c) => {
  c.say("Every book, and how far you are", "ctrl+b opens the books, with a bar for how much of each you have read")
  await c.hold(0.5)
  await c.key("b", { ctrl: true }, 1)
  c.zoom({ x: 0, y: 1, w: 46, h: 30 })
  for (let i = 0; i < 4; i++) await c.key("k", undefined, 0.45)
  await c.hold(0.8)
  c.zoom("full")
  await c.key("b", { ctrl: true }, 0.6)
  c.say("Your bookmarks", "B lists them; type to filter, enter to open")
  await c.key("b", undefined, 0.6)
  await c.key("B", { shift: true }, 2)
  await c.key("escape", undefined, 0.6)
})

{
  // six days read before today, so reading Psalm 23 today makes a seven-day streak
  const store = UserStore.memory()
  for (let i = 1; i <= 6; i++) store.recordRead({ book: 40, chapter: i, day: addDays("2026-10-11", -i), readAt: 0, source: "manual" })
  await chapter("streak", "selah · Psalm 23", { store, config: { theme: "catppuccin" }, initial: { route: "reader", book: 19, chapter: 23 } }, async (c) => {
    c.say("It only counts what you actually read", "Reach the end and spend real time on it. Time away from the keys is not counted.")
    await c.hold(1)
    c.zoom({ x: 60, y: 0, w: 60, h: 6 })
    // read it properly: a verse at a time, with the time it takes
    for (let i = 0; i < 6; i++) {
      c.shown("j")
      await c.h!.press("j")
      await c.hold(0.7)
      c.h!.advance(1_400)
    }
    c.zoom("full")
    c.say("The chapter counts, and the streak grows", "One read a day per chapter, credited to the day you began")
    await c.hold(4)
  })
}

await chapter("progress", "selah · progress", { initial: { route: "reader", book: 43, chapter: 3, verse: 1 } }, async (c) => {
  c.say("Progress you can trust", "s: your streak, today, consistency over 7, 30 and 365 days, and a year of reading")
  await c.hold(0.5)
  await c.key("s", undefined, 2.2)
  c.zoom({ x: 0, y: 4, w: 100, h: 20 })
  await c.hold(3)
  c.zoom("full")
  await c.hold(1.4)
})

await chapter("plans", "selah · plans", { initial: { route: "reader", book: 43, chapter: 3, verse: 1 } }, async (c) => {
  c.say("Reading plans", "A year, two years, the New Testament in 90 days, the Gospels, Psalms and Proverbs")
  await c.key("p", { ctrl: true }, 0.4)
  await c.type("plan", 120)
  await c.key("return", undefined, 1.2)
  c.zoom({ x: 18, y: 3, w: 84, h: 20 })
  await c.hold(0.8)
  c.say("Choose one by typing", "The list filters as you type; enter starts the plan")
  await c.type("gospels", 120)
  await c.hold(0.8)
  await c.key("return", undefined, 2)
  c.zoom("full")
  c.say("Today's reading, always one key away", "ctrl+o opens it; Selah says how far ahead or behind you are")
  await c.key("o", { ctrl: true }, 2.6)
})

await chapter("themes", "selah · themes", { initial: { route: "reader", book: 43, chapter: 1, verse: 1 } }, async (c) => {
  c.say("Make it yours", "33 themes with live preview, light and dark, or your terminal's own colours")
  await c.key("p", { ctrl: true }, 0.4)
  await c.type("theme", 110)
  await c.key("return", undefined, 1)
  for (let i = 0; i < 7; i++) await c.key("down", undefined, 0.75)
  await c.key("return", undefined, 2)
})

await chapter("help", "selah · help", { initial: { route: "reader", book: 43, chapter: 3, verse: 1 } }, async (c) => {
  c.say("Help is one key away", "? shows every key, in plain words")
  await c.hold(0.4)
  await c.key("?", undefined, 2.4)
  await c.key("j", undefined, 0.4)
  await c.key("j", undefined, 1.4)
  await c.key("escape", undefined, 0.8)
})

// the command line: real commands, their real output, typed into a shell
async function shellChapter() {
  index++
  part("cli")
  if (!want("cli")) return
  const home = join(work, "cli-home")
  // a home with the King James in it, so the output is what anyone would see
  await Bun.$`bun src/index.tsx install kjv`.env({ ...process.env, SELAH_HOME: home }).quiet()
  const run = async (args: string[]) => (await Bun.$`bun src/index.tsx ${args}`.env({ ...process.env, SELAH_HOME: home, NO_COLOR: "1" }).text()).trimEnd()
  const session: { cmd: string; out: string; note: [string, string] }[] = [
    { cmd: "selah john 3:16 -p", out: await run(["john", "3:16", "-p"]), note: ["From the command line too", "Print any passage and carry on with your day"] },
    {
      cmd: 'selah search "living water"',
      out: (await run(["search", "living water"])).split("\n").slice(0, 9).join("\n"),
      note: ["Search from the shell", "The same ranked search, for scripts and pipes"],
    },
    { cmd: "claude mcp add selah -- selah mcp", out: "", note: ["Selah's tools in your own agent", "selah mcp serves passages, search, Henry and the original words to Claude Code, Codex or any MCP client"] },
  ]
  const c = new Chapter("cli", "~ — zsh")
  c.index = index
  c.kicker = `${String(index).padStart(2, "0")}  ·  THE COMMAND LINE`
  const lines: { text: string; color: string }[] = []
  const draw = (cursor: boolean) => {
    const size = 22
    const lh = 32
    const shown = lines.slice(-Math.floor((CONTENT.h - 40) / lh))
    const text = shown
      .map((l, i) => `<text x="${CONTENT.x + 28}" y="${CONTENT.y + 44 + i * lh}" font-family="${FONT}" font-size="${size}" fill="${l.color}" xml:space="preserve">${esc(l.text)}${cursor && i === shown.length - 1 ? "▍" : ""}</text>`)
      .join("")
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${BACKDROP}${windowChrome(c.title, "#0a0a0a")}${text}${caption({ kicker: c.kicker, title: c.text[0], line: c.text[1] })}${keycaps(c.keys.map((k) => ({ label: k.label, age: (c.vt - k.at) / 1000 })))}</svg>`
  }
  // the shell draws its own caption and keycaps, at film rate
  const tick = (cursor = true) => c.picture(draw(cursor))
  const hold = async (s: number) => {
    for (let i = 0; i < Math.round(s * FPS); i++) await tick()
  }
  for (const step of session) {
    c.say(...step.note)
    lines.push({ text: "~ ❯ ", color: "#8ec07c" })
    await hold(0.4)
    for (const ch of step.cmd) {
      lines[lines.length - 1]!.text += ch
      await tick()
      await tick()
    }
    c.shown("enter")
    await hold(0.3)
    // a terminal wraps long lines at its width: here, 104 columns
    const COLS_SHELL = 104
    for (const l of step.out.split("\n").filter((x, i, all) => x || i < all.length - 1))
      for (let at = 0; at === 0 || at < l.length; at += COLS_SHELL) lines.push({ text: l.slice(at, at + COLS_SHELL), color: "#d4cfcf" })
    lines.push({ text: "", color: "#d4cfcf" })
    await hold(step.out ? 3 : 2.6)
  }
  await finish(c)
}
await shellChapter()

// the close
await card(
  "outro",
  [
    { text: "Selah.  Pause, and consider.", size: 56, color: "#f2eded", at: 0.8 },
    { text: "curl -fsSL https://selah.hallelx2.com/install | sh", size: 28, color: PRIMARY, at: 1.6 },
    { text: "selah.hallelx2.com  ·  free and open source", size: 24, color: "#b4aeae", at: 2.3 },
  ],
  6,
)

// --- stitch: exactly this film's chapters, in order -----------------------------------------
const missing = expected.filter((p) => !Bun.file(join(work, p)).size)
if (missing.length) {
  console.log(`not recorded yet: ${missing.join(", ")}; record them before the film can be stitched`)
} else {
  const out = "docs/demo/selah-product-demo"
  if (!marksOnly) {
    const list = join(work, "parts.txt")
    writeFileSync(list, expected.map((p) => `file '${join(work, p)}'`).join("\n"))
    await Bun.$`ffmpeg -y -loglevel error -f concat -safe 0 -i ${list} -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p -movflags +faststart ${out}.mp4`
    await Bun.$`ffmpeg -y -loglevel error -i ${out}.mp4 -c:v libvpx-vp9 -b:v 0 -crf 40 -deadline good -cpu-used 4 -row-mt 1 -pix_fmt yuv420p ${out}.webm`
    // the poster: the opening card at full light
    await Bun.$`ffmpeg -y -loglevel error -ss 4.5 -i ${out}.mp4 -frames:v 1 -vf scale=1280:-2 ${out}-poster.png`
  }
  // chapter marks from each part's own length, and the film's, so the site needs no ffprobe
  let t = 0
  const chapters: { name: string; start: number }[] = []
  for (const p of expected) {
    chapters.push({ name: p.replace(/^\d+-|\.mp4$/g, ""), start: Math.round(t * 10) / 10 })
    t += Number((await Bun.$`ffprobe -v error -show_entries format=duration -of csv=p=0 ${join(work, p)}`.text()).trim())
  }
  const duration = Number((await Bun.$`ffprobe -v error -show_entries format=duration -of csv=p=0 ${out}.mp4`.text()).trim())
  writeFileSync(`${out}-chapters.json`, JSON.stringify({ duration: Math.round(duration * 10) / 10, chapters }, null, 1))
  console.log(`\n${expected.length} chapters, ${Math.floor(duration / 60)}m${Math.round(duration % 60)}s`)
  if (!marksOnly) for (const f of [`${out}.mp4`, `${out}.webm`]) console.log(f, `${(statSync(f).size / 1e6).toFixed(1)} MB`)
}
process.exit(0)
