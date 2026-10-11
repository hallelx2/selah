// Records the site's media from the real app, through the test harness, with nothing mocked:
//
//   - one clip per feature, with camera moves made on the vector frame (each frame's SVG gets an
//     eased viewBox and is rendered at the output size, so a zoom into a pane stays sharp);
//   - stills of one screen in several themes, for the theme switcher;
//   - the keyboard tour: every step's screen as characters and colours, for the page to draw as
//     text (site/media/tour.json).
//
//   bun scripts/site-media.tsx                 everything (Ask needs Claude Code on PATH)
//   MEDIA=read,tour bun scripts/site-media.tsx only those
//
// Frames are paced to the real clock, as in scripts/demo.tsx: the app's clock moves a frame and
// real time moves as far before the frame is taken, so the timers that run on the real clock keep
// their timing. The Ask clip is the only one sped up (3x), and the page says so.
import { mkdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import type { CapturedFrame } from "@opentui/core"
import { claudeProvider } from "../src/agent/claude"
import { harness, type Harness } from "../test/harness"
import { fixtureBible, fixtureCommentary, fixtureConcordance } from "../test/fixture"
import { seededStore } from "../test/seed"
import { CH, CW, ORIGIN, hex, svg } from "./frame-svg"

const FPS = 15
const COLS = 150
const ROWS = 42
const OUT_W = 1440
const OUT_H = Math.round((OUT_W * (ROWS * CH)) / (COLS * CW)) // the grid's own aspect: 840
const OUT = "site/media"
const work = join(process.env.TMPDIR ?? "/tmp", "selah-site-media")
const only = process.env.MEDIA?.split(",")
const want = (name: string) => !only || only.includes(name)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const at = new Date(2026, 9, 11, 7, 30)

mkdirSync(OUT, { recursive: true })
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

// --- the camera -------------------------------------------------------------------------------
/** A region of the terminal, in cells. */
type Rect = { x: number; y: number; w: number; h: number }
const FULL: Rect = { x: 0, y: 0, w: COLS, h: ROWS }
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const lerp = (a: Rect, b: Rect, t: number): Rect => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t })
/** The rect grown to the output's aspect around its centre, and kept inside the terminal. */
function fit(r: Rect): Rect {
  const aspect = OUT_W / OUT_H
  let w = r.w * CW
  let h = r.h * CH
  if (w / h < aspect) w = h * aspect
  else h = w / aspect
  const cw = Math.min(COLS, w / CW)
  const ch = Math.min(ROWS, h / CH)
  const x = Math.min(Math.max(0, r.x + r.w / 2 - cw / 2), COLS - cw)
  const y = Math.min(Math.max(0, r.y + r.h / 2 - ch / 2), ROWS - ch)
  return { x, y, w: cw, h: ch }
}
const viewBox = (r: Rect) => `${(ORIGIN.x + r.x * CW).toFixed(2)} ${(ORIGIN.y + r.y * CH).toFixed(2)} ${(r.w * CW).toFixed(2)} ${(r.h * CH).toFixed(2)}`

// --- a clip -----------------------------------------------------------------------------------
class Clip {
  n = 0
  vt = 0
  deadline = Date.now()
  behind = 0
  cam = { from: FULL, to: FULL, t0: 0, dur: 0 }
  dir: string
  constructor(
    public name: string,
    public h: Harness,
  ) {
    this.dir = join(work, name)
    mkdirSync(this.dir, { recursive: true })
  }
  view(): Rect {
    const { from, to, t0, dur } = this.cam
    return dur <= 0 ? to : lerp(from, to, ease(Math.min(1, Math.max(0, (this.vt - t0) / dur))))
  }
  /** Moves the camera to a region (in cells) over `ms`, while frames go on being taken. */
  zoom(r: Rect | "full", ms = 1100) {
    this.cam = { from: this.view(), to: r === "full" ? FULL : fit(r), t0: this.vt, dur: ms }
  }
  async frame(step = 1000 / FPS) {
    this.h.advance(step)
    this.vt += step
    this.deadline += step
    await wait(Math.max(8, this.deadline - Date.now()))
    await this.h.settle()
    this.behind = Math.max(this.behind, Date.now() - this.deadline)
    const spans = this.h.spans()
    const bg = spans.lines[0]?.spans[0]?.bg
    const body = svg(spans, bg && bg.a > 0 ? hex(bg) : "#0a0a0a", this.h.frame()).replace(
      /^<svg [^>]*>/,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${OUT_H}" viewBox="${viewBox(this.view())}" preserveAspectRatio="xMidYMid slice">`,
    )
    await Bun.write(join(this.dir, `${String(this.n++).padStart(5, "0")}.svg`), body)
  }
  async hold(seconds: number) {
    for (let i = 0; i < Math.round(seconds * FPS); i++) await this.frame()
  }
  async key(name: string, mods?: { ctrl?: boolean; shift?: boolean }, after = 0.6) {
    await this.h.press(name, mods)
    await this.hold(after)
  }
  async type(text: string, perKey = 85) {
    for (const ch of text) {
      await this.h.type(ch)
      for (let i = 0; i < Math.max(1, Math.round((perKey / 1000) * FPS)); i++) await this.frame()
    }
  }
  /** Renders the SVGs at the output size and encodes the clip, its WebM and a poster. */
  async encode(posterAt = 0.6) {
    this.h.destroy()
    const files = [...new Bun.Glob("*.svg").scanSync(this.dir)].sort()
    for (let i = 0; i < files.length; i += 16)
      await Promise.all(files.slice(i, i + 16).map((f) => Bun.$`rsvg-convert -w ${OUT_W} -h ${OUT_H} ${join(this.dir, f)} -o ${join(this.dir, f.replace(".svg", ".png"))}`.quiet()))
    const input = `${this.dir}/%05d.png`
    const base = join(OUT, this.name)
    await Bun.$`ffmpeg -y -loglevel error -framerate ${FPS} -i ${input} -vf format=yuv420p -c:v libx264 -preset slow -crf 27 -movflags +faststart ${base}.mp4`
    await Bun.$`ffmpeg -y -loglevel error -framerate ${FPS} -i ${input} -vf format=yuv420p -c:v libvpx-vp9 -b:v 0 -crf 42 -row-mt 1 ${base}.webm`
    const poster = join(this.dir, `${String(Math.min(files.length - 1, Math.round(files.length * posterAt))).padStart(5, "0")}.png`)
    await Bun.$`ffmpeg -y -loglevel error -i ${poster} -vf scale=960:-2 -c:v libwebp -quality 82 ${base}.webp`
    const mb = (f: string) => (statSync(f).size / 1e6).toFixed(2)
    console.log(`${this.name}: ${this.n} frames (${(this.n / FPS).toFixed(1)}s), mp4 ${mb(`${base}.mp4`)} MB, webm ${mb(`${base}.webm`)} MB, worst lag ${Math.round(this.behind)}ms`)
  }
}

const bible = await fixtureBible()
const LOOK = { icons: "nerd", motion: "full", theme: "opencode", welcomed: true } as const
async function clip(name: string, setup: Parameters<typeof harness>[0], run: (c: Clip) => Promise<void>, posterAt?: number) {
  if (!want(name)) return
  const h = await harness({ width: COLS, height: ROWS, store: seededStore("2026-10-11"), start: at, bible, ...setup, config: { ...LOOK, ...setup?.config } })
  const c = new Clip(name, h)
  await run(c)
  await c.encode(posterAt)
}
// where things sit at 150×42: the reading column, and the study pane when it is open
const TEXT: Rect = { x: 34, y: 1, w: 82, h: 28 }
// the pane is tall and narrow, so the camera frames its top, where the content starts
const PANE: Rect = { x: 92, y: 1, w: 58, h: 17 }

await clip("read", { initial: { route: "reader", book: 43, chapter: 3, verse: 1 } }, async (c) => {
  await c.hold(1.2)
  c.zoom(TEXT)
  await c.hold(1.2)
  for (let i = 0; i < 5; i++) await c.key("j", undefined, 0.35)
  await c.key("h", undefined, 0.9)
  await c.key("j", undefined, 0.35)
  await c.key("h", undefined, 0.3)
  await c.key("h", undefined, 1.1)
  c.zoom("full")
  await c.hold(1.2)
  await c.key("w", undefined, 2)
  await c.key("w", undefined, 1.4)
})

await clip("notes", { initial: { route: "reader", book: 43, chapter: 3, verse: 16 } }, async (c) => {
  await c.hold(0.8)
  await c.key("tab", undefined, 0.6)
  c.zoom(PANE)
  await c.hold(1.2)
  await c.type("The whole gospel in a sentence: loved, gave, believe, live.", 60)
  await c.hold(0.8)
  await c.key("escape", undefined, 0.6)
  c.zoom("full")
  await c.hold(1.4)
})

await clip("henry", { initial: { route: "reader", book: 19, chapter: 23, verse: 1 } }, async (c) => {
  await c.key("tab", undefined, 0.3)
  await c.key("2", undefined, 0.5)
  c.zoom(PANE)
  await c.hold(1.6)
  for (let i = 0; i < 4; i++) await c.key("j", undefined, 0.9)
  c.zoom("full")
  await c.hold(1.2)
})

await clip("words", { concordance: true, initial: { route: "reader", book: 43, chapter: 3, verse: 16 } }, async (c) => {
  await c.key("tab", undefined, 0.3)
  await c.key("3", undefined, 0.5)
  c.zoom(PANE)
  await c.hold(1.4)
  await c.key("j", undefined, 0.5)
  await c.key("j", undefined, 1)
  await c.key("return", undefined, 2.4)
  // down the pane to where the word is used, book by book
  c.zoom({ ...PANE, y: 18 }, 1400)
  await c.key("j", undefined, 0.6)
  await c.key("j", undefined, 1.8)
  await c.key("escape", undefined, 0.6)
  c.zoom("full")
  await c.hold(1.2)
})

await clip("scene", { config: { theme: "gruvbox" }, initial: { route: "reader", book: 43, chapter: 4, verse: 7 } }, async (c) => {
  await c.hold(0.8)
  await c.key("i", undefined, 2.5)
  c.zoom({ x: 20, y: 4, w: 110, h: 34 }, 5000)
  await c.hold(5.5)
  c.zoom("full", 900)
  await c.key("escape", undefined, 1)
}, 0.55)

await clip("progress", { initial: { route: "reader", book: 43, chapter: 3, verse: 1 } }, async (c) => {
  await c.hold(0.6)
  await c.key("s", undefined, 1.6)
  c.zoom({ x: 0, y: 0, w: 110, h: 26 })
  await c.hold(3)
  c.zoom("full")
  await c.hold(1.5)
})

await clip("palette", { config: { mode: "dark" }, initial: { route: "reader", book: 19, chapter: 23, verse: 1 } }, async (c) => {
  await c.hold(0.6)
  await c.key("p", { ctrl: true }, 0.7)
  c.zoom({ x: 35, y: 2, w: 80, h: 26 })
  await c.type("dark", 160)
  await c.hold(1)
  await c.key("return", undefined, 1.2)
  c.zoom("full")
  await c.hold(1.6)
})

await clip("search", { initial: { route: "reader", book: 43, chapter: 4, verse: 1 } }, async (c) => {
  await c.hold(0.6)
  await c.key("/", undefined, 0.5)
  c.zoom({ x: 25, y: 2, w: 100, h: 30 })
  await c.type("living water", 110)
  await c.hold(1.6)
  await c.key("down", undefined, 0.6)
  await c.key("return", undefined, 1.2)
  c.zoom("full")
  await c.hold(1.2)
})

await clip("parallel", { config: { theme: "catppuccin" }, initial: { route: "reader", book: 19, chapter: 23, verse: 1 } }, async (c) => {
  await c.hold(0.8)
  await c.key("T", { shift: true }, 1)
  c.zoom({ x: 8, y: 1, w: 134, h: 22 })
  await c.hold(1.2)
  for (let i = 0; i < 3; i++) await c.key("j", undefined, 0.6)
  await c.hold(0.8)
  c.zoom("full")
  await c.hold(1.2)
})

// Ask: the reader's own Claude Code, answering live; real time, one frame per 200ms (3x)
if (want("ask")) {
  const claudePath = Bun.which("claude")
  if (!claudePath) console.warn("ask: claude is not on PATH, skipped")
  else
    await clip(
      "ask",
      {
        agents: [claudeProvider({ bible, commentary: await fixtureCommentary(), concordance: await fixtureConcordance(), store: seededStore("2026-10-11"), translation: () => "KJV" }, claudePath)],
        initial: { route: "reader", book: 43, chapter: 4, verse: 10 },
      },
      async (c) => {
        await c.key("tab", undefined, 0.3)
        await c.key("4", undefined, 0.5)
        c.zoom(PANE)
        await c.hold(1)
        await c.type("What is the living water Jesus offers her?", 45)
        await c.h.press("return")
        const started = Date.now()
        const live = () => /thinking \d+s · esc stop/.test(c.h.frame())
        while (Date.now() - started < 120_000) {
          await c.frame(200)
          if (Date.now() - started > 3_000 && !live()) break
        }
        console.log(`ask: answered live in ${((Date.now() - started) / 1000).toFixed(1)}s`)
        await c.hold(3.5)
      },
      0.97,
    )
}

// --- one screen in several themes ------------------------------------------------------------
const THEMES = ["opencode", "tokyonight", "catppuccin", "gruvbox", "rosepine", "nord", "everforest", "github"] as const
if (want("themes")) {
  for (const theme of THEMES) {
    const h = await harness({ width: 120, height: 34, store: seededStore("2026-10-11"), start: at, bible, config: { ...LOOK, motion: "reduced", theme, prose: true }, initial: { route: "reader", book: 43, chapter: 1, verse: 1 } })
    await h.press("h")
    await h.settle()
    const spans = h.spans()
    const bg = spans.lines[0]?.spans[0]?.bg
    const file = join(work, `theme-${theme}.svg`)
    const cut = { x: 0, y: 0, w: 120, h: 34 }
    await Bun.write(
      file,
      svg(spans, bg && bg.a > 0 ? hex(bg) : "#0a0a0a", h.frame()).replace(
        /^<svg [^>]*>/,
        `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="${Math.round((1440 * 34 * CH) / (120 * CW))}" viewBox="${viewBox(cut)}">`,
      ),
    )
    await Bun.$`rsvg-convert -w 1440 ${file} -o ${file.replace(".svg", ".png")}`.quiet()
    await Bun.$`ffmpeg -y -loglevel error -i ${file.replace(".svg", ".png")} -c:v libwebp -quality 86 ${join(OUT, `theme-${theme}.webp`)}`
    h.destroy()
  }
  console.log(`themes: ${THEMES.length} stills`)
}

// --- the keyboard tour ------------------------------------------------------------------------
// A guided path through real screens: each step names the key the visitor presses, and the
// screen after it is what the app drew when that key was pressed. Frames are reduced-motion and
// unicode icons, so they settle at once and draw in a browser's own fonts.
type Run = [text: string, fg: number, bg: number, attr: number]
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" })
function encodeFrame(frame: CapturedFrame, chars: string, palette: Map<string, number>): Run[][] {
  const grid = chars.split("\n").map((l) => [...graphemes.segment(l)].map((g) => g.segment))
  const colour = (c: { r: number; g: number; b: number; a: number }) => {
    const key = c.a > 0 ? hex(c as never) : ""
    if (!palette.has(key)) palette.set(key, palette.size)
    return palette.get(key)!
  }
  return frame.lines.map((line, row) => {
    let col = 0
    const runs: Run[] = []
    for (const s of line.spans) {
      const cells = grid[row]
      const text = cells && cells.length >= col + s.width ? cells.slice(col, col + s.width).join("") : s.text
      const run: Run = [text, colour(s.fg), colour(s.bg), s.attributes & 0b101]
      const last = runs.at(-1)
      // merge neighbours that look the same, to keep the file small
      if (last && last[1] === run[1] && last[2] === run[2] && last[3] === run[3]) last[0] += text
      else runs.push(run)
      col += s.width
    }
    return runs
  })
}

/** Records the tour at one terminal size; the page picks the one that suits the visitor's screen. */
async function recordTour(file: string, cols: number, rows: number) {
  const h = await harness({ width: cols, height: rows, store: seededStore("2026-10-11"), start: at, bible, concordance: true, config: { theme: "opencode", mode: "dark", motion: "reduced", icons: "unicode", welcomed: true } })
  const palette = new Map<string, number>()
  const frames: Run[][][] = []
  const steps: { frame: number; key?: string; label?: string; caption: string }[] = []
  const snap = async () => {
    await wait(30)
    await h.settle()
    frames.push(encodeFrame(h.spans(), h.frame(), palette))
    return frames.length - 1
  }
  /** Shows the current screen with a caption, then presses `key` to reach the next one. */
  const step = async (caption: string, key: string, press: () => Promise<void>, label = key) => {
    steps.push({ frame: await snap(), key, label, caption })
    await press()
  }
  const typing = async (caption: string, text: string) => {
    for (const ch of text) await step(caption, ch === " " ? "space" : ch, () => h.type(ch), ch === " " ? "space" : ch)
  }

  await typing("This is Selah's home. Type a passage to open it: john 3", "john 3")
  await step("Selah knows what you mean. Press enter to open John 3.", "enter", () => h.press("return"))
  await step("You are reading. j moves to the next verse.", "j", () => h.press("j"))
  await step("And again: j.", "j", () => h.press("j"))
  await step("h highlights the verse you are on.", "h", () => h.press("h"))
  await step("tab opens the study desk beside the text. Notes come first: anything you type is saved.", "tab", () => h.press("tab"))
  await step("2 opens Matthew Henry's commentary on this verse.", "2", () => h.press("2"))
  await step("3 shows the Greek behind the verse, word by word.", "3", () => h.press("3"))
  await step("j moves down the words.", "j", () => h.press("j"))
  await step("enter opens a full word study: its meaning and every verse that uses it.", "enter", () => h.press("return"))
  await step("esc goes back.", "esc", () => h.press("escape"))
  await step("tab returns to the text.", "tab", () => h.press("tab"))
  await step("ctrl+p opens commands. You can type ordinary words there.", "ctrl+p", () => h.press("p", { ctrl: true }))
  await typing("Type: dark", "dark")
  await step("enter switches between dark and light.", "enter", () => h.press("return"))
  await step("s shows your progress: the streak, today, and a year of reading.", "s", () => h.press("s"))
  await step("? shows every key, in plain words. Help is always one key away.", "?", () => h.press("?"))
  steps.push({ frame: await snap(), caption: "That's the tour. Every screen in it was drawn by Selah itself. Install it and read for real." })
  h.destroy()

  const tour = { cols, rows, palette: [...palette.keys()], frames, steps }
  const path = join(OUT, file)
  await Bun.write(path, JSON.stringify(tour))
  const gz = Bun.gzipSync(await Bun.file(path).bytes()).length
  console.log(`${file}: ${cols}×${rows}, ${steps.length} steps, ${(statSync(path).size / 1e3).toFixed(0)} KB (${(gz / 1e3).toFixed(0)} KB gzipped)`)
}
if (want("tour")) {
  await recordTour("tour.json", 100, 30)
  // a phone gets the app as it lays itself out in a narrow terminal, legible at that width
  await recordTour("tour-narrow.json", 64, 36)
}

rmSync(work, { recursive: true, force: true })
process.exit(0)
