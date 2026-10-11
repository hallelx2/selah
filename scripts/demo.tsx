// Records the demo video: a scripted session of the real app, captured frame by frame from the
// OpenTUI renderer and encoded as MP4 and WebM for the site and the README.
//
//   bun scripts/demo.tsx              (needs rsvg-convert and ffmpeg; Ask needs Claude Code)
//
// Nothing in it is mocked. The keys are pressed one by one as a person types them, the clock
// moves only as frames are captured (so every animation plays as it really does), and the Ask
// answer is the reader's own local Claude Code answering live, through Selah's MCP tools. That
// one stretch is recorded on the real clock and sped up 3x; the site's caption says so.
import { mkdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { claudeProvider } from "../src/agent/claude"
import { harness, type Harness } from "../test/harness"
import { fixtureBible, fixtureCommentary, fixtureConcordance } from "../test/fixture"
import { seededStore } from "../test/seed"
import { hex, svg } from "./frame-svg"

const FPS = 15
const W = 150
const H = 42
const dir = join(process.env.TMPDIR ?? "/tmp", "selah-demo")
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

const store = seededStore("2026-10-11")
store.setPosition({ book: 1, chapter: 1, verse: 1, translation: "KJV" })
const bible = await fixtureBible()
const commentary = await fixtureCommentary()
const concordance = await fixtureConcordance()
const claudePath = Bun.which("claude")
const agents = claudePath ? [claudeProvider({ bible, commentary, concordance, store, translation: () => "KJV" }, claudePath)] : []
if (!claudePath) console.warn("claude is not on PATH: the Ask scene will show the empty state")

const h: Harness = await harness({
  width: W,
  height: H,
  store,
  bible,
  concordance,
  agents,
  start: new Date(2026, 9, 11, 7, 30),
  config: { icons: "nerd", motion: "full", theme: "opencode", welcomed: true },
})

let n = 0
/** One frame: move the clock a frame, let the app render, write it out. */
async function frame(step = 1000 / FPS) {
  h.advance(step)
  await wait(8)
  await h.settle()
  const spans = h.spans()
  const bg = spans.lines[0]?.spans[0]?.bg
  const file = join(dir, `${String(n++).padStart(5, "0")}.svg`)
  await Bun.write(file, svg(spans, bg && bg.a > 0 ? hex(bg) : "#0a0a0a", h.frame()))
}
const hold = async (seconds: number) => {
  for (let i = 0; i < seconds * FPS; i++) await frame()
}
/** Types like a person: a key, a beat, the next key. */
async function type(text: string, perKey = 90) {
  for (const ch of text) {
    await h.type(ch)
    for (let i = 0; i < Math.max(1, Math.round((perKey / 1000) * FPS)); i++) await frame()
  }
}
async function key(name: string, mods?: { ctrl?: boolean; shift?: boolean }, after = 0.6) {
  await h.press(name, mods)
  await hold(after)
}

// 1. Home: the logo's light, the verse of the day
await hold(3)
// 2. go to a passage by typing it
await type("john 3:16")
await hold(0.8)
await key("return", undefined, 2.2)
// 3. mark the verse, then open the study desk
await key("h", undefined, 1)
await key("tab", undefined, 1)
await type("The heart of the gospel, in one sentence.", 55)
await key("escape", undefined, 1.5)
// 4. Matthew Henry on this verse
await key("2", undefined, 2.5)
await key("j", undefined, 0.4)
await key("j", undefined, 1.5)
// 5. the Greek behind it, and a word study of ἠγάπησεν
await key("3", undefined, 1.5)
await key("j", undefined, 0.5)
await key("j", undefined, 1.2)
await key("return", undefined, 3)
await key("j", undefined, 0.4)
await key("j", undefined, 1.5)
await key("escape", undefined, 1)

// 6. Ask: the reader's own Claude Code, live
await key("4", undefined, 1)
if (agents.length) {
  await type("Why does Jesus say 'born again' to Nicodemus?", 45)
  await h.press("return")
  // real time from here: one frame every 200ms of real time, played at 15 fps (3x)
  const started = Date.now()
  const live = () => h.frame().includes("thinking")
  while (Date.now() - started < 120_000) {
    await wait(200)
    await frame(200)
    if (Date.now() - started > 3_000 && !live()) break
  }
  console.log(`Ask answered live in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  await hold(4)
} else await hold(2)
await key("tab", undefined, 0.8)

// 7. a Doré engraving: go to John 4, open the scene, let it surface and drift
await key("o", undefined, 0.5)
await type("john 4:7")
await key("return", undefined, 1.5)
await key("i", undefined, 6)
await key("escape", undefined, 1)

// 8. progress: the streak and the heatmap
await key("s", undefined, 4)

h.destroy()
console.log(`${n} frames`)

// SVG → PNG (in parallel), then encode
const svgs = [...new Bun.Glob("*.svg").scanSync(dir)].sort()
const batch = 16
for (let i = 0; i < svgs.length; i += batch) {
  await Promise.all(svgs.slice(i, i + batch).map((f) => Bun.$`rsvg-convert -z 1 ${join(dir, f)} -o ${join(dir, f.replace(".svg", ".png"))}`.quiet()))
}
mkdirSync("docs/demo", { recursive: true })
// the page frames the video as a window already, so crop the exporter's own window chrome
// (frame-svg draws the grid at 24,44 with 9.6×20 cells) down to the terminal itself
const scale = `crop=${Math.round(W * 9.6)}:${H * 20}:24:44,scale=trunc(iw/2)*2:trunc(ih/2)*2`
await Bun.$`ffmpeg -y -loglevel error -framerate ${FPS} -i ${dir}/%05d.png -vf ${scale},format=yuv420p -c:v libx264 -preset slow -crf 26 -movflags +faststart docs/demo/selah-demo.mp4`
await Bun.$`ffmpeg -y -loglevel error -framerate ${FPS} -i ${dir}/%05d.png -vf ${scale},format=yuv420p -c:v libvpx-vp9 -b:v 0 -crf 40 -row-mt 1 docs/demo/selah-demo.webm`
await Bun.$`ffmpeg -y -loglevel error -i ${join(dir, `${String(Math.round(n * 0.12)).padStart(5, "0")}.png`)} -vf ${scale} docs/demo/selah-demo-poster.png`
for (const f of ["selah-demo.mp4", "selah-demo.webm", "selah-demo-poster.png"]) console.log(f, `${(statSync(`docs/demo/${f}`).size / 1e6).toFixed(1)} MB`)
rmSync(dir, { recursive: true, force: true })
process.exit(0)
