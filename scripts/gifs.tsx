// Records the app's motion as GIFs for the README, frame by frame on the harness's manual
// clock, so every frame is exact and the recording is reproducible.
// Run: bun scripts/gifs.tsx   (needs rsvg-convert and ffmpeg)
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { addDays } from "../src/data/dates"
import { UserStore } from "../src/data/user"
import { harness, type Harness } from "../test/harness"
import { seededStore } from "../test/seed"
import { hex, svg } from "./frame-svg"

const FPS = 20
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function record(name: string, h: Harness, frames: number, step = 1000 / FPS, before?: () => Promise<void>) {
  const dir = join("/tmp", `selah-gif-${name}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  await before?.()
  for (let i = 0; i < frames; i++) {
    h.advance(step)
    await wait(20)
    await h.settle()
    const frame = h.spans()
    const bg = frame.lines[0]?.spans[0]?.bg
    const file = join(dir, `${String(i).padStart(4, "0")}.svg`)
    await Bun.write(file, svg(frame, bg && bg.a > 0 ? hex(bg) : "#0a0a0a"))
    await Bun.$`rsvg-convert -z 1 ${file} -o ${file.replace(".svg", ".png")}`.quiet()
  }
  const out = `docs/screenshots/${name}.gif`
  await Bun.$`ffmpeg -y -loglevel error -framerate ${FPS} -i ${dir}/%04d.png -vf "split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=sierra2_4a" ${out}`
  h.destroy()
  console.log(`wrote ${out}`)
}

const at = new Date(2026, 9, 8, 7, 30)
const nerd = { icons: "nerd" as const, motion: "full" as const }

// 1. Home: the verse of the day surfaces, then a beam of light crosses the logo.
{
  const h = await harness({ width: 110, height: 34, store: seededStore(), start: at, config: nerd })
  await record("beam", h, 48, 1000 / FPS, async () => {
    await wait(720) // the first beam is scheduled 700ms after mount
  })
}

// 2. Reading to the end of Psalm 23: the meter fills, the read is recorded, a 7-day
//    milestone plays.
{
  const store = UserStore.memory()
  for (let i = 1; i <= 6; i++) store.recordRead({ book: 40, chapter: i, day: addDays("2026-10-08", -i), readAt: 0, source: "manual" })
  const h = await harness({ width: 110, height: 34, store, start: at, config: { ...nerd, theme: "catppuccin" }, initial: { route: "reader", book: 19, chapter: 23 } })
  await record("milestone", h, 60, 1000 / FPS, async () => {
    // read it properly: reach the end and spend the time
    for (let i = 0; i < 6; i++) {
      h.advance(1_600)
      await h.press("j")
    }
  })
}

// 3. Progress: numbers count up, bars fill, the heatmap is drawn.
{
  const h = await harness({ width: 120, height: 44, store: seededStore(), start: at, config: { ...nerd, theme: "tokyonight" } })
  await record("progress", h, 26, 1000 / FPS, async () => {
    await h.press("s", { ctrl: true })
  })
}

process.exit(0)
