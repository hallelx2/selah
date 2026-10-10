import { TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { importTranslation } from "../data/importer"
import { CATALOG } from "../data/translations"
import { CelebrationLayer } from "./components/celebration"
import { DialogLayer, ToastLayer } from "./components/dialog"
import { openIcons } from "./dialogs"
import { Logo } from "./components/logo"
import { Bar } from "./components/primitives"
import { Home } from "./routes/home"
import { Progress } from "./routes/progress"
import { Reader } from "./routes/reader"
import { AppProvider, useApp, type Deps, type Route } from "./state"

export function App(props: { deps: Deps; initial?: { route: Route; book?: number; chapter?: number; verse?: number } }) {
  return (
    <AppProvider deps={props.deps}>
      <Root initial={props.initial} />
    </AppProvider>
  )
}

function Root(props: { initial?: { route: Route; book?: number; chapter?: number; verse?: number } }) {
  const app = useApp()
  const renderer = useRenderer()
  const dims = useTerminalDimensions()
  const [ready, setReady] = createSignal(app.installed().length > 0)

  // If the library exists but a default translation is missing (say, a CLI print installed
  // only KJV), fetch the rest quietly instead of blocking on the setup screen.
  onMount(async () => {
    if (!ready()) return
    for (const c of CATALOG.filter((c) => c.default && !app.deps.bible.hasTranslation(c.id))) {
      try {
        await importTranslation(app.deps.bible.db, c.id)
        app.bump()
        app.toast(`Installed ${c.id}`, c.name, "success")
      } catch {
        // offline: the translations dialog can retry later
      }
    }
  })

  // Ask once whether Nerd Font glyphs render (there is no way to detect the font), as soon as
  // the library is ready: on a true first launch that is after Setup finishes.
  let asked = false
  createEffect(() => {
    if (!ready() || asked || app.config.icons !== undefined) return
    asked = true
    const id = setTimeout(() => openIcons(app, true), 50)
    onCleanup(() => clearTimeout(id))
  })

  onMount(() => {
    const i = props.initial
    if (!i) return
    if (i.route === "reader" && i.book) app.openChapter({ book: i.book, chapter: i.chapter ?? 1 }, i.verse ?? 1)
    else app.setRoute(i.route)
  })

  createEffect(() => {
    renderer.setBackgroundColor(app.theme().background)
  })

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      if (app.dialogs.length) return app.closeDialog()
      // Credit the reading up to this key press, exactly as q does.
      app.deps.tracker.activity()
      return app.deps.quit()
    }
    app.dispatch(key)
  })

  return (
    <box width={dims().width} height={dims().height} backgroundColor={app.theme().background} flexDirection="column">
      <Show when={ready()} fallback={<Setup onDone={() => setReady(true)} />}>
        <Switch>
          <Match when={app.route() === "home"}>
            <Home />
          </Match>
          <Match when={app.route() === "reader"}>
            <Reader />
          </Match>
          <Match when={app.route() === "progress"}>
            <Progress />
          </Match>
        </Switch>
      </Show>
      <DialogLayer />
      <ToastLayer />
      <CelebrationLayer />
    </box>
  )
}

/** First run: fetch the default translations once, with real progress, then never again. */
function Setup(props: { onDone: () => void }) {
  const app = useApp()
  const t = () => app.theme()
  const defaults = CATALOG.filter((c) => c.default)
  const [state, setState] = createSignal<Record<string, { phase: string; fraction: number; error?: string }>>({})
  const [failed, setFailed] = createSignal(false)

  async function run() {
    setFailed(false)
    for (const c of defaults) {
      if (app.deps.bible.hasTranslation(c.id)) {
        setState((s) => ({ ...s, [c.id]: { phase: "done", fraction: 1 } }))
        continue
      }
      try {
        await importTranslation(app.deps.bible.db, c.id, (e) => {
          const fraction = e.phase === "download" ? e.fraction * 0.7 : e.phase === "import" ? 0.7 + e.fraction * 0.25 : 0.95 + e.fraction * 0.05
          setState((s) => ({ ...s, [c.id]: { phase: e.phase, fraction } }))
        })
        setState((s) => ({ ...s, [c.id]: { phase: "done", fraction: 1 } }))
      } catch (e) {
        setState((s) => ({ ...s, [c.id]: { phase: "error", fraction: 0, error: e instanceof Error ? e.message : String(e) } }))
        setFailed(true)
        return
      }
    }
    app.bump()
    setTimeout(props.onDone, 400)
  }
  onMount(() => void run())
  app.useKeys((key) => {
    if (failed() && key.name === "r") return void run(), true
    if (key.name === "q") return app.deps.quit(), true
    return true
  })

  const label = (phase: string) =>
    phase === "download" ? "downloading" : phase === "import" ? "importing" : phase === "index" ? "indexing" : phase === "done" ? "ready" : phase === "error" ? "failed" : "waiting"

  return (
    <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column" gap={1}>
      <Logo />
      <text fg={t().textMuted}>Setting up your library. This happens once; after it, Selah works offline.</text>
      <box flexDirection="column" width={64} paddingTop={1} gap={1}>
        {defaults.map((c) => (
          <box flexDirection="column">
            <box flexDirection="row" justifyContent="space-between">
              <text wrapMode="none">
                <span style={{ fg: t().text, attributes: TextAttributes.BOLD }}>{c.id}</span>
                <span style={{ fg: t().textMuted }}>  {c.name}</span>
              </text>
              <text fg={state()[c.id]?.phase === "error" ? t().error : state()[c.id]?.phase === "done" ? t().success : t().textMuted} wrapMode="none">
                {label(state()[c.id]?.phase ?? "")}
              </text>
            </box>
            <Bar fraction={state()[c.id]?.fraction ?? 0} width={64} color={state()[c.id]?.phase === "done" ? t().success : t().primary} />
            <Show when={state()[c.id]?.error}>
              <text fg={t().error} wrapMode="word">
                {state()[c.id]!.error}
              </text>
            </Show>
          </box>
        ))}
      </box>
      <Show when={failed()}>
        <text fg={t().textMuted}>
          Check your connection, then press <span style={{ fg: t().text }}>r</span> to retry or <span style={{ fg: t().text }}>q</span> to quit.
        </text>
      </Show>
    </box>
  )
}
