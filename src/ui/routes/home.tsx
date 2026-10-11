import { TextAttributes, type InputRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { formatRef, parseGoTo } from "../../data/ref"
import { formatMinutes } from "../../data/stats"
import { Bar, Footer, LeftBar, fit } from "../components/primitives"
import { Logo } from "../components/logo"
import { VerseText } from "../components/verse"
import { openHelp, openPalette, openPlans, openSearch, openTranslations } from "../dialogs"
import { ease } from "../motion"
import { useApp } from "../state"

const PLACEHOLDERS = ["john 3:16", "psalm 23", "romans 8", '"living water"', "love in:1jn", "faith in:nt"]

export function Home() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const t = () => app.theme()
  const [value, setValue] = createSignal("")
  let input: InputRenderable | undefined

  const votd = createMemo(() => app.deps.bible.verseOfTheDay(app.translation(), new Date(app.now())))
  // The verse of the day surfaces gently, like ink coming up on the page.
  const reveal = app.motion.start(900, 150)
  const fade = () => app.motion.progress(reveal, ease.outCubic)
  const placeholder = PLACEHOLDERS[Math.floor(app.now() / 86_400_000) % PLACEHOLDERS.length]
  const recent = createMemo(() => {
    app.rev()
    return app.deps.store.recentChapters(4)
  })
  const resume = () => app.deps.store.position()
  const plan = () => app.activePlan()
  const parsed = createMemo(() => parseGoTo(value()))

  app.useReturnFocus(() => input && !input.isDestroyed && input.focus())

  function submit(v: string) {
    const text = v.trim()
    if (!text) {
      const p = resume()
      if (p) app.openChapter(p, p.verse)
      else app.openChapter({ book: 43, chapter: 1 })
      return
    }
    const ref = parseGoTo(text)
    if (ref) return app.goTo(ref)
    // the words a newcomer tries when nothing else is obvious
    const word = text.toLowerCase().replace(/[^a-z ]/g, "").trim()
    if (["quit", "exit", "close", "bye", "q"].includes(word)) return app.deps.tracker.activity(), app.deps.quit()
    if (["help", "keys", "keyboard", "how", "how to use", "commands", "menu"].includes(word)) return openHelp(app)
    openSearch(app, text)
  }

  function openToday() {
    const p = plan()
    if (!p) return openPlans(app)
    const first = p.status.next.chapters[0]
    if (first) app.openChapter(first)
  }

  app.useKeys((key) => {
    if (key.ctrl && key.name === "p") return openPalette(app), true
    if (key.ctrl && key.name === "s") return app.setRoute("progress"), true
    if (key.ctrl && key.name === "o") return openToday(), true
    if (key.ctrl && key.name === "r") {
      const p = resume()
      if (p) app.openChapter(p, p.verse)
      return true
    }
    if (key.ctrl && key.name === "t") return openTranslations(app), true
    // with nothing typed, ? is help rather than a question mark in the box
    if (key.sequence === "?" && !value().trim()) return openHelp(app), true
    if (key.name === "escape" && value()) {
      input?.setText?.("")
      setValue("")
      return true
    }
    return false
  })

  const width = () => Math.min(76, dims().width - 4)
  const goal = () => app.config.goal
  const doneToday = () => (goal().kind === "chapters" ? app.todayTotals().chapters : app.todayTotals().minutes)

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2} flexDirection="column">
        <box flexGrow={1} minHeight={0} />
        <Show when={dims().height >= 24}>
          <Logo />
          <box height={1} />
          <text fg={t().textMuted} wrapMode="none">
            pause, and consider
          </text>
          <box height={1} minHeight={0} flexShrink={1} />
        </Show>

        {/* verse of the day, dropped first when the terminal is short */}
        <Show when={dims().height >= 34}>
        <box width={width()} flexDirection="column" paddingTop={1} flexShrink={0}>
          <box {...LeftBar} borderColor={t().accent} paddingLeft={2} paddingRight={2} backgroundColor={t().backgroundPanel} flexDirection="column" paddingTop={1} paddingBottom={1}>
            <text wrapMode="word">
              <VerseText text={votd().text} fade={fade()} />
            </text>
            <box flexDirection="row" justifyContent="space-between" paddingTop={1}>
              <text fg={t().accent} wrapMode="none">
                {app.ip("quote")}verse of the day
              </text>
              <text fg={t().textMuted} wrapMode="none">
                {formatRef(votd().ref)} · {app.translation()}
              </text>
            </box>
          </box>
        </box>
        </Show>

        {/* prompt */}
        <box width={width()} paddingTop={1} flexShrink={0}>
          <box {...LeftBar} borderColor={t().primary} backgroundColor={t().backgroundElement} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column">
            <input
              ref={(r: InputRenderable) => (input = r)}
              placeholder={`Go to a passage or search…  ${placeholder}`}
              placeholderColor={t().textMuted}
              textColor={t().text}
              focusedTextColor={t().text}
              backgroundColor={t().backgroundElement}
              focusedBackgroundColor={t().backgroundElement}
              cursorColor={t().primary}
              onInput={(v: string) => setValue(v)}
              onSubmit={((v: unknown) => submit(typeof v === "string" ? v : value())) as never}
            />
            <box flexDirection="row" justifyContent="space-between" paddingTop={1}>
              <text wrapMode="none">
                <span style={{ fg: t().primary, attributes: TextAttributes.BOLD }}>{app.translation()}</span>
                <span style={{ fg: t().textMuted }}> {app.installed().find((x) => x.id === app.translation())?.name ?? ""}</span>
              </text>
              <text wrapMode="none" fg={t().textMuted}>
                <Show when={value().trim()} fallback={resume() ? `press enter to resume ${formatRef(resume()!)}` : "press enter to start at John 1"}>
                  {parsed() ? `press enter to go to ${formatRef(parsed()!)}` : `press enter to search for "${value().trim()}"`}
                </Show>
              </text>
            </box>
          </box>
        </box>

        {/* today + continue */}
        <box width={width()} flexDirection="row" gap={2} paddingTop={1} flexShrink={0}>
          <box flexGrow={1} flexBasis={0} backgroundColor={t().backgroundPanel} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column">
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().text} attributes={TextAttributes.BOLD}>
                {app.ip("goal")}Today
              </text>
              <text wrapMode="none">
                <span style={{ fg: app.streak() > 0 ? t().warning : t().textMuted }}>
                  {app.i("streak")} {app.streak()}
                </span>
                <span style={{ fg: t().textMuted }}> day streak</span>
              </text>
            </box>
            <box paddingTop={1} flexDirection="row" gap={1}>
              <Bar fraction={doneToday() / goal().amount} width={Math.max(8, Math.floor(width() / 2) - 18)} color={doneToday() >= goal().amount ? t().success : t().primary} />
              <text fg={t().textMuted} wrapMode="none">
                {goal().kind === "chapters" ? `${doneToday()}/${goal().amount} ch` : `${Math.floor(doneToday())}/${goal().amount} min`}
              </text>
            </box>
            <box paddingTop={1}>
              <Show
                when={plan()}
                fallback={
                  <text fg={t().textMuted} wrapMode="word">
                    No reading plan. <span style={{ fg: t().text }}>ctrl+o</span> to pick one.
                  </text>
                }
              >
                <text wrapMode="word">
                  <span style={{ fg: t().textMuted }}>
                    {plan()!.def.name} · day {plan()!.status.dayNumber}
                    {"\n"}
                  </span>
                  <span style={{ fg: plan()!.status.todayDone ? t().success : t().text }}>
                    {plan()!.status.finished ? "Plan complete" : portionLabel(plan()!.status.next.chapters)}
                  </span>
                  <Show when={plan()!.status.behind > 0}>
                    <span style={{ fg: t().warning }}>  {plan()!.status.behind} behind</span>
                  </Show>
                  <Show when={plan()!.status.ahead > 0}>
                    <span style={{ fg: t().success }}>  {plan()!.status.ahead} ahead</span>
                  </Show>
                </text>
              </Show>
            </box>
          </box>
          <box flexGrow={1} flexBasis={0} backgroundColor={t().backgroundPanel} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column">
            <text fg={t().text} attributes={TextAttributes.BOLD}>
              {app.ip("history")}Continue
            </text>
            <box paddingTop={1} flexDirection="column">
              <Show when={recent().length} fallback={<text fg={t().textMuted}>Nothing read yet. Press enter to begin.</text>}>
                <For each={recent()}>
                  {(r) => (
                    <box flexDirection="row" justifyContent="space-between" onMouseUp={() => app.openChapter(r)}>
                      <text fg={t().text} wrapMode="none">
                        {fit(formatRef(r), 20)}
                      </text>
                      <text fg={app.deps.store.readOn(r.book, r.chapter, app.today()) ? t().success : t().textMuted} wrapMode="none">
                        {app.deps.store.isRead(r.book, r.chapter) ? "✓" : "○"}
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </box>
          </box>
        </box>
        <box flexGrow={1} minHeight={0} />
      </box>
      <Footer
        mode="HOME"
        icon="home"
        hints={[
          { key: "enter", label: "open" },
          { key: "?", label: "help" },
          { key: "ctrl+p", label: "commands" },
          { key: "ctrl+c", label: "quit" },
          { key: "ctrl+o", label: "today's reading" },
          { key: "ctrl+s", label: "progress" },
        ]}
        reserve={dims().width < 100 ? 22 : 40}
        right={
          <text wrapMode="none" fg={t().textMuted}>
            {dims().width < 100
              ? `${app.progress().total.read}/1189 ch read`
              : `${formatMinutes(app.deps.store.totalActiveMs() / 60_000)} read · ${app.progress().total.read} of 1189 chapters`}
          </text>
        }
      />
    </box>
  )
}

export function portionLabel(chapters: { book: number; chapter: number }[]): string {
  if (!chapters.length) return ""
  const groups: { book: number; from: number; to: number }[] = []
  for (const c of chapters) {
    const last = groups.at(-1)
    if (last && last.book === c.book && last.to === c.chapter - 1) last.to = c.chapter
    else groups.push({ book: c.book, from: c.chapter, to: c.chapter })
  }
  return groups
    .map((g) => {
      const name = formatRef({ book: g.book, chapter: g.from }, { short: true }).replace(/ \d+$/, "")
      return g.from === g.to ? `${name} ${g.from}` : `${name} ${g.from}–${g.to}`
    })
    .join(", ")
}
