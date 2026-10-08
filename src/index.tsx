#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import pkg from "../package.json"
import { Bible } from "./data/bible"
import { loadConfig, saveConfig } from "./data/config"
import { dayKey } from "./data/dates"
import { openBibleDb } from "./data/db"
import { importTranslation } from "./data/importer"
import { formatRef, parseRef } from "./data/ref"
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

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith("-")))
const tIndex = argv.findIndex((a) => a === "-t" || a === "--translation")
const translationFlag = tIndex >= 0 ? argv[tIndex + 1]?.toUpperCase() : undefined
const words = argv.filter((a, i) => !a.startsWith("-") && !(tIndex >= 0 && i === tIndex + 1))

if (flags.has("-h") || flags.has("--help")) {
  console.log(HELP)
  process.exit(0)
}
if (flags.has("-v") || flags.has("--version")) {
  console.log(pkg.version)
  process.exit(0)
}

const config = loadConfig()
if (translationFlag) config.translation = translationFlag
const bible = new Bible(openBibleDb())
const store = UserStore.open()
const print = flags.has("-p") || flags.has("--print") || (!process.stdout.isTTY && words.length > 0)

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

const command = words[0]?.toLowerCase()

if (command === "install") {
  for (const id of words.slice(1).map((w) => w.toUpperCase())) await ensureTranslation(id)
  process.exit(0)
}

if (command === "translations") {
  const installed = new Set(bible.translations().map((t) => t.id))
  for (const c of CATALOG) {
    console.log(`${installed.has(c.id) ? "●" : "○"} ${c.id.padEnd(5)} ${c.name} (${c.year})${c.id === config.translation ? "  · current" : ""}`)
  }
  process.exit(0)
}

if (command === "stats") {
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
  if (flags.has("--json")) {
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

if (command === "search" && print !== false && (print || words.length > 1)) {
  await ensureTranslation(config.translation)
  const query = words.slice(1).join(" ")
  for (const h of bible.search(config.translation, query, 50)) {
    console.log(`${formatRef({ book: h.book, chapter: h.chapter, verseStart: h.verse })}  ${plain(h.text)}`)
  }
  process.exit(0)
}

const ref = words.length ? parseRef(words.join(" ")) : null
if (words.length && !ref && command !== "search") {
  console.error(`Not a reference: ${words.join(" ")}. Try "john 3:16" or "ps 23".`)
  process.exit(1)
}

if (print && ref) {
  await ensureTranslation(config.translation)
  const verses = bible.verses(config.translation, ref)
  console.log(`${formatRef(ref)} (${config.translation})`)
  for (const v of verses) console.log(`${String(v.verse).padStart(3)}  ${plain(v.text)}`)
  process.exit(0)
}

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

function quit() {
  tracker.close()
  renderer.destroy()
  process.exit(0)
}
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
      }}
      initial={
        ref
          ? { route: "reader", book: ref.book, chapter: ref.chapter, verse: ref.verseStart }
          : command === "search"
            ? { route: "home" }
            : undefined
      }
    />
  ),
  renderer,
)
