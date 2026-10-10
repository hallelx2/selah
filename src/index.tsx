#!/usr/bin/env bun
import { createCliRenderer, type RGBA } from "@opentui/core"
import { writeSync } from "node:fs"
import { render } from "@opentui/solid"
import pkg from "../package.json"
import { Bible } from "./data/bible"
import { loadConfig, saveConfig } from "./data/config"
import { dayKey } from "./data/dates"
import { openBibleDb } from "./data/db"
import { importTranslation } from "./data/importer"
import { parseCli } from "./cli"
import { formatRef } from "./data/ref"
import { bookProgress, consistency, currentStreak, firstDay, longestStreak, trackedDays, verdict } from "./data/stats"
import { ReadingTracker } from "./data/tracker"
import { CATALOG } from "./data/translations"
import { UserStore } from "./data/user"
import { App } from "./ui/app"
import { plain } from "./ui/components/verse"

const HELP = `selah ${pkg.version}  a Bible for the terminal

Usage
  selah                     open the app
  selah <reference>         open at a passage          selah john 3:16
  selah <reference> -p      print a passage and exit   selah ps 23 -p
  selah search <words>      print search results       selah search "living water"
  selah stats [--json]      print streak and progress  (for status bars)
  selah install <id>        download a translation     ${CATALOG.map((c) => c.id).join(", ")}
  selah translations        list translations

Options
  -t, --translation <id>    translation to use (default from config)
  -p, --print               print instead of opening the app
  -h, --help                show this help
  -v, --version             show the version

Data lives in $XDG_DATA_HOME/selah, settings in $XDG_CONFIG_HOME/selah/config.json.`

const cli = parseCli(process.argv.slice(2), { tty: !!process.stdout.isTTY })
const action = cli.action
const translationFlag = cli.translation

if (action.kind === "help") {
  console.log(HELP)
  process.exit(0)
}
if (action.kind === "version") {
  console.log(pkg.version)
  process.exit(0)
}
if (action.kind === "error") {
  console.error(action.message)
  process.exit(1)
}

const config = loadConfig()
if (translationFlag) config.translation = translationFlag
const bible = new Bible(openBibleDb())
const store = UserStore.open()

async function ensureTranslation(id: string) {
  if (bible.hasTranslation(id)) return
  if (!CATALOG.some((c) => c.id === id)) {
    console.error(`Unknown translation ${id}. Available: ${CATALOG.map((c) => c.id).join(", ")}`)
    process.exit(1)
  }
  process.stderr.write(`Downloading ${id}… `)
  await importTranslation(bible.db, id)
  process.stderr.write("done\n")
}

if (action.kind === "install") {
  for (const id of action.ids) await ensureTranslation(id)
  process.exit(0)
}

if (action.kind === "translations") {
  const installed = new Set(bible.translations().map((t) => t.id))
  for (const c of CATALOG) {
    console.log(`${installed.has(c.id) ? "●" : "○"} ${c.id.padEnd(5)} ${c.name} (${c.year})${c.id === config.translation ? "  · current" : ""}`)
  }
  process.exit(0)
}

if (action.kind === "stats") {
  const totals = store.dayTotals()
  const today = dayKey()
  const streak = currentStreak(totals, config.goal, today)
  const c30 = consistency(totals, config.goal, today, 30, firstDay(totals))
  const progress = bookProgress(store.chapterReads())
  const todayTotals = totals.get(today) ?? { chapters: 0, minutes: 0 }
  const span = Math.min(30, Math.max(1, trackedDays(totals, today)))
  const windowLabel = span < 30 ? `the ${span} ${span === 1 ? "day" : "days"} tracked` : "the last 30 days"
  const data = {
    streak,
    longestStreak: longestStreak(totals, config.goal),
    today: { chapters: todayTotals.chapters, minutes: Math.round(todayTotals.minutes) },
    goal: config.goal,
    goalMet: (config.goal.kind === "chapters" ? todayTotals.chapters : todayTotals.minutes) >= config.goal.amount,
    consistency30: Math.round(c30 * 100),
    verdict: verdict(c30, trackedDays(totals, today)).label,
    bibleRead: { chapters: progress.total.read, percent: Math.round(progress.total.fraction * 1000) / 10 },
  }
  if (action.json) {
    // waybar's custom module format: text, tooltip, class.
    console.log(
      JSON.stringify({
        ...data,
        text: `▲ ${streak}`,
        tooltip: `${data.verdict} · ${data.consistency30}% of ${windowLabel}\nToday ${data.today.chapters} ch, ${data.today.minutes} min\n${data.bibleRead.percent}% of the Bible read`,
        class: data.goalMet ? "met" : streak > 0 ? "pending" : "none",
      }),
    )
  } else {
    console.log(`▲ ${streak} ${streak === 1 ? "day" : "days"} streak (longest ${data.longestStreak})`)
    console.log(`today: ${data.today.chapters} ${data.today.chapters === 1 ? "chapter" : "chapters"}, ${data.today.minutes} min${data.goalMet ? " · goal met" : ""}`)
    console.log(`${data.verdict}: ${data.consistency30}% of ${windowLabel}`)
    console.log(`Bible: ${data.bibleRead.chapters}/1189 chapters (${data.bibleRead.percent}%)`)
  }
  process.exit(0)
}

if (action.kind === "search") {
  await ensureTranslation(config.translation)
  const hits = bible.search(config.translation, action.query, 50)
  if (!hits.length) console.error(`No verses match ${action.query} in ${config.translation}.`)
  for (const h of hits) {
    console.log(`${formatRef({ book: h.book, chapter: h.chapter, verseStart: h.verse })}  ${plain(h.text)}`)
  }
  process.exit(0)
}

if (action.kind === "print") {
  await ensureTranslation(config.translation)
  const verses = bible.verses(config.translation, action.ref)
  console.log(`${formatRef(action.ref)} (${config.translation})`)
  for (const v of verses) console.log(`${String(v.verse).padStart(3)}  ${plain(v.text)}`)
  process.exit(0)
}

// An explicit -t must be readable in the app: fetch it now rather than open an empty reader.
// (A configured translation that is missing falls back to an installed one inside the app.)
if (translationFlag && bible.translations().length) await ensureTranslation(translationFlag)
const ref = action.ref

// the app ---------------------------------------------------------------------------------

const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true, targetFps: 60 })
renderer.setTerminalTitle("Selah")
if (process.env.SELAH_DEBUG_LOG) {
  const { appendFileSync } = await import("node:fs")
  const log = (...a: unknown[]) => appendFileSync(process.env.SELAH_DEBUG_LOG!, a.map((x) => (x instanceof Error ? x.stack : typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n")
  process.on("uncaughtException", (e) => log("uncaught", e))
  process.on("unhandledRejection", (e) => log("rejection", e))
  for (const level of ["error", "warn", "log"] as const) {
    const orig = console[level].bind(console)
    console[level] = (...a: unknown[]) => (log(level, ...a), orig(...a))
  }
}
const palette = process.env.SELAH_NO_PALETTE ? undefined : await renderer.getPalette({ timeout: 300 } as never).catch(() => undefined)
const tracker = new ReadingTracker(store)

const paint = !process.env.SELAH_NO_PAINT
const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0")
/** Through the renderer's own writer, so the escape is ordered with frames, never inside one. */
const writeOut = (s: string) => (renderer as unknown as { writeOut(s: string): void }).writeOut(s)
function setTerminalBackground(color: RGBA | undefined) {
  if (!paint) return
  if (!color) return renderer.resetTerminalBgColor()
  painted = true
  writeOut(`\x1b]11;rgb:${toHex(color.r)}/${toHex(color.g)}/${toHex(color.b)}\x1b\\`)
}

let painted = false
// Give the terminal its own background back however Selah ends (quit, a signal or a crash).
// Written synchronously: the renderer's writer is asynchronous and process.exit would drop a
// queued reset, leaving the terminal tinted after Selah closes.
process.on("exit", () => {
  if (painted) writeSync(1, "\x1b]111\x1b\\")
})

function quit() {
  tracker.close()
  renderer.destroy()
  process.exit(0)
}
process.on("SIGINT", quit)
process.on("SIGHUP", quit)
process.on("SIGTERM", quit)

await render(
  () => (
    <App
      deps={{
        bible,
        store,
        tracker,
        config,
        saveConfig: (c) => saveConfig({ ...c, translation: translationFlag && c.translation === translationFlag ? loadConfig().translation : c.translation }),
        palette,
        terminalMode: renderer.themeMode,
        quit,
        copy: (text) => renderer.copyToClipboardOSC52(text),
        setTerminalBackground,
      }}
      initial={
        ref ? { route: "reader", book: ref.book, chapter: ref.chapter, verse: ref.verseStart } : undefined
      }
    />
  ),
  renderer,
)
