import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { bookById, BOOKS } from "../../data/books"
import { formatRef } from "../../data/ref"
import { formatMinutes } from "../../data/stats"
import { minimumReadMs } from "../../data/tracker"
import { Footer, LeftBar, LineBar, TRANSPARENT, fit } from "../components/primitives"
import { plain, VerseText } from "../components/verse"
import { openBookmarks, openBooks, openHelp, openNote, openPalette, openSearch, openTranslations } from "../dialogs"
import { useApp } from "../state"

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

  // Track reading per chapter (and per translation switch, which keeps the same session).
  createEffect(
    on([chapterKey, app.translation], () => {
      const words = app.words().get(chapterKey()) ?? 0
      tracker.open({ book: pos().book, chapter: pos().chapter, translation: app.translation(), words })
      setAnchor(undefined)
      setTimeout(() => {
        scrollToCursor(true)
        checkEnd()
      }, 0)
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

  /**
   * Keeps the cursor verse in view with a vim-style margin. On opening a chapter the target
   * verse is placed a third of the way down, so the verses before it give context.
   */
  function scrollToCursor(open = false) {
    if (!scroll || scroll.isDestroyed) return
    if (open && pos().verse <= 1) return scroll.scrollTo(0)
    const el = scroll.content.findDescendantById(`v-${pos().verse}`)
    if (!el) return
    const h = scroll.viewport.height
    const top = el.y - scroll.content.y
    const bottom = top + el.height
    const margin = Math.min(4, Math.floor(h / 5))
    if (open) return scroll.scrollTo(Math.max(0, top - Math.floor(h / 3)))
    if (top < scroll.scrollTop + margin) scroll.scrollTo(Math.max(0, top - margin))
    else if (bottom > scroll.scrollTop + h - margin) scroll.scrollTo(bottom - h + margin)
  }

  createEffect(on(() => pos().verse, () => setTimeout(() => {
    scrollToCursor()
    checkEnd()
  }, 0)))

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
    if (count() && k !== "g") setCount("")
    if (ctrl && k === "p") return openPalette(app), true
    if (ctrl && k === "b") return app.setConfig("sidebar", !app.config.sidebar), true
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
        app.setVerse(count() ? Math.min(lastVerse(), Number(count())) : 1)
        setCount("")
        return true
      case "G":
      case "end":
        return app.setVerse(lastVerse()), true
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
        store.toggleBookmark({ ...pos() }) ? app.toast(`Bookmarked ${formatRef({ ...pos(), verseStart: pos().verse })}`) : app.toast("Bookmark removed")
        app.bump()
        return true
      case "h":
        store.cycleHighlight({ ...pos() })
        app.bump()
        return true
      case "a":
        return openNote(app, { ...pos() }), true
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
        if (!bible.hasTranslation(app.config.parallel) || app.config.parallel === app.translation()) {
          const other = app.installed().find((x) => x.id !== app.translation())
          if (!other) return app.toast("Install a second translation first", "Press t to manage translations", "warning"), true
          app.setConfig("parallel", other.id)
        }
        app.setParallel(!app.parallel())
        return true
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
      case "escape":
        if (anchor() !== undefined) return setAnchor(undefined), true
        return app.setRoute("home"), true
      case "q":
        return app.deps.quit(), true
    }
    return false
  })

  const sidebar = () => app.config.sidebar && dims().width >= 100
  const measure = () => {
    const room = dims().width - (sidebar() ? 32 : 0) - 4
    return app.parallel() ? Math.min(room, app.config.measure * 2 + 4) : Math.min(room, app.config.measure)
  }

  // live reading status for the header
  const status = createMemo(() => {
    tick()
    app.rev()
    const readToday = store.readOn(pos().book, pos().chapter, app.today())
    const required = minimumReadMs(app.words().get(chapterKey()) ?? 0)
    return { readToday, active: tracker.activeMs, required, everRead: store.isRead(pos().book, pos().chapter) }
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* header */}
      <box flexDirection="row" height={1} flexShrink={0} backgroundColor={t().backgroundPanel} justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text wrapMode="none">
          <span style={{ fg: t().text, attributes: TextAttributes.BOLD }}>
            {book().name} {pos().chapter}
          </span>
          <span style={{ fg: t().textMuted }}>  ·  {app.translation()}</span>
          <Show when={app.parallel()}>
            <span style={{ fg: t().textMuted }}> ⇄ {app.config.parallel}</span>
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
                <span style={{ fg: t().textMuted }}>○ reading </span>
                <span style={{ fg: t().text }}>{formatMinutes(Math.min(status().active, status().required) / 60_000)}</span>
                <span style={{ fg: t().textMuted }}> of {formatMinutes(status().required / 60_000)}</span>
              </text>
            }
          >
            <text wrapMode="none" fg={t().success}>
              ● read today
            </text>
          </Show>
        </box>
      </box>

      <box flexDirection="row" flexGrow={1}>
        <Show when={sidebar()}>
          <Sidebar />
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
          <box width={measure()} flexDirection="column" paddingTop={1} paddingBottom={2}>
            <box flexDirection="column" paddingLeft={7} paddingBottom={1}>
              <text fg={t().textMuted} attributes={TextAttributes.BOLD} wrapMode="none">
                {book().name.toUpperCase().split("").join(" ")}
              </text>
              <text fg={t().text} attributes={TextAttributes.BOLD} wrapMode="none">
                Chapter {pos().chapter}
                <Show when={status().everRead && !status().readToday}>
                  <span style={{ fg: t().textMuted, attributes: 0 }}>   ✓ read before</span>
                </Show>
              </text>
            </box>
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
            <For each={verses()}>
              {(v) => {
                const cursor = () => v.verse === pos().verse
                const inSel = () => anchor() !== undefined && v.verse >= selection().start && v.verse <= selection().end
                const hl = () => marks().highlights.get(v.verse)
                const bg = () => (inSel() ? t().backgroundElement : hl() ? t().highlight[hl()! - 1]! : cursor() ? t().backgroundPanel : TRANSPARENT)
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
                    <text width={4} flexShrink={0} fg={cursor() ? t().primary : t().textMuted} selectable={false} attributes={cursor() ? TextAttributes.BOLD : 0}>
                      {fit(String(v.verse), 3, "right")}
                    </text>
                    <text width={1} flexShrink={0} selectable={false} fg={marks().bookmarks.has(v.verse) ? t().accent : t().info}>
                      {marks().bookmarks.has(v.verse) ? "◆" : marks().notes.has(v.verse) ? "•" : " "}
                    </text>
                    <box flexDirection="row" flexGrow={1} gap={3} paddingLeft={1}>
                      <text flexGrow={1} flexBasis={0} wrapMode="word">
                        <Show when={v.text} fallback={<span style={{ fg: t().textMuted, attributes: TextAttributes.ITALIC }}>Not in the manuscripts this translation follows.</span>}>
                          <VerseText text={v.text} />
                        </Show>
                      </text>
                      <Show when={app.parallel()}>
                        <text flexGrow={1} flexBasis={0} wrapMode="word">
                          <Show when={parallelVerses().get(v.verse)} fallback={<span style={{ fg: t().textMuted }}>—</span>}>
                            <VerseText text={parallelVerses().get(v.verse)!} />
                          </Show>
                        </text>
                      </Show>
                    </box>
                  </box>
                )
              }}
            </For>
            <box paddingLeft={7} paddingTop={2} flexDirection="column">
              <ChapterEnd />
            </box>
          </box>
        </scrollbox>
      </box>

      <Footer
        mode={anchor() !== undefined ? "SELECT" : count() ? `:${count()}` : "READ"}
        hints={
          anchor() !== undefined
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
                { key: "h", label: "highlight" },
                { key: "b", label: "bookmark" },
                { key: "ctrl+p", label: "commands" },
              ]
        }
      />
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
function Sidebar() {
  const app = useApp()
  const t = () => app.theme()
  const book = createMemo(() => bookById(app.position().book))
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
          {book().name}
        </text>
        <text fg={t().textMuted}>
          {perBook().get(book().id)?.read ?? 0} of {book().chapters} chapters read
        </text>
        <box flexDirection="row" flexWrap="wrap" paddingTop={1} width={28}>
          <For each={chapters()}>
            {(c) => {
              const current = () => c === app.position().chapter
              const read = () => readSet().has(`${book().id}:${c}`)
              return (
                <text
                  width={4}
                  fg={current() ? t().onPrimary : read() ? t().success : t().textMuted}
                  bg={current() ? t().primary : TRANSPARENT}
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
          Books
        </text>
      </box>
      <scrollbox ref={(r: ScrollBoxRenderable) => (scroll = r)} flexGrow={1} scrollbarOptions={{ visible: false }}>
        <For each={BOOKS}>
          {(b) => {
            const current = () => b.id === app.position().book
            const p = () => perBook().get(b.id)!
            return (
              <box
                id={`sb-${b.id}`}
                flexDirection="row"
                justifyContent="space-between"
                paddingLeft={1}
                paddingRight={2}
                {...LeftBar}
                borderColor={current() ? t().primary : TRANSPARENT}
                onMouseUp={() => app.openChapter({ book: b.id, chapter: 1 })}
              >
                <text fg={current() ? t().text : t().textMuted} wrapMode="none">
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
