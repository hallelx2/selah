import { RGBA, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { Verse } from "../../data/bible"
import { bookById, BOOKS } from "../../data/books"
import { prettyDay } from "../../data/dates"
import { formatRef } from "../../data/ref"
import { formatMinutes } from "../../data/stats"
import { minimumReadMs } from "../../data/tracker"
import { Footer, LeftBar, LineBar, TRANSPARENT, fit } from "../components/primitives"
import { plain, VerseText } from "../components/verse"
import { openBookmarks, openBooks, openHelp, openNote, openPalette, openSearch, openTranslations } from "../dialogs"
import { ease, mixColor } from "../motion"
import { useApp } from "../state"
import { StudyPane } from "../study"
import { sceneAt } from "../../data/scenes"

/** Job, Psalms, Proverbs, Ecclesiastes, Song of Solomon, Lamentations: set as verse, not prose. */
const POETRY = new Set([18, 19, 20, 21, 22, 25])
const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹"
export const sup = (n: number) => String(n).replace(/\d/g, (d) => SUPERSCRIPT[Number(d)]!)

export function Reader() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const t = () => app.theme()
  const { bible, store, tracker } = app.deps
  let scroll: ScrollBoxRenderable | undefined

  const pos = app.position
  // Book and chapter only change on navigation; a verse move must not invalidate anything
  // keyed on them, or every row of the chapter is rebuilt on each key press.
  const chapter = createMemo(() => ({ book: pos().book, chapter: pos().chapter }), undefined, {
    equals: (a, b) => a.book === b.book && a.chapter === b.chapter,
  })
  const chapterKey = createMemo(() => `${chapter().book}:${chapter().chapter}`)
  const book = createMemo(() => bookById(chapter().book))
  /** Doré's engraving for where the reader is in the chapter, if the chapter has one. */
  const chapterScene = createMemo(() => sceneAt(pos().book, pos().chapter, pos().verse))
  const verses = createMemo(() => bible.chapter(app.translation(), chapter().book, chapter().chapter))
  const parallelVerses = createMemo(() => {
    if (!app.parallel()) return new Map<number, string>()
    return new Map(bible.chapter(app.config.parallel, chapter().book, chapter().chapter).map((v) => [v.verse, v.text]))
  })
  const marks = createMemo(() => {
    app.rev()
    const c = chapter()
    return {
      highlights: store.highlightsIn(c.book, c.chapter),
      bookmarks: store.bookmarksIn(c.book, c.chapter),
      notes: store.notesIn(c.book, c.chapter),
    }
  })
  const lastVerse = () => verses().at(-1)?.verse ?? 1
  const [anchor, setAnchor] = createSignal<number | undefined>()
  const [count, setCount] = createSignal("")
  const [tick, setTick] = createSignal(0)

  // Each chapter's text rises out of the page instead of snapping in.
  const [fadeAnim, setFadeAnim] = createSignal(app.motion.start(0))
  const fade = () => app.motion.progress(fadeAnim(), ease.outCubic)
  const focus = app.focus
  const prose = () => app.config.prose && !app.parallel()
  /** In focus mode every verse but the cursor's recedes toward the background. */
  const dim = (verse: number) => (focus() && verse !== pos().verse ? 0.3 : 1)
  const page = () => (t().background.a === 0 ? t().backgroundPanel : t().background)

  // Prose mode groups verses into paragraphs at sentence ends; poetry stays one verse a line.
  const paragraphs = createMemo(() => {
    const poetry = POETRY.has(chapter().book)
    const out: Verse[][] = []
    let cur: Verse[] = []
    let chars = 0
    for (const v of verses()) {
      cur.push(v)
      chars += v.text.length
      const sentenceEnd = /[.?!:;’”'")\]]\s*$/.test(v.text)
      if (poetry || (chars > 380 && sentenceEnd) || chars > 900) {
        out.push(cur)
        cur = []
        chars = 0
      }
    }
    if (cur.length) out.push(cur)
    return out
  })
  const paragraphOf = createMemo(() => {
    const m = new Map<number, number>()
    paragraphs().forEach((p, i) => p.forEach((v) => m.set(v.verse, i)))
    return m
  })

  // Track reading per chapter (and per translation switch, which keeps the same session).
  createEffect(
    on([chapterKey, app.translation], () => {
      // Never track a chapter with no text: there is nothing to read, so nothing to credit.
      if (!verses().length) return tracker.close()
      const words = app.words().get(chapterKey()) ?? 0
      tracker.open({ book: pos().book, chapter: pos().chapter, translation: app.translation(), words })
      setAnchor(undefined)
      setFadeAnim(app.motion.start(320))
      scrollToCursorSoon(true)
    }),
  )
  onCleanup(() => tracker.close())

  const timer = setInterval(() => {
    setTick((n) => n + 1)
    checkEnd()
  }, 1000)
  onCleanup(() => clearInterval(timer))

  function checkEnd() {
    if (!scroll || scroll.isDestroyed) return
    const bottom = scroll.scrollTop + scroll.viewport.height >= scroll.scrollHeight - 1
    if (bottom || pos().verse >= lastVerse()) tracker.reachedEnd()
  }

  /** Where the cursor verse sits in the scroll content. In prose it is estimated within its paragraph. */
  function cursorSpan(): { top: number; bottom: number } | undefined {
    if (!scroll) return
    const v = pos().verse
    if (!prose()) {
      const el = scroll.content.findDescendantById(`v-${v}`)
      if (!el) return
      const top = el.y - scroll.content.y
      return { top, bottom: top + el.height }
    }
    const i = paragraphOf().get(v)
    if (i === undefined) return
    const el = scroll.content.findDescendantById(`p-${i}`)
    if (!el) return
    const para = paragraphs()[i]!
    const size = (x: Verse) => x.text.length + 4
    const total = para.reduce((s, x) => s + size(x), 0)
    const before = para.filter((x) => x.verse < v).reduce((s, x) => s + size(x), 0)
    const own = size(para.find((x) => x.verse === v) ?? para[0]!)
    // A paragraph that has not been laid out yet reports a height of one line. Trusting that
    // would scroll to the wrong place and drop the pending scroll; wait for the real layout.
    const minLines = Math.floor((0.6 * total) / Math.max(20, measure() - 9))
    if (el.height < Math.max(1, minLines)) return
    const top = el.y - scroll.content.y + Math.floor((el.height * before) / total)
    return { top, bottom: top + Math.max(1, Math.ceil((el.height * own) / total)) }
  }

  /**
   * Keeps the cursor verse in view with a vim-style margin. On opening a chapter the target
   * verse is placed a third of the way down, so the verses before it give context.
   */
  function scrollToCursor(open = false): boolean {
    if (!scroll || scroll.isDestroyed) return true
    if (open && pos().verse <= 1) return scroll.scrollTo(0), true
    const span = cursorSpan()
    // Not laid out yet (a layout switch or a new chapter): the caller retries next frame.
    if (!span || span.bottom <= span.top) return false
    const h = scroll.viewport.height
    const { top, bottom } = span
    const margin = Math.min(4, Math.floor(h / 5))
    if (open) return scroll.scrollTo(Math.max(0, top - Math.floor(h / 3))), true
    if (top < scroll.scrollTop + margin) scroll.scrollTo(Math.max(0, top - margin))
    else if (bottom > scroll.scrollTop + h - margin) scroll.scrollTo(bottom - h + margin)
    return true
  }

  /**
   * Scrolls to the cursor as soon as the layout can say where it is. If it cannot yet (a new
   * chapter or a layout switch), the scroll waits and runs when the content is laid out.
   */
  let pending: boolean | undefined
  let retries = 0
  function scrollToCursorSoon(open = false) {
    pending = (pending ?? false) || open
    retries = 12
    setTimeout(runPending, 0)
  }
  /**
   * Runs on a timer and on every layout change of the content. The layout hook covers the
   * test renderer and big relayouts; the bounded frame retries cover a paragraph that settles
   * without the outer box changing size.
   */
  function runPending() {
    if (pending === undefined) return
    if (scrollToCursor(pending)) {
      pending = undefined
      checkEnd()
    } else if (retries-- > 0) setTimeout(runPending, 16)
  }

  createEffect(
    on(
      () => pos().verse,
      () => scrollToCursorSoon(),
    ),
  )

  const move = (delta: number) => app.setVerse(Math.max(1, Math.min(lastVerse(), pos().verse + delta)))

  const pageSize = () => {
    const h = scroll?.viewport.height ?? dims().height - 4
    const chars = verses().reduce((s, v) => s + v.text.length, 0) / Math.max(1, verses().length)
    const lines = Math.max(1, Math.ceil(chars / Math.max(20, measure() - 8)))
    return Math.max(2, Math.floor(h / (lines + 0.4)))
  }

  const selection = () => {
    const a = anchor()
    const v = pos().verse
    if (a === undefined) return { start: v, end: v }
    return { start: Math.min(a, v), end: Math.max(a, v) }
  }

  function copySelection() {
    const { start, end } = selection()
    const lines = verses().filter((v) => v.verse >= start && v.verse <= end)
    const ref = formatRef({ book: pos().book, chapter: pos().chapter, verseStart: start, verseEnd: end })
    const text =
      lines.length === 1
        ? `"${plain(lines[0]!.text)}" (${ref}, ${app.translation()})`
        : `${ref} (${app.translation()})\n${lines.map((v) => `${v.verse} ${plain(v.text)}`).join("\n")}`
    const ok = app.deps.copy(text)
    app.toast(ok ? `Copied ${ref}` : "Clipboard not available", ok ? undefined : "Your terminal does not support OSC 52", ok ? "info" : "warning")
    setAnchor(undefined)
  }

  app.useKeys((key) => {
    // The study pane has the keyboard; it handles its own keys (and credits the activity).
    if (app.studyFocused()) return false
    tracker.activity()
    const k = key.name
    const ctrl = key.ctrl
    if (/^[0-9]$/.test(k) && !ctrl && !key.meta) {
      setCount((c) => (c + k).slice(-3))
      return true
    }
    if (k === "return" && count()) {
      app.setVerse(Math.min(lastVerse(), Number(count())))
      setCount("")
      return true
    }
    const n = Number(count()) || 1
    const counted = count() ? Number(count()) : undefined
    if (count()) setCount("")
    if (k === "tab" && !ctrl) {
      app.setStudyOpen(true)
      app.setStudyFocused(true)
      return true
    }
    if (ctrl && k === "l") {
      const open = !app.studyOpen()
      app.setStudyOpen(open)
      app.setStudyFocused(open)
      return true
    }
    if (ctrl && k === "p") return openPalette(app), true
    if (ctrl && k === "b") {
      // closed: open it with the keyboard in it; open: take the keyboard; in it: close it.
      // Where it cannot be drawn (too narrow, focus mode) it is a plain on/off switch.
      if (!sidebar()) {
        const on = !app.config.sidebar
        app.setConfig("sidebar", on)
        if (on && focus()) app.toast("Sidebar on", "it shows when you leave focus mode (z)")
        else if (on && dims().width < SIDEBAR_MIN) app.toast(`The sidebar needs ${SIDEBAR_MIN} columns`, "o opens the books and chapters at any width")
        else if (on) setSidebarFocused(true)
        else app.toast("Sidebar off")
      } else if (sidebarFocused()) {
        setSidebarFocused(false)
        app.setConfig("sidebar", false)
      } else setSidebarFocused(true)
      return true
    }
    if (ctrl && k === "d") return move(Math.ceil(pageSize() / 2)), true
    if (ctrl && k === "u") return move(-Math.ceil(pageSize() / 2)), true
    if (ctrl) return false
    switch (key.sequence === "G" ? "G" : key.sequence === "T" ? "T" : key.sequence === "B" ? "B" : key.sequence === "?" ? "?" : k) {
      case "j":
      case "down":
        return move(n), true
      case "k":
      case "up":
        return move(-n), true
      case "space":
      case "pagedown":
        return move(pageSize()), true
      case "pageup":
        return move(-pageSize()), true
      case "g":
      case "home":
        return app.setVerse(counted ? Math.min(lastVerse(), counted) : 1), true
      case "G":
      case "end":
        // vim: 5G goes to line 5, G alone to the end
        return app.setVerse(counted ? Math.min(lastVerse(), counted) : lastVerse()), true
      case "n":
      case "l":
      case "right":
      case "]":
        return app.next(), true
      case "p":
      case "left":
      case "[":
        return app.prev(), true
      case "b":
        store.toggleBookmark({ ...pos() })
          ? app.toast(`${app.ip("bookmark")}Bookmarked ${formatRef({ ...pos(), verseStart: pos().verse })}`)
          : app.toast("Bookmark removed")
        app.bump()
        return true
      case "h":
        store.cycleHighlight({ ...pos() })
        app.bump()
        return true
      case "a":
        return openNote(app, { ...pos() }), true
      case "i": {
        const plate = sceneAt(pos().book, pos().chapter, pos().verse)
        if (!plate) return app.toast(`No Doré engraving for ${book().name} ${pos().chapter}`, "ctrl+p, then Doré gallery, shows all 100"), true
        return app.openScene(plate), true
      }
      case "v":
        setAnchor((a) => (a === undefined ? pos().verse : undefined))
        return true
      case "y":
        return copySelection(), true
      case "m":
        return app.markRead(), true
      case "t":
        return openTranslations(app), true
      case "T":
        return app.toggleParallel(), true
      case "o":
        return openBooks(app), true
      case "B":
        return openBookmarks(app), true
      case "/":
        return openSearch(app), true
      case "s":
        return app.setRoute("progress"), true
      case "?":
        return openHelp(app), true
      case "z":
        app.setFocus(!focus())
        return true
      case "-":
      case "=": {
        // Narrow or widen the reading column; persisted.
        const next = Math.max(48, Math.min(160, app.config.measure + (k === "=" ? 8 : -8)))
        app.setConfig("measure", next)
        app.toast(`Reading width ${next} columns`, "- and = to adjust")
        return true
      }
      case "w":
        if (app.parallel()) {
          app.toast("Prose is off in parallel view", "Verses stay aligned side by side. T closes parallel.", "warning")
          return true
        }
        app.setConfig("prose", !app.config.prose)
        app.toast(app.config.prose ? "Prose: verses flow as paragraphs" : "Verses: one per line", "w to switch back")
        scrollToCursorSoon(true)
        return true
      case "escape":
        if (focus()) return app.setFocus(false), true
        if (anchor() !== undefined) return setAnchor(undefined), true
        return app.setRoute("home"), true
      case "q":
        return app.deps.quit(), true
    }
    return false
  })

  const sidebar = () => app.config.sidebar && dims().width >= SIDEBAR_MIN && !focus()
  const [sidebarFocused, setSidebarFocused] = createSignal(false)
  // the keyboard cannot stay in a sidebar that is not drawn
  createEffect(() => sidebarFocused() && (!sidebar() || app.studyFocused()) && setSidebarFocused(false))
  /** The study pane sits beside the text when there is room, and floats over it when not. */
  const studySplit = () => app.studyOpen() && !focus() && dims().width >= 120
  const studyOverlay = () => app.studyOpen() && !focus() && dims().width < 120
  const studyWidth = () => Math.max(40, Math.min(app.config.studyWidth, dims().width - 40))
  const measure = () => {
    const room = dims().width - (sidebar() ? 32 : 0) - (studySplit() ? studyWidth() : 0) - 4
    // At the study desk the text fills its side of the screen; on its own it keeps a book's
    // measure, centred (- and = adjust it).
    if (studySplit()) return room
    return app.parallel() ? Math.min(room, app.config.measure * 2 + 4) : Math.min(room, app.config.measure)
  }

  // live reading status for the header
  const status = createMemo(() => {
    tick()
    app.rev()
    const day = app.readDay()
    const readToday = store.readOn(pos().book, pos().chapter, day)
    const required = minimumReadMs(app.words().get(chapterKey()) ?? 0)
    return { readToday, day, active: tracker.activeMs, required, reachedEnd: !!tracker.active?.reachedEnd, everRead: store.isRead(pos().book, pos().chapter) }
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <Show when={!app.config.welcomed}>
        <Welcome />
      </Show>
      <Show when={!focus()}>
        <box flexDirection="row" height={1} flexShrink={0} backgroundColor={t().backgroundPanel} justifyContent="space-between" paddingLeft={1} paddingRight={1}>
          <text wrapMode="none">
            <span style={{ fg: t().primary }}>{app.ip("book")}</span>
            <span style={{ fg: t().text, attributes: TextAttributes.BOLD }}>
              {book().name} {pos().chapter}
            </span>
            <span style={{ fg: t().textMuted }}>  ·  {app.translation()}</span>
            <Show when={app.parallel()}>
              <span style={{ fg: t().textMuted }}> ⇄ {app.config.parallel}</span>
            </Show>
            <Show when={chapterScene()}>
              <span style={{ fg: t().textMuted }}>{"  ·  "}</span>
              <span style={{ fg: t().accent }}>
                {app.ip("star")}
                {dims().width >= 130 ? chapterScene()!.title : "scene"}
              </span>
              <span style={{ fg: t().textMuted }}> i</span>
            </Show>
          </text>
          <box flexDirection="row" gap={2}>
            <text wrapMode="none" fg={t().textMuted}>
              verse {pos().verse}/{lastVerse()}
            </text>
            <LineBar fraction={pos().verse / lastVerse()} width={Math.max(6, Math.min(20, dims().width - 70))} />
            <Show
              when={status().readToday}
              fallback={
                <text wrapMode="none">
                  {/* a countdown says what the time is for; once the time is in, what is left is the end */}
                  <Show
                    when={status().active < status().required}
                    fallback={
                      <span style={{ fg: t().textMuted }}>
                        {app.i("reading")} {dims().width >= 100 ? "read to the end to count it" : "read to the end"}
                      </span>
                    }
                  >
                    <span style={{ fg: t().textMuted }}>{app.i("reading")} </span>
                    <span style={{ fg: t().text }}>{formatMinutes((status().required - status().active) / 60_000)}</span>
                    <span style={{ fg: t().textMuted }}>{dims().width >= 100 ? (status().reachedEnd ? " more and it counts" : " more to count as read") : " to count"}</span>
                  </Show>
                </text>
              }
            >
              <text wrapMode="none" fg={t().success}>
                {app.icons() === "nerd" ? `${app.i("check")} ` : "● "}
                {status().day === app.today() ? "read today" : `read · ${prettyDay(status().day)}`}
              </text>
            </Show>
          </box>
        </box>
        <ReadingMeter
          fraction={status().required ? Math.min(1, status().active / status().required) : 0}
          done={status().readToday}
          book={pos().book}
          chapter={pos().chapter}
        />
      </Show>

      <box flexDirection="row" flexGrow={1}>
        <Show when={sidebar()}>
          <Sidebar focused={sidebarFocused()} setFocused={setSidebarFocused} />
        </Show>
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (scroll = r)}
          flexGrow={1}
          scrollbarOptions={{ visible: false }}
          contentOptions={{ alignItems: "center" }}
          onMouseScroll={() => {
            tracker.activity()
            checkEnd()
          }}
        >
          <box width={measure()} flexDirection="column" paddingTop={focus() ? 2 : 1} paddingBottom={2} onSizeChange={runPending}>
            <ChapterTitle
              name={book().name}
              chapter={pos().chapter}
              verses={verses().length}
              words={app.words().get(chapterKey()) ?? 0}
              readBefore={status().everRead && !status().readToday}
              fade={fade() * (focus() ? 0.5 : 1)}
              wide={measure() >= 52}
            />
            <Show when={app.parallel()}>
              <box flexDirection="row" paddingLeft={7} gap={3} paddingBottom={1}>
                <text flexGrow={1} flexBasis={0} fg={t().accent} attributes={TextAttributes.BOLD}>
                  {app.translation()}
                </text>
                <text flexGrow={1} flexBasis={0} fg={t().accent} attributes={TextAttributes.BOLD}>
                  {app.config.parallel}
                </text>
              </box>
            </Show>
            <Show
              when={prose()}
              fallback={
                <For each={verses()}>
                  {(v) => {
                    const cursor = () => v.verse === pos().verse
                    const inSel = () => anchor() !== undefined && v.verse >= selection().start && v.verse <= selection().end
                    const hl = () => marks().highlights.get(v.verse)
                    const bg = () =>
                      inSel() ? t().backgroundElement : hl() ? t().highlight[hl()! - 1]! : cursor() && !focus() ? t().backgroundPanel : TRANSPARENT
                    const f = () => fade() * dim(v.verse)
                    return (
                      <box
                        id={`v-${v.verse}`}
                        flexDirection="row"
                        backgroundColor={bg()}
                        paddingRight={1}
                        onMouseUp={() => {
                          tracker.activity()
                          app.setVerse(v.verse)
                        }}
                      >
                        <text width={2} flexShrink={0} fg={cursor() ? t().primary : TRANSPARENT} selectable={false}>
                          ┃
                        </text>
                        <text
                          width={4}
                          flexShrink={0}
                          fg={cursor() ? t().primary : mixColor(page(), t().textMuted, f())}
                          selectable={false}
                          attributes={cursor() ? TextAttributes.BOLD : 0}
                        >
                          {fit(String(v.verse), 3, "right")}
                        </text>
                        <text width={1} flexShrink={0} selectable={false} fg={marks().bookmarks.has(v.verse) ? t().accent : t().info}>
                          {marks().bookmarks.has(v.verse) ? "◆" : marks().notes.has(v.verse) ? "•" : " "}
                        </text>
                        <box flexDirection="row" flexGrow={1} gap={3} paddingLeft={1}>
                          <text flexGrow={1} flexBasis={0} wrapMode="word">
                            <Show
                              when={v.text}
                              fallback={
                                <span style={{ fg: t().textMuted, attributes: TextAttributes.ITALIC }}>Not in the manuscripts this translation follows.</span>
                              }
                            >
                              <VerseText text={v.text} fade={f()} />
                            </Show>
                          </text>
                          <Show when={app.parallel()}>
                            <text flexGrow={1} flexBasis={0} wrapMode="word">
                              <Show when={parallelVerses().get(v.verse)} fallback={<span style={{ fg: t().textMuted }}>—</span>}>
                                <VerseText text={parallelVerses().get(v.verse)!} fade={f()} />
                              </Show>
                            </text>
                          </Show>
                        </box>
                      </box>
                    )
                  }}
                </For>
              }
            >
              <For each={paragraphs()}>
                {(para, i) => {
                  const poetry = POETRY.has(chapter().book)
                  return (
                    <box
                      id={`p-${i()}`}
                      paddingLeft={poetry ? 9 : 7}
                      paddingRight={2}
                      paddingBottom={poetry ? 0 : 1}
                      onMouseUp={() => {
                        tracker.activity()
                        app.setVerse(para[0]!.verse)
                      }}
                    >
                      <text wrapMode="word">
                        <For each={para}>
                          {(v) => {
                            const cursor = () => v.verse === pos().verse
                            const inSel = () => anchor() !== undefined && v.verse >= selection().start && v.verse <= selection().end
                            const hl = () => marks().highlights.get(v.verse)
                            const bg = () =>
                              inSel() ? t().backgroundElement : hl() ? t().highlight[hl()! - 1]! : cursor() && !focus() ? t().backgroundPanel : undefined
                            const numberColor = () => (cursor() ? t().primary : marks().bookmarks.has(v.verse) ? t().accent : t().textMuted)
                            return (
                              <>
                                <span style={{ fg: numberColor(), bg: bg(), attributes: cursor() ? TextAttributes.BOLD : 0 }}>
                                  {sup(v.verse)}
                                  {marks().notes.has(v.verse) ? "•" : ""}
                                </span>
                                <Show when={v.text} fallback={<span style={{ fg: t().textMuted }}> — </span>}>
                                  <VerseText text={v.text} bg={bg()} fade={fade() * dim(v.verse)} />
                                </Show>
                                <span>{poetry ? "" : " "}</span>
                              </>
                            )
                          }}
                        </For>
                      </text>
                    </box>
                  )
                }}
              </For>
            </Show>
            <box paddingLeft={7} paddingTop={2} flexDirection="column">
              <ChapterEnd />
            </box>
          </box>
        </scrollbox>
        <Show when={studySplit()}>
          <StudyPane />
        </Show>
        <Show when={studyOverlay()}>
          <StudyPane overlay />
        </Show>
      </box>

      <Show
        when={!focus()}
        fallback={
          <box height={1} flexShrink={0} flexDirection="row" justifyContent="flex-end" paddingRight={2}>
            <text fg={t().borderSubtle} wrapMode="none">
              {app.ip("focus")}focus · z to return
            </text>
          </box>
        }
      >
        <Footer
          mode={app.studyFocused() ? "STUDY" : sidebarFocused() ? "BOOKS" : anchor() !== undefined ? "SELECT" : count() ? `:${count()}` : prose() ? "PROSE" : "READ"}
          icon={app.studyFocused() ? "note" : sidebarFocused() ? "library" : anchor() !== undefined ? "copy" : "book"}
          hints={
            app.studyFocused()
              ? [
                  { key: "tab", label: "back to the text" },
                  { key: "1-4", label: "notes · commentary · words · ask" },
                  { key: "ctrl+p", label: "commands" },
                ]
              : sidebarFocused()
              ? [
                  { key: "j/k", label: "move" },
                  { key: "enter", label: "chapters / open" },
                  { key: "esc", label: "back" },
                  { key: "ctrl+b", label: "close" },
                ]
              : anchor() !== undefined
              ? [
                  { key: "j/k", label: "extend" },
                  { key: "y", label: "copy" },
                  { key: "esc", label: "cancel" },
                ]
              : [
                  { key: "j/k", label: "verse" },
                  { key: "n/p", label: "chapter" },
                  { key: "?", label: "help" },
                  { key: "/", label: "search" },
                  { key: "m", label: "mark read" },
                  { key: "tab", label: "study" },
                  { key: "z", label: "focus" },
                  { key: "w", label: prose() ? "verses" : "prose" },
                  { key: "h", label: "highlight" },
                  { key: "b", label: "bookmark" },
                  { key: "ctrl+p", label: "commands" },
                ]
          }
        />
      </Show>
    </box>
  )
}

/**
 * The chapter's opening, set like a printed Bible: a large drop-cap number beside the book
 * name. When the chapter is recorded as read, a beam of light passes over the name.
 */
function ChapterTitle(props: { name: string; chapter: number; verses: number; words: number; readBefore: boolean; fade: number; wide: boolean }) {
  const app = useApp()
  const t = () => app.theme()
  const page = () => (t().background.a === 0 ? t().backgroundPanel : t().background)
  const f = (c: import("@opentui/core").RGBA) => mixColor(page(), c, props.fade)
  const spaced = () => props.name.toUpperCase().split("").join(" ")
  const beam = () => {
    const r = app.lastRead()
    const p = app.position()
    return r && r.book === p.book && r.chapter === p.chapter && !app.motion.done(r.anim) ? r.anim : undefined
  }
  const nameColor = (x: number, width: number) => {
    const b = beam()
    const base = f(t().textMuted)
    if (!b) return base
    const center = -6 + app.motion.progress(b) * (width + 12)
    const light = Math.exp(-((x - center) ** 2) / (2 * 3 ** 2))
    return mixColor(base, t().success, light)
  }
  const minutes = () => Math.max(1, Math.round(props.words / 250))
  return (
    <box flexDirection="row" paddingLeft={7} paddingBottom={1} gap={2}>
      <Show when={props.wide}>
        <ascii_font text={String(props.chapter)} font="block" color={[f(t().primary), f(t().borderSubtle)]} selectable={false} />
      </Show>
      <box flexDirection="column" justifyContent="flex-end" paddingBottom={props.wide ? 1 : 0}>
        <text attributes={TextAttributes.BOLD} wrapMode="none" selectable={false}>
          <For each={Array.from(spaced())}>{(ch, x) => <span style={{ fg: nameColor(x(), spaced().length) }}>{ch}</span>}</For>
        </text>
        <Show when={!props.wide}>
          <text fg={f(t().text)} attributes={TextAttributes.BOLD} wrapMode="none">
            Chapter {props.chapter}
          </text>
        </Show>
        <text fg={f(t().textMuted)} wrapMode="none" selectable={false}>
          {props.verses} verses · {minutes()} min
          <Show when={props.readBefore}>
            <span style={{ fg: f(t().textMuted) }}>  ·  {app.i("check")} read before</span>
          </Show>
        </text>
      </box>
    </box>
  )
}

/**
 * A hairline under the header that fills as real reading time accrues toward this chapter's
 * threshold, so the reader can see the tracker is honest. On the moment the chapter counts,
 * a beam runs along it and it settles in the success colour.
 */
function ReadingMeter(props: { fraction: number; done: boolean; book: number; chapter: number }) {
  const app = useApp()
  const dims = useTerminalDimensions()
  const t = () => app.theme()
  const width = () => dims().width
  const beam = () => {
    const r = app.lastRead()
    return r && r.book === props.book && r.chapter === props.chapter && !app.motion.done(r.anim) ? r.anim : undefined
  }
  const filled = () => (props.done ? width() : Math.round(props.fraction * width()))
  const runs = createMemo(() => {
    const b = beam()
    const fill = props.done ? t().success : t().primary
    if (!b) {
      return [
        { text: "━".repeat(filled()), fg: fill },
        { text: "─".repeat(Math.max(0, width() - filled())), fg: t().borderSubtle },
      ]
    }
    const center = -10 + app.motion.progress(b, ease.inOutSine) * (width() + 20)
    return Array.from({ length: width() }, (_, x) => {
      const light = Math.exp(-((x - center) ** 2) / (2 * 7 ** 2))
      return { text: x < filled() ? "━" : "─", fg: mixColor(x < filled() ? fill : t().borderSubtle, t().text, light * 0.9) }
    })
  })
  return (
    <box height={1} flexShrink={0}>
      <text wrapMode="none" selectable={false}>
        <For each={runs()}>{(r) => <span style={{ fg: r.fg }}>{r.text}</span>}</For>
      </text>
    </box>
  )
}

/** What comes next, at the bottom of every chapter. */
function ChapterEnd() {
  const app = useApp()
  const t = () => app.theme()
  const next = createMemo(() => {
    const p = app.position()
    const b = bookById(p.book)
    if (p.chapter < b.chapters) return `${b.name} ${p.chapter + 1}`
    const nb = BOOKS[p.book]
    return nb ? `${nb.name} 1` : undefined
  })
  return (
    <Show when={next()}>
      <text wrapMode="none">
        <span style={{ fg: t().textMuted }}>Next  </span>
        <span style={{ fg: t().text }}>{next()}</span>
        <span style={{ fg: t().textMuted }}>   press </span>
        <span style={{ fg: t().text }}>n</span>
      </text>
    </Show>
  )
}

/** Books and the chapter grid of the open book, with read status. */
/** The sidebar is drawn only from this width. */
export const SIDEBAR_MIN = 100
/** Chapters per row in the sidebar's grid (28 columns, 4 each). */
const GRID = 7

/**
 * Books with their progress, and a chapter grid. With the keyboard in it (ctrl+b): j/k move
 * through the books, enter shows a book's chapters, h/j/k/l move in the grid, enter opens one,
 * esc steps back out.
 */
/**
 * The first time someone opens the reader: the handful of keys that make it usable, because
 * here letters are shortcuts, not typing. Any key closes it (and does nothing else); it never
 * comes back.
 */
function Welcome() {
  const app = useApp()
  const t = () => app.theme()
  const dims = useTerminalDimensions()
  app.useKeys(() => (app.setConfig("welcomed", true), true), { modal: true, first: true })
  const rows: [string, string][] = [
    ["↑ ↓", "move verse by verse"],
    ["← →", "previous and next chapter"],
    ["o", "go to a book: type romans 8, then enter"],
    ["/", "search the Bible for words"],
    ["tab", "study tools: notes, commentary, Hebrew and Greek, Ask"],
    ["i", "a picture of the passage, when there is one"],
    ["?", "every key"],
    ["esc", "back to the home screen"],
  ]
  return (
    <box position="absolute" left={0} top={0} width={dims().width} height={dims().height} zIndex={2000} alignItems="center" justifyContent="center" backgroundColor={RGBA.fromInts(0, 0, 0, 120)}>
      <box width={Math.min(66, dims().width - 4)} backgroundColor={t().backgroundPanel} paddingLeft={3} paddingRight={3} paddingTop={1} paddingBottom={1} flexDirection="column" gap={1} {...LeftBar} borderColor={t().primary}>
        <text fg={t().text} attributes={TextAttributes.BOLD} wrapMode="word">
          Welcome to the reader
        </text>
        <text fg={t().textMuted} wrapMode="word">
          Here, letters are shortcuts rather than typing. These are the ones to know:
        </text>
        <box flexDirection="column">
          <For each={rows}>
            {([k, d]) => (
              <box flexDirection="row">
                <text width={6} flexShrink={0} fg={t().primary} attributes={TextAttributes.BOLD} wrapMode="none">
                  {k}
                </text>
                <text fg={t().text} wrapMode="word" flexGrow={1}>
                  {d}
                </text>
              </box>
            )}
          </For>
        </box>
        <text fg={t().textMuted} wrapMode="word">
          Press any key to start reading.
        </text>
      </box>
    </box>
  )
}

function Sidebar(props: { focused: boolean; setFocused: (v: boolean) => void }) {
  const app = useApp()
  const t = () => app.theme()
  const [mode, setMode] = createSignal<"books" | "chapters">("books")
  const [cursorBook, setCursorBook] = createSignal(app.position().book)
  const [cursorChapter, setCursorChapter] = createSignal(app.position().chapter)
  // the grid shows the book being browsed, else the one open
  const book = createMemo(() => bookById(props.focused && mode() === "chapters" ? cursorBook() : app.position().book))
  createEffect(
    on(
      () => props.focused,
      (f) => {
        if (!f) return
        setMode("books")
        setCursorBook(app.position().book)
        setCursorChapter(app.position().chapter)
      },
    ),
  )
  // With the keyboard here, other keys do nothing rather than act on the text behind; only
  // quitting, help and search still work from the sidebar.
  const swallow = (key: { name: string; sequence: string }) => !(key.name === "q" || key.sequence === "?" || key.sequence === "/")
  const scrollTo = (id: number) => setTimeout(() => scroll && !scroll.isDestroyed && scroll.scrollChildIntoView(`sb-${id}`), 0)
  app.useKeys((key) => {
    if (!props.focused || key.ctrl || key.meta) return false
    const k = key.sequence === "G" ? "G" : key.name
    if (mode() === "books") {
      const move = (to: number) => (setCursorBook(Math.max(1, Math.min(BOOKS.length, to))), scrollTo(cursorBook()), true)
      if (k === "j" || k === "down") return move(cursorBook() + 1)
      if (k === "k" || k === "up") return move(cursorBook() - 1)
      if (k === "pagedown" || k === "space") return move(cursorBook() + 10)
      if (k === "pageup") return move(cursorBook() - 10)
      if (k === "g" || k === "home") return move(1)
      if (k === "G" || k === "end") return move(BOOKS.length)
      if (k === "return" || k === "l" || k === "right") {
        setCursorChapter(cursorBook() === app.position().book ? app.position().chapter : 1)
        return setMode("chapters"), true
      }
      if (k === "escape" || k === "tab") return props.setFocused(false), true
      return swallow(key)
    }
    const last = bookById(cursorBook()).chapters
    const move = (to: number) => (setCursorChapter(Math.max(1, Math.min(last, to))), true)
    if (k === "l" || k === "right") return move(cursorChapter() + 1)
    if (k === "h" || k === "left") return move(cursorChapter() - 1)
    if (k === "j" || k === "down") return move(cursorChapter() + GRID)
    if (k === "k" || k === "up") return move(cursorChapter() - GRID)
    if (k === "g" || k === "home") return move(1)
    if (k === "G" || k === "end") return move(last)
    if (k === "return") {
      app.openChapter({ book: cursorBook(), chapter: cursorChapter() })
      return props.setFocused(false), true
    }
    if (k === "escape" || k === "backspace") return setMode("books"), true
    if (k === "tab") return props.setFocused(false), true
    return swallow(key)
  })
  const chapters = createMemo(() => Array.from({ length: book().chapters }, (_, i) => i + 1))
  const readSet = createMemo(() => new Set(app.reads().map((r) => `${r.book}:${r.chapter}`)))
  const perBook = createMemo(() => new Map(app.progress().books.map((b) => [b.book, b])))
  let scroll: ScrollBoxRenderable | undefined
  createEffect(
    on(
      () => book().id,
      (id) => setTimeout(() => scroll && !scroll.isDestroyed && scroll.scrollChildIntoView(`sb-${id}`), 0),
    ),
  )
  return (
    <box width={32} flexShrink={0} backgroundColor={t().backgroundPanel} flexDirection="column" paddingTop={1}>
      <box paddingLeft={2} paddingRight={2} flexDirection="column" flexShrink={0}>
        <text fg={t().text} attributes={TextAttributes.BOLD}>
          {app.ip("book")}
          {book().name}
        </text>
        <text fg={t().textMuted}>
          {perBook().get(book().id)?.read ?? 0} of {book().chapters} chapters read
        </text>
        <box flexDirection="row" flexWrap="wrap" paddingTop={1} width={28}>
          <For each={chapters()}>
            {(c) => {
              const current = () => book().id === app.position().book && c === app.position().chapter
              const cursor = () => props.focused && mode() === "chapters" && c === cursorChapter()
              const read = () => readSet().has(`${book().id}:${c}`)
              return (
                <text
                  width={4}
                  fg={cursor() ? t().onPrimary : current() ? t().onPrimary : read() ? t().success : t().textMuted}
                  bg={cursor() ? t().accent : current() ? t().primary : TRANSPARENT}
                  attributes={cursor() ? TextAttributes.BOLD : 0}
                  onMouseUp={() => app.openChapter({ book: book().id, chapter: c })}
                  selectable={false}
                >
                  {fit(String(c), 3, "right") + " "}
                </text>
              )
            }}
          </For>
        </box>
      </box>
      <box paddingLeft={2} paddingTop={1} flexShrink={0}>
        <text fg={t().accent} attributes={TextAttributes.BOLD}>
          {app.ip("library")}Books
        </text>
      </box>
      <scrollbox ref={(r: ScrollBoxRenderable) => (scroll = r)} flexGrow={1} scrollbarOptions={{ visible: false }}>
        <For each={BOOKS}>
          {(b) => {
            const current = () => b.id === app.position().book
            const cursor = () => props.focused && b.id === cursorBook()
            const p = () => perBook().get(b.id)!
            return (
              <box
                id={`sb-${b.id}`}
                flexDirection="row"
                justifyContent="space-between"
                paddingLeft={1}
                paddingRight={2}
                {...LeftBar}
                borderColor={cursor() ? t().accent : current() ? t().primary : TRANSPARENT}
                backgroundColor={cursor() ? t().backgroundElement : TRANSPARENT}
                onMouseUp={() => app.openChapter({ book: b.id, chapter: 1 })}
              >
                <text fg={cursor() || current() ? t().text : t().textMuted} attributes={cursor() ? TextAttributes.BOLD : 0} wrapMode="none">
                  {fit(b.name, 17)}
                </text>
                <LineBar fraction={p().fraction} width={8} color={p().fraction === 1 ? t().success : t().primary} />
              </box>
            )
          }}
        </For>
      </scrollbox>
    </box>
  )
}
