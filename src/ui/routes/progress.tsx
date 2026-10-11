import { TextAttributes, type RGBA, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createContext, createMemo, For, Show, useContext, type JSX } from "solid-js"
import { BOOKS } from "../../data/books"
import { addDays, daysBetween, monthName, parseDay, prettyDay } from "../../data/dates"
import { consistency, formatMinutes, heatmap, lastDays, met, verdict } from "../../data/stats"
import { Bar, Footer, LeftBar, LineBar, ROUNDED, fit } from "../components/primitives"
import { openGoal, openPalette, openPlans, openToday } from "../dialogs"
import { ease } from "../motion"
import { useApp } from "../state"

/**
 * 0 → 1 as the screen opens: numbers count up, bars fill and the heatmap is drawn column by
 * column. Under reduced motion it is 1 from the start.
 */
const Intro = createContext<() => number>(() => 1)
const useIntro = () => useContext(Intro)

/** Counts an integer up with the intro. */
const countUp = (n: number, p: number) => String(Math.round(n * p))
import { portionLabel } from "./home"

export function Progress() {
  const app = useApp()
  const opening = app.motion.start(900)
  const intro = () => app.motion.progress(opening, ease.outExpo)
  const dims = useTerminalDimensions()
  const t = () => app.theme()
  let scroll: ScrollBoxRenderable | undefined

  const width = () => Math.min(118, dims().width - 4)
  const goal = () => app.config.goal
  const c7 = createMemo(() => consistency(app.totals(), goal(), app.today(), 7, app.since()))
  const c30 = app.consistency30
  const c365 = createMemo(() => consistency(app.totals(), goal(), app.today(), 365, app.since()))
  const v = createMemo(() => verdict(c30(), app.tracked()))
  const window30 = () => Math.min(30, Math.max(1, app.tracked()))
  const toneColor = (tone: string) =>
    tone === "success" ? t().success : tone === "warning" ? t().warning : tone === "error" ? t().error : t().primary

  const week = createMemo(() => lastDays(app.totals(), app.today(), 7))
  const weekChapters = () => week().reduce((s, d) => s + d.chapters, 0)
  const weekMinutes = () => week().reduce((s, d) => s + d.minutes, 0)
  const daysWithReading = createMemo(() => [...app.totals().values()].filter((d) => d.chapters > 0 || d.minutes >= 1).length)
  const firstDay = app.since

  // Which weekdays the reader actually reads on, over the last 12 weeks.
  const rhythm = createMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0]
    for (let i = 0; i < 84; i++) {
      const day = addDays(app.today(), -i)
      if (met(app.totals().get(day), goal())) counts[parseDay(day).getDay()]!++
    }
    return counts
  })

  const insight = createMemo(() => {
    const met30 = Math.round(c30() * window30())
    const r = rhythm()
    const names = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"]
    const best = r.indexOf(Math.max(...r))
    const worst = r.indexOf(Math.min(...r))
    const parts = [
      window30() === 1
        ? met30
          ? "You met your goal on your first day."
          : "Your first day is today."
        : window30() < 30
          ? `You met your goal on ${met30} of the ${window30()} days since you started.`
          : `You met your goal on ${met30} of the last 30 days.`,
    ]
    // A weekday pattern needs a few weeks of history before it means anything.
    if (app.tracked() >= 21 && Math.max(...r) > 0 && best !== worst) parts.push(`You read most on ${names[best]} and least on ${names[worst]}.`)
    const trend = app.tracked() >= 14 ? c7() - c30() : 0
    if (Math.abs(trend) >= 0.15) parts.push(trend > 0 ? "This week is ahead of your monthly pace." : "This week is behind your monthly pace.")
    if (app.streak() > 0 && app.streak() === app.longest()) parts.push("You are on your longest streak ever.")
    return parts.join(" ")
  })

  app.useKeys((key) => {
    if (key.ctrl && key.name === "p") return openPalette(app), true
    if (key.name === "j" || key.name === "down") return scroll?.scrollBy(2), true
    if (key.name === "k" || key.name === "up") return scroll?.scrollBy(-2), true
    if (key.name === "space" || key.name === "pagedown") return scroll?.scrollBy(Math.floor(dims().height / 2)), true
    if (key.name === "pageup") return scroll?.scrollBy(-Math.floor(dims().height / 2)), true
    if (key.name === "g" && key.sequence !== "G") return scroll?.scrollTo(0), true
    // ctrl+o is today's reading everywhere; o here chooses the plan
    if (key.ctrl && key.name === "o") return openToday(app), true
    if (key.name === "o") return openPlans(app), true
    if (key.name === "e") return openGoal(app), true
    if (key.name === "escape" || key.name === "s") return app.setRoute(app.deps.store.position() ? "reader" : "home"), true
    if (key.name === "q") return app.deps.quit(), true
    return false
  })

  return (
    <Intro.Provider value={intro}>
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" height={1} flexShrink={0} backgroundColor={t().backgroundPanel} justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text wrapMode="none">
          <span style={{ fg: t().primary }}>{app.ip("stats")}</span>
          <span style={{ fg: t().text, attributes: TextAttributes.BOLD }}>Progress</span>
          <span style={{ fg: t().textMuted }}>
            {"  ·  "}goal {goal().amount} {goal().kind === "chapters" ? (goal().amount === 1 ? "chapter" : "chapters") : "minutes"} a day
          </span>
        </text>
        <text wrapMode="none" fg={t().textMuted}>
          {firstDay() ? `tracking since ${prettyDay(firstDay()!)}` : "no reading recorded yet"}
        </text>
      </box>
      <scrollbox ref={(r: ScrollBoxRenderable) => (scroll = r)} flexGrow={1} scrollbarOptions={{ visible: false }} contentOptions={{ alignItems: "center" }}>
        <box width={width()} flexDirection="column" paddingTop={1} paddingBottom={1} gap={1}>
          {/* verdict */}
          <box {...LeftBar} borderColor={toneColor(v().tone)} backgroundColor={t().backgroundPanel} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column">
            <text wrapMode="none">
              <span style={{ fg: toneColor(v().tone), attributes: TextAttributes.BOLD }}>{v().label}</span>
              <span style={{ fg: t().textMuted }}>
                {"   "}
                {Math.round(c30() * 100)}% of {window30() < 30 ? `the ${window30()} ${window30() === 1 ? "day" : "days"} so far` : "the last 30 days"}
              </span>
            </text>
            <text fg={t().text} wrapMode="word">
              {daysWithReading() ? insight() : "Read a chapter to start your record. Selah counts a chapter once you reach its end and have spent real time on it, or when you press m."}
            </text>
          </box>

          {/* stat cards */}
          <box flexDirection="row" gap={1}>
            <Stat icon="streak" label="Current streak" value={countUp(app.streak(), intro())} unit={app.streak() === 1 ? "day" : "days"} color={app.streak() ? t().warning : t().textMuted} note={app.streak() && !met(app.totals().get(app.today()), goal()) ? "read today to keep it" : app.streak() ? "goal met today" : "starts with today"} />
            <Stat icon="trophy" label="Longest streak" value={countUp(app.longest(), intro())} unit={app.longest() === 1 ? "day" : "days"} color={t().text} note={app.longest() && app.streak() === app.longest() ? "this is it" : " "} />
            <Stat icon="plan" label="This week" value={countUp(weekChapters(), intro())} unit="ch" color={t().text} note={`${formatMinutes(weekMinutes())} · ${Math.round(c7() * Math.min(7, Math.max(1, app.tracked())))}/${Math.min(7, Math.max(1, app.tracked()))} days`} />
            <Stat icon="goal" label="Consistency" value={countUp(c30() * 100, intro())} unit="%" color={toneColor(v().tone)} note={`${app.tracked() < 365 ? "all time" : "year"} ${Math.round(c365() * 100)}%`} />
            <Stat icon="book" label="Bible read" value={(app.progress().total.fraction * 100 * intro()).toFixed(1)} unit="%" color={t().primary} note={`${app.progress().total.read} of 1189 ch`} />
            <Stat icon="clock" label="Time reading" value={formatMinutes(app.deps.store.totalActiveMs() / 60_000)} unit="" color={t().text} note={`${daysWithReading()} ${daysWithReading() === 1 ? "day" : "days"}`} />
          </box>

          <Card title="Consistency" right={<Legend />}>
            <Heatmap width={width() - 6} />
          </Card>

          <box flexDirection="row" gap={1}>
            <Card title="Last 30 days" right={<text fg={t().textMuted}>chapters per day</text>} grow>
              <Bars width={Math.floor((width() - 2) * 0.6) - 6} />
            </Card>
            <Card title="Rhythm" right={<text fg={t().textMuted}>last 12 weeks</text>} grow>
              <Rhythm counts={rhythm()} />
            </Card>
          </box>

          <PlanCard />

          <Card title="Books" right={<text fg={t().textMuted}>{app.progress().booksFinished} books finished  ·  {app.progress().ot.read}/929 OT  ·  {app.progress().nt.read}/260 NT</text>}>
            <BookGrid width={width() - 6} />
          </Card>
        </box>
      </scrollbox>
      <Footer
        mode="STATS"
        icon="stats"
        hints={[
          { key: "j/k", label: "scroll" },
          { key: "e", label: "edit goal" },
          { key: "o", label: "reading plan" },
          { key: "esc", label: "back" },
        ]}
      />
    </box>
    </Intro.Provider>
  )
}

function Card(props: { title: string; right?: JSX.Element; children: JSX.Element; grow?: boolean }) {
  const app = useApp()
  const t = () => app.theme()
  return (
    <box
      border
      customBorderChars={ROUNDED}
      borderColor={t().borderSubtle}
      title={` ${props.title} `}
      titleColor={t().text}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={0}
      flexDirection="column"
      flexGrow={props.grow ? 1 : 0}
      flexBasis={props.grow ? 0 : "auto"}
    >
      <Show when={props.right}>
        <box flexDirection="row" justifyContent="flex-end" height={1}>
          {props.right}
        </box>
      </Show>
      {props.children}
    </box>
  )
}

function Stat(props: { icon: import("../icons").IconName; label: string; value: string; unit: string; color: RGBA; note: string }) {
  const app = useApp()
  const t = () => app.theme()
  return (
    <box flexGrow={1} flexBasis={0} backgroundColor={t().backgroundPanel} paddingLeft={2} paddingRight={1} paddingTop={1} paddingBottom={1} flexDirection="column">
      <text fg={t().textMuted} wrapMode="none">
        <span style={{ fg: props.color }}>{app.ip(props.icon)}</span>
        {props.label}
      </text>
      <text wrapMode="none">
        <span style={{ fg: props.color, attributes: TextAttributes.BOLD }}>{props.value}</span>
        <span style={{ fg: t().textMuted }}> {props.unit}</span>
      </text>
      <text fg={t().textMuted} wrapMode="none">
        {props.note}
      </text>
    </box>
  )
}

function Legend() {
  const app = useApp()
  return (
    <text wrapMode="none">
      <span style={{ fg: app.theme().textMuted }}>less </span>
      <For each={app.theme().heat}>{(c) => <span style={{ fg: c }}>■ </span>}</For>
      <span style={{ fg: app.theme().textMuted }}>more</span>
    </text>
  )
}

const DAY_LABELS = ["   ", "Mon", "   ", "Wed", "   ", "Fri", "   "]

/** GitHub's contribution grid: one column per week, one row per weekday, today in the last column. */
function Heatmap(props: { width: number }) {
  const app = useApp()
  const intro = useIntro()
  const t = () => app.theme()
  const weeks = () => Math.max(8, Math.min(53, Math.floor((props.width - 5) / 2)))
  const grid = createMemo(() => heatmap(app.totals(), app.config.goal, app.today(), weeks()))
  const months = createMemo(() => {
    const chars = Array.from({ length: weeks() * 2 }, () => " ")
    let lastMonth = ""
    grid().weeks.forEach((col, w) => {
      const first = col.find((c) => c)
      if (!first) return
      const m = monthName(first.day)
      if (m !== lastMonth && w <= weeks() - 2) {
        lastMonth = m
        for (let i = 0; i < m.length && w * 2 + i < chars.length; i++) chars[w * 2 + i] = m[i]!
      }
    })
    return chars.join("")
  })
  return (
    <box flexDirection="column">
      <text wrapMode="none" fg={t().textMuted}>
        {"    " + months()}
      </text>
      <For each={[0, 1, 2, 3, 4, 5, 6]}>
        {(d) => (
          <text wrapMode="none">
            <span style={{ fg: t().textMuted }}>{DAY_LABELS[d] + " "}</span>
            <For each={grid().weeks}>
              {(col, w) => {
                const cell = col[d]
                if (!cell) return <span>{"  "}</span>
                // Drawn left to right as the screen opens, like ink filling a ledger. These are
                // getters: a For body runs once, so anything that animates must stay reactive.
                const shown = () => w() / grid().weeks.length <= intro()
                const empty = () => cell.day === app.today() && cell.level === 0
                const fg = () => (!shown() ? t().heat[0] : empty() ? t().primary : t().heat[cell.level])
                return <span style={{ fg: fg() }}>{!shown() ? "· " : empty() ? "□ " : "■ "}</span>
              }}
            </For>
          </text>
        )}
      </For>
    </box>
  )
}

const EIGHTHS = " ▁▂▃▄▅▆▇█"

/** Vertical bars for the last 30 days, with the goal drawn as a dotted line. */
function Bars(props: { width: number }) {
  const app = useApp()
  const intro = useIntro()
  const t = () => app.theme()
  const HEIGHT = 6
  const days = createMemo(() => lastDays(app.totals(), app.today(), Math.max(7, Math.min(30, Math.floor(props.width / 2)))))
  const valueOf = (d: { chapters: number; minutes: number }) => (app.config.goal.kind === "chapters" ? d.chapters : d.minutes)
  const scale = createMemo(() => Math.max(app.config.goal.amount * 2, ...days().map(valueOf), 1))
  const goalRow = () => HEIGHT - Math.round((app.config.goal.amount / scale()) * HEIGHT)
  return (
    <box flexDirection="column">
      <For each={Array.from({ length: HEIGHT }, (_, i) => i)}>
        {(row) => (
          <text wrapMode="none">
            <For each={days()}>
              {(d) => {
                // Getters, not constants: the bars grow with the intro.
                const fromBottom = HEIGHT - 1 - row
                const fill = () => {
                  const eighths = Math.round((valueOf(d) / scale()) * HEIGHT * 8 * intro())
                  return Math.max(0, Math.min(8, eighths - fromBottom * 8))
                }
                const ok = met(d, app.config.goal)
                const onGoal = () => row === goalRow() - 1 && fill() === 0
                return (
                  <span style={{ fg: fill() ? (ok ? t().success : t().primary) : t().borderSubtle }}>
                    {fill() ? EIGHTHS[fill()] + " " : onGoal() ? "┈┈" : "  "}
                  </span>
                )
              }}
            </For>
          </text>
        )}
      </For>
      <text wrapMode="none" fg={t().textMuted}>
        {days()
          .map((d, i) => (i % 7 === days().length % 7 ? fit(String(parseDay(d.day).getDate()), 2) : "  "))
          .join("")}
      </text>
    </box>
  )
}

function Rhythm(props: { counts: number[] }) {
  const app = useApp()
  const intro = useIntro()
  const t = () => app.theme()
  const max = () => Math.max(1, ...props.counts)
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  return (
    <box flexDirection="column">
      <For each={[1, 2, 3, 4, 5, 6, 0]}>
        {(d) => (
          <box flexDirection="row" gap={1}>
            <text fg={t().textMuted} wrapMode="none" width={4}>
              {names[d]}
            </text>
            <Bar fraction={(props.counts[d]! / max()) * intro()} width={14} color={props.counts[d] === max() ? t().success : t().primary} />
            <text fg={t().textMuted} wrapMode="none">
              {` ${props.counts[d]}/12`}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}

function PlanCard() {
  const app = useApp()
  const intro = useIntro()
  const t = () => app.theme()
  const plan = () => app.activePlan()
  return (
    <Card title="Reading plan" right={<text fg={t().textMuted}>o to change</text>}>
      <Show when={plan()} fallback={<text fg={t().textMuted}>No plan yet. Press o to choose one; Selah keeps you honest about whether you are on pace.</text>}>
        {(p: () => NonNullable<ReturnType<typeof plan>>) => (
          <box flexDirection="column">
            <text wrapMode="none">
              <span style={{ fg: t().text, attributes: TextAttributes.BOLD }}>{p().def.name}</span>
              <span style={{ fg: t().textMuted }}>
                {"  ·  "}day {p().status.dayNumber} of {p().def.days}  ·  started {prettyDay(p().startedOn)}
              </span>
            </text>
            <box flexDirection="row" gap={1} paddingTop={1}>
              <Bar fraction={p().status.fraction * intro()} width={40} color={t().primary} />
              <text fg={t().text} wrapMode="none">
                {(p().status.fraction * 100).toFixed(1)}%
              </text>
              <text fg={t().textMuted} wrapMode="none">
                {p().status.completedPortions}/{p().def.days} days done
              </text>
            </box>
            <text wrapMode="word" paddingTop={1}>
              <Show
                when={p().status.behind > 0}
                fallback={
                  <span style={{ fg: t().success }}>
                    {p().status.finished ? "Finished. " : p().status.ahead > 0 ? `${p().status.ahead} days ahead. ` : "On pace. "}
                  </span>
                }
              >
                <span style={{ fg: t().warning }}>{p().status.behind} days behind. </span>
              </Show>
              <span style={{ fg: t().textMuted }}>Next: </span>
              <span style={{ fg: t().text }}>{portionLabel(p().status.next.chapters)}</span>
              <Show when={p().status.projectedFinish && !p().status.finished}>
                <span style={{ fg: t().textMuted }}>
                  {"   "}At this pace you finish {prettyDay(p().status.projectedFinish!)}
                  {(() => {
                    const planned = addDays(p().startedOn, p().def.days - 1)
                    const diff = daysBetween(planned, p().status.projectedFinish!)
                    return diff > 0 ? ` (${diff} days late)` : diff < 0 ? ` (${-diff} days early)` : " (on time)"
                  })()}
                </span>
              </Show>
            </text>
          </box>
        )}
      </Show>
    </Card>
  )
}

function BookGrid(props: { width: number }) {
  const app = useApp()
  const intro = useIntro()
  const t = () => app.theme()
  const colWidth = 26
  const cols = () => Math.max(1, Math.floor(props.width / colWidth))
  const perBook = createMemo(() => new Map(app.progress().books.map((b) => [b.book, b])))
  const rowsOf = (ids: number[]) => {
    const per = Math.ceil(ids.length / cols())
    return Array.from({ length: per }, (_, r) => Array.from({ length: cols() }, (_, c) => ids[c * per + r]).filter((x): x is number => x !== undefined))
  }
  const section = (label: string, ids: number[]) => (
    <box flexDirection="column" paddingBottom={1}>
      <text fg={t().accent} attributes={TextAttributes.BOLD}>
        {label}
      </text>
      <For each={rowsOf(ids)}>
        {(row) => (
          <box flexDirection="row">
            <For each={row}>
              {(id) => {
                const p = () => perBook().get(id)!
                const b = BOOKS[id - 1]!
                return (
                  <box flexDirection="row" width={colWidth} onMouseUp={() => app.openChapter({ book: id, chapter: 1 })}>
                    <text width={8} wrapMode="none" fg={p().fraction === 1 ? t().success : p().read ? t().text : t().textMuted}>
                      {fit(b.short, 7)}
                    </text>
                    <LineBar fraction={p().fraction * intro()} width={10} color={p().fraction === 1 ? t().success : t().primary} />
                    <text wrapMode="none" fg={t().textMuted}>
                      {fit(` ${p().read}/${p().total}`, 7, "right")}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>
        )}
      </For>
    </box>
  )
  return (
    <box flexDirection="column">
      {section("Old Testament", BOOKS.filter((b) => b.testament === "OT").map((b) => b.id))}
      {section("New Testament", BOOKS.filter((b) => b.testament === "NT").map((b) => b.id))}
    </box>
  )
}
