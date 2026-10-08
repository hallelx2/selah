import type { KeyEvent, TerminalColors } from "@opentui/core"
import { batch, createContext, createMemo, createSignal, onCleanup, useContext, type JSX, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Bible } from "../data/bible"
import { bookById, nextChapter, prevChapter, type ChapterKey } from "../data/books"
import type { Config } from "../data/config"
import { dayKey, type DayKey } from "../data/dates"
import { buildPlan, PLANS, planStatus } from "../data/plans"
import { formatRef, type Ref } from "../data/ref"
import { bookProgress, consistency, currentStreak, firstDay, longestStreak, met, trackedDays, type DayTotals } from "../data/stats"
import type { ReadingTracker } from "../data/tracker"
import type { UserStore } from "../data/user"
import { resolveTheme, systemTheme, themeJson, type Theme } from "../theme"

export type Route = "home" | "reader" | "progress"

export interface Deps {
  bible: Bible
  store: UserStore
  tracker: ReadingTracker
  config: Config
  saveConfig: (c: Config) => void
  palette?: TerminalColors
  terminalMode?: "dark" | "light" | null
  now?: () => number
  quit: () => void
  copy: (text: string) => boolean
}

export interface DialogEntry {
  id: string
  element: () => JSX.Element
  size: "medium" | "large" | "xlarge"
}

export interface Toast {
  id: number
  message: string
  detail?: string
  tone: "info" | "success" | "warning" | "error"
}

type KeyHandler = (key: KeyEvent) => boolean | void

export interface ActivePlan {
  id: string
  startedOn: DayKey
}

function init(deps: Deps) {
  const now = deps.now ?? Date.now
  const [config, setConfigStore] = createStore<Config>(structuredClone(deps.config))
  const [route, setRoute] = createSignal<Route>("home")
  const [position, setPosition] = createSignal<{ book: number; chapter: number; verse: number }>(
    deps.store.position() ?? { book: 43, chapter: 1, verse: 1 },
  )
  const [dialogs, setDialogs] = createStore<DialogEntry[]>([])
  const [toasts, setToasts] = createSignal<Toast[]>([])
  const [preview, setPreview] = createSignal<string | undefined>()
  const [parallel, setParallel] = createSignal(false)
  const [rev, setRev] = createSignal(0)
  const [plan, setPlanSignal] = createSignal<ActivePlan | undefined>(deps.store.get<ActivePlan | undefined>("plan", undefined))
  const [today, setToday] = createSignal(dayKey(now()))

  // The date can roll over while the app is open; stats and plans follow it.
  const dayTimer = setInterval(() => {
    const d = dayKey(now())
    if (d !== today()) setToday(d)
  }, 30_000)
  onCleanup(() => clearInterval(dayTimer))

  const bump = () => setRev((n) => n + 1)
  const offRead = deps.tracker.onRead((e) => {
    bump()
    const totals = deps.store.dayTotals()
    const goal = config.goal
    const name = formatRef({ book: e.book, chapter: e.chapter })
    const metNow = met(totals.get(e.day), goal)
    const streak = currentStreak(totals, goal, today())
    if (metNow && (totals.get(e.day)?.chapters ?? 0) === goal.amount && goal.kind === "chapters") {
      toast(`Daily goal met · ${streak} day streak`, `${name} recorded as read`, "success")
    } else {
      toast(`${name} recorded as read`, e.source === "manual" ? "Marked by hand" : undefined, "success")
    }
  })
  onCleanup(offRead)

  // theme ----------------------------------------------------------------------

  const mode = createMemo<"dark" | "light">(() =>
    config.mode === "auto" ? (deps.terminalMode ?? "dark") : config.mode,
  )
  const theme = createMemo<Theme>(() => {
    const name = preview() ?? config.theme
    if (name === "system" && deps.palette) return resolveTheme("system", systemTheme(deps.palette), mode())
    const json = themeJson(name) ?? themeJson("opencode")!
    return resolveTheme(name, json, mode())
  })

  function setConfig<K extends keyof Config>(key: K, value: Config[K]) {
    // produce assigns by reference; a plain setStore(key, object) would merge into the old object.
    setConfigStore(
      produce((c) => {
        c[key] = structuredClone(value)
      }),
    )
    deps.saveConfig({ ...config })
  }

  // keys -------------------------------------------------------------------------

  const handlers: { fn: KeyHandler; modal: boolean }[] = []
  function useKeys(fn: KeyHandler, opts: { modal?: boolean } = {}) {
    const entry = { fn, modal: !!opts.modal }
    handlers.push(entry)
    onCleanup(() => {
      const i = handlers.indexOf(entry)
      if (i >= 0) handlers.splice(i, 1)
    })
  }
  function dispatch(key: KeyEvent) {
    for (let i = handlers.length - 1; i >= 0; i--) {
      const h = handlers[i]!
      if (h.fn(key) === true) return true
      if (h.modal) return false
    }
    return false
  }

  // dialogs ----------------------------------------------------------------------

  let dialogSeq = 0
  function openDialog(element: () => JSX.Element, size: DialogEntry["size"] = "medium") {
    const id = `d${++dialogSeq}`
    setDialogs(produce((d) => d.push({ id, element, size })))
    return id
  }
  function closeDialog(id?: string) {
    setDialogs((d) => (id ? d.filter((x) => x.id !== id) : d.slice(0, -1)))
    if (!dialogs.length) setPreview(undefined)
  }
  function closeAllDialogs() {
    setDialogs([])
    setPreview(undefined)
  }

  // toasts -----------------------------------------------------------------------

  let toastSeq = 0
  function toast(message: string, detail?: string, tone: Toast["tone"] = "info") {
    const id = ++toastSeq
    setToasts((t) => [...t.slice(-2), { id, message, detail, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }

  // reading ----------------------------------------------------------------------

  const translation = () => config.translation
  const installed = createMemo(() => {
    rev()
    return deps.bible.translations()
  })

  function openChapter(key: ChapterKey, verse = 1) {
    batch(() => {
      setPosition({ book: key.book, chapter: key.chapter, verse })
      setRoute("reader")
    })
    deps.store.setPosition({ book: key.book, chapter: key.chapter, verse, translation: translation() })
  }

  function goTo(ref: Ref) {
    openChapter({ book: ref.book, chapter: ref.chapter }, ref.verseStart ?? 1)
  }

  function setVerse(verse: number) {
    const p = position()
    if (p.verse === verse) return
    setPosition({ ...p, verse })
    deps.store.setPosition({ ...p, verse, translation: translation() })
  }

  const next = () => {
    const n = nextChapter(position())
    if (n) openChapter(n)
    else toast("You have reached the end of Revelation", undefined, "info")
  }
  const prev = () => {
    const p = prevChapter(position())
    if (p) openChapter(p)
  }

  // tracking ---------------------------------------------------------------------

  const totals = createMemo<Map<DayKey, DayTotals>>(() => {
    rev()
    today()
    return deps.store.dayTotals()
  })
  const reads = createMemo(() => {
    rev()
    return deps.store.chapterReads()
  })
  const streak = createMemo(() => currentStreak(totals(), config.goal, today()))
  const longest = createMemo(() => longestStreak(totals(), config.goal))
  const todayTotals = createMemo(() => totals().get(today()) ?? { chapters: 0, minutes: 0 })
  const progress = createMemo(() => bookProgress(reads()))
  const since = createMemo(() => firstDay(totals()))
  const tracked = createMemo(() => trackedDays(totals(), today()))
  const consistency30 = createMemo(() => consistency(totals(), config.goal, today(), 30, since()))
  // Depends on rev so it refreshes after the first-run import fills the library.
  const words = createMemo(() => {
    rev()
    return deps.bible.chapterWords(translation())
  })

  const activePlan = createMemo(() => {
    const p = plan()
    if (!p) return undefined
    const def = PLANS.find((x) => x.id === p.id)
    if (!def) return undefined
    const kjv = deps.bible.chapterWords("KJV")
    const built = buildPlan(def, kjv.size ? kjv : words())
    const since = reads().filter((r) => r.day >= p.startedOn)
    return { ...p, def, built, status: planStatus(built, p.startedOn, since, today()) }
  })

  function setPlan(id: string | undefined) {
    const value = id ? { id, startedOn: today() } : undefined
    deps.store.set("plan", value)
    setPlanSignal(value)
  }

  function markRead() {
    const p = position()
    if (deps.store.readOn(p.book, p.chapter, today())) {
      deps.store.unrecordRead(p.book, p.chapter, today())
      bump()
      toast(`${formatRef(p)} unmarked`, "Removed from today's reading", "warning")
      return
    }
    deps.tracker.markRead()
  }

  return {
    deps,
    config,
    setConfig,
    route,
    setRoute,
    position,
    setVerse,
    openChapter,
    goTo,
    next,
    prev,
    translation,
    installed,
    parallel,
    setParallel,
    theme,
    setPreview,
    mode,
    useKeys,
    dispatch,
    dialogs,
    openDialog,
    closeDialog,
    closeAllDialogs,
    toasts,
    toast,
    rev,
    bump,
    today,
    totals,
    reads,
    streak,
    longest,
    todayTotals,
    progress,
    consistency30,
    since,
    tracked,
    words,
    activePlan,
    setPlan,
    markRead,
    bookName: (id: number) => bookById(id).name,
    now,
  }
}

export type App = ReturnType<typeof init>

const AppContext = createContext<App>()

export function AppProvider(props: ParentProps<{ deps: Deps }>) {
  const app = init(props.deps)
  return <AppContext.Provider value={app}>{props.children}</AppContext.Provider>
}

export function useApp(): App {
  const app = useContext(AppContext)
  if (!app) throw new Error("useApp must be used inside AppProvider")
  return app
}
