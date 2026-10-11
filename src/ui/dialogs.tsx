import { TextAttributes, type InputRenderable, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { BOOKS, bookById } from "../data/books"
import { prettyDay } from "../data/dates"
import { importTranslation, removeTranslation } from "../data/importer"
import { PLANS } from "../data/plans"
import { parseSearch } from "../data/bible"
import { baseStrongs } from "../data/concordance"
import { formatRef, parseGoTo, parseRef } from "../data/ref"
import type { Goal } from "../data/stats"
import { CATALOG } from "../data/translations"
import type { VerseKey } from "../data/user"
import { THEME_NAMES, themeLabel } from "../theme"
import { DialogHeader, SelectDialog, WIDTHS, type SelectItem } from "./components/dialog"
import { Hints, LeftBar, TRANSPARENT, fit } from "./components/primitives"
import { plain, VerseText } from "./components/verse"
import type { App } from "./state"
import { openGallery } from "./scene"

// palette ----------------------------------------------------------------------------

interface Command {
  title: string
  category: string
  hint?: string
  /** The everyday words someone types looking for this, besides the title. */
  words?: string
  run: () => void
}

export function openPalette(app: App) {
  const commands = (): Command[] => {
    const reading = app.route() === "reader"
    // Study tools open from anywhere: from home they open the reader where you left off.
    const study = (tab: "notes" | "commentary" | "words" | "ask") => () => {
      if (!reading) resume(app)
      app.setStudyOpen(true)
      app.setStudyTab(tab)
      app.setStudyFocused(true)
    }
    const verse = () => ({ ...app.position() })
    const here = () => formatRef({ book: app.position().book, chapter: app.position().chapter, verseStart: app.position().verse })
    const SETTINGS = "settings preferences options configure"
    const list: Command[] = [
      { title: "Home", category: "Go", hint: "esc", words: "start main menu back", run: () => app.setRoute("home") },
      { title: "Continue reading", category: "Go", hint: "ctrl+r", words: "resume where I left off last", run: () => resume(app) },
      { title: "Progress and streaks", category: "Go", hint: "s", words: "stats statistics streak history how much", run: () => app.setRoute("progress") },
      { title: "Today's reading", category: "Go", hint: "ctrl+o", words: "today plan daily", run: () => openToday(app) },
      { title: "Go to book or chapter", category: "Go", hint: "o", words: "open book chapter jump navigate find book", run: () => openBooks(app) },
      { title: "Search the Bible", category: "Go", hint: "/", words: "find look up word phrase", run: () => openSearch(app) },
      { title: "Study notes", category: "Study", hint: "tab", words: "write note journal thoughts", run: study("notes") },
      {
        title: "Matthew Henry's commentary",
        category: "Study",
        hint: "tab 2",
        words: "commentary henry explain explanation meaning interpretation",
        run: study("commentary"),
      },
      {
        title: "Hebrew and Greek words of this verse",
        category: "Study",
        hint: "tab 3",
        words: "greek hebrew original language strongs strong's lexicon dictionary concordance interlinear word meaning",
        run: study("words"),
      },
      {
        title: "Ask Claude or Codex about this chapter",
        category: "Study",
        hint: "tab 4",
        words: "ask ai chat claude codex question assistant gpt",
        run: study("ask"),
      },
      { title: "Doré gallery", category: "Study", hint: "i", words: "pictures picture art images paintings engravings drawings illustrations scenes", run: () => openGallery(app) },
      { title: "Bookmarks", category: "Study", hint: "B", words: "saved favourites favorites", run: () => openBookmarks(app) },
      { title: "All notes", category: "Study", words: "notes journal export", run: () => openNotes(app) },
      { title: "Reading plan", category: "Tracking", words: "plan schedule through the bible in a year", run: () => openPlans(app) },
      { title: "Daily goal", category: "Tracking", words: `goal target ${SETTINGS}`, run: () => openGoal(app) },
      { title: "Theme", category: "Appearance", words: `colors colours look skin ${SETTINGS}`, run: () => openThemes(app) },
      { title: `Icons: ${app.icons()}`, category: "Appearance", words: `icons symbols boxes question marks ${SETTINGS}`, run: () => openIcons(app) },
      {
        title: `Motion: ${app.config.motion}`,
        category: "Appearance",
        hint: "full / reduced",
        words: `animation motion ${SETTINGS}`,
        run: () => app.setConfig("motion", app.config.motion === "full" ? "reduced" : "full"),
      },
      {
        title: `Light or dark: ${app.config.mode}`,
        category: "Appearance",
        hint: "auto / dark / light",
        words: `dark light mode night ${SETTINGS}`,
        run: () => app.setConfig("mode", app.config.mode === "auto" ? "dark" : app.config.mode === "dark" ? "light" : "auto"),
      },
      {
        title: "Bigger or smaller text",
        category: "Appearance",
        words: `font size zoom larger bigger smaller text ${SETTINGS}`,
        run: () =>
          app.toast(
            "Text size is your terminal's",
            "Press ctrl and + or - (cmd on a Mac). In the reader, = and - make the column wider or narrower.",
          ),
      },
      { title: app.config.sidebar ? "Hide sidebar" : "Show sidebar", category: "Appearance", hint: "ctrl+b", words: "sidebar books list", run: () => app.setConfig("sidebar", !app.config.sidebar) },
      {
        title: "Translations",
        category: "Library",
        hint: "t",
        words: `version bible version translation kjv bsb asv ylt download install ${SETTINGS}`,
        run: () => openTranslations(app),
      },
      { title: "Keyboard shortcuts and help", category: "Help", hint: "?", words: "help keys keyboard how to use tutorial guide controls shortcuts manual", run: () => openHelp(app) },
      { title: "Quit", category: "Help", hint: "ctrl+c", words: "exit close leave bye stop", run: () => app.deps.quit() },
    ]
    if (reading) {
      list.splice(
        6,
        0,
        { title: "Next chapter", category: "Reader", hint: "n", words: "forward", run: () => app.next() },
        { title: "Previous chapter", category: "Reader", hint: "p", words: "back", run: () => app.prev() },
        { title: "Mark chapter read", category: "Reader", hint: "m", words: "done finished complete", run: () => app.markRead() },
        {
          title: `Highlight ${here()}`,
          category: "Reader",
          hint: "h",
          words: "highlight colour color mark underline",
          run: () => (app.deps.store.cycleHighlight(verse()), app.bump()),
        },
        {
          title: `Bookmark ${here()}`,
          category: "Reader",
          hint: "b",
          words: "bookmark save favourite favorite star",
          run: () => {
            app.toast(app.deps.store.toggleBookmark(verse()) ? `Bookmarked ${here()}` : "Bookmark removed")
            app.bump()
          },
        },
        {
          title: `Copy ${here()}`,
          category: "Reader",
          hint: "y",
          words: "copy clipboard share paste",
          run: () => {
            const v = app.deps.bible.verses(app.translation(), { book: app.position().book, chapter: app.position().chapter, verseStart: app.position().verse })[0]
            const ok = !!v && app.deps.copy(`"${plain(v.text)}" (${here()}, ${app.translation()})`)
            app.toast(ok ? `Copied ${here()}` : "Clipboard not available", ok ? undefined : "Your terminal does not support OSC 52", ok ? "info" : "warning")
          },
        },
        { title: app.parallel() ? "Close parallel view" : "Parallel translation", category: "Reader", hint: "T", words: "side by side compare two", run: () => app.toggleParallel() },
        { title: "Note on this verse", category: "Reader", hint: "a", words: "write note", run: () => openNote(app, { ...app.position() }) },
        { title: app.focus() ? "Leave focus mode" : "Focus mode", category: "Reader", hint: "z", words: "distraction free zen", run: () => app.setFocus(!app.focus()) },
        {
          title: app.config.prose ? "One verse per line" : "Prose: flowing paragraphs",
          category: "Reader",
          hint: "w",
          words: "paragraph layout",
          run: () => app.setConfig("prose", !app.config.prose),
        },
      )
    }
    return list
  }
  const items = (filter: string): SelectItem<() => void>[] => {
    const ref = parseGoTo(filter)
    const base = commands().map((c, i) => ({ id: `c${i}`, title: c.title, category: c.category, hint: c.hint, value: c.run, search: c.words }))
    const extra: SelectItem<() => void>[] = []
    if (ref) extra.push({ id: "goto", title: `Go to ${formatRef(ref)}`, hint: "enter", value: () => app.goTo(ref), search: filter })
    if (filter.trim().length > 2 && !ref) extra.push({ id: "search", title: `Search for "${filter.trim()}"`, value: () => openSearch(app, filter.trim()), search: filter })
    return [...extra.filter((e) => e.id === "goto"), ...base, ...extra.filter((e) => e.id === "search")]
  }
  app.openDialog(() => (
    <SelectDialog
      title="Commands"
      placeholder="Type a command or a reference like jn 3:16"
      items={(f) => {
        const all = items(f)
        if (!f.trim()) return all
        // References and the search fallback always show; commands are fuzzy-matched.
        const pinned = all.filter((i) => i.id === "goto" || i.id === "search")
        const rest = all.filter((i) => i.id !== "goto" && i.id !== "search")
        // the title counts most; the everyday words still find it
        const ranked = rest
          .map((i) => {
            const title = fuzzyScore(f, i.title)
            const words = i.search ? fuzzyScore(f, i.search) : null
            return { i, m: title === null && words === null ? null : Math.max(title ?? -Infinity, (words ?? -Infinity) - 2) }
          })
          .filter((x) => x.m !== null)
          .sort((a, b) => b.m! - a.m!)
          .map((x) => x.i)
        return [...pinned.filter((p) => p.id === "goto"), ...ranked, ...pinned.filter((p) => p.id === "search")]
      }}
      customFilter
      onSelect={(item) => {
        app.closeDialog()
        item.value()
      }}
    />
  ))
}

import { fuzzy, fuzzyFilter } from "../data/fuzzy"
const fuzzyScore = (q: string, s: string) => fuzzy(q, s)?.score ?? null

function resume(app: App) {
  const p = app.deps.store.position()
  if (p) app.openChapter(p, p.verse)
  else app.openChapter({ book: 43, chapter: 1 })
}

function openToday(app: App) {
  const p = app.activePlan()
  if (!p) return openPlans(app)
  const first = p.status.next.chapters[0]
  if (first) app.openChapter(first)
}

// search -------------------------------------------------------------------------------

export function openSearch(app: App, initial = "") {
  app.openDialog(() => <SearchDialog app={app} initial={initial} />, "large")
}

function SearchDialog(props: { app: App; initial: string }) {
  const app = props.app
  const t = () => app.theme()
  const dims = useTerminalDimensions()
  const [query, setQuery] = createSignal(props.initial)
  const [debounced, setDebounced] = createSignal(props.initial)
  const [index, setIndex] = createSignal(0)
  let timer: ReturnType<typeof setTimeout> | undefined
  let scroll: ScrollBoxRenderable | undefined
  onCleanup(() => clearTimeout(timer))

  // `in:commentary` (or `in:henry`) searches Matthew Henry instead of the text.
  const inHenry = createMemo(() => /\bin:(commentary|henry)\b/i.test(debounced()))
  // A Strong's number ("G26", "h7225") searches the concordance: every verse using that word.
  const strongs = createMemo(() => (/^\s*[hg]\d{1,4}[a-z]?\s*$/i.test(debounced()) ? baseStrongs(debounced()) : undefined))
  const hits = createMemo<{ book: number; chapter: number; verse: number; marked: string; heading?: string; strongs?: string }[]>(() => {
    const s = strongs()
    if (s) {
      if (!app.deps.concordance?.installed) return []
      return app.deps.concordance.occurrences(s, { limit: 200 }).map((o) => {
        const v = app.deps.bible.verses(app.translation(), { book: o.book, chapter: o.chapter, verseStart: o.verse })[0]
        return { ...o, marked: v?.text ?? "", strongs: s }
      })
    }
    if (!inHenry()) return app.deps.bible.search(app.translation(), debounced(), 200)
    const q = parseSearch(debounced().replace(/\bin:(commentary|henry)\b/gi, ""))
    if (!q.match || !app.deps.commentary?.installed) return []
    return app.deps.commentary.search(q.match, 100).map((h) => ({ ...h, marked: h.snippet }))
  })
  const total = createMemo(() =>
    strongs() ? (app.deps.concordance?.count(strongs()!).verses ?? 0) : inHenry() ? hits().length : debounced().trim() ? app.deps.bible.searchCount(app.translation(), debounced()) : 0,
  )
  const open = (h: { book: number; chapter: number; verse: number; heading?: string; strongs?: string }) => {
    app.closeAllDialogs()
    app.openChapter({ book: h.book, chapter: h.chapter }, h.verse)
    if (h.strongs) {
      app.setStudyOpen(true)
      app.setStudyTab("words")
      // focusing the pane also leaves focus mode, where the pane is not drawn and the study
      // would wait, unseen, to open later somewhere else
      app.setStudyFocused(true)
      app.setWordStudy(h.strongs)
    }
    if (h.heading !== undefined) {
      app.setStudyOpen(true)
      app.setStudyTab("commentary")
    }
  }
  const update = (v: string) => {
    setQuery(v)
    clearTimeout(timer)
    timer = setTimeout(() => {
      setDebounced(v)
      setIndex(0)
    }, 90)
  }
  const select = (i: number) => {
    setIndex(i)
    setTimeout(() => scroll && !scroll.isDestroyed && scroll.scrollChildIntoView(`hit-${i}`), 0)
  }
  app.useKeys(
    (key) => {
      const n = hits().length
      if (key.name === "escape") return app.closeDialog(), true
      if (key.name === "down" || (key.ctrl && key.name === "n")) return n && select((index() + 1) % n), true
      if (key.name === "up" || (key.ctrl && key.name === "p")) return n && select((index() - 1 + n) % n), true
      if (key.name === "pagedown") return n && select(Math.min(n - 1, index() + 6)), true
      if (key.name === "pageup") return n && select(Math.max(0, index() - 6)), true
      if (key.name === "return") {
        const h = hits()[index()]
        if (h) open(h)
        return true
      }
      return false
    },
    { modal: true },
  )
  const listHeight = () => Math.max(6, dims().height - 16)
  return (
    <box flexDirection="column" gap={1}>
      <DialogHeader title="Search" />
      <box paddingLeft={4} paddingRight={4} flexDirection="column">
        <input
          ref={(r: InputRenderable) => setTimeout(() => !r.isDestroyed && r.focus(), 1)}
          value={props.initial}
          placeholder='Words, "a phrase", in:john, in:nt, G26'
          placeholderColor={t().textMuted}
          textColor={t().text}
          focusedTextColor={t().text}
          backgroundColor={t().backgroundPanel}
          focusedBackgroundColor={t().backgroundPanel}
          cursorColor={t().primary}
          onInput={update}
        />
        <text fg={t().textMuted} wrapMode="none" paddingTop={1}>
          {debounced().trim()
            ? strongs()
              ? app.deps.concordance?.installed
                ? `${strongs()} ${app.deps.concordance.entry(strongs()!)?.translit ?? ""}: ${total()} ${total() === 1 ? "verse" : "verses"}${total() > hits().length ? ` · showing the first ${hits().length}` : ""}`
                : "Install the Hebrew and Greek words first: tab, then 3, in the reader"
              : inHenry()
              ? app.deps.commentary?.installed
                ? `${total()} passages in Matthew Henry`
                : "Install Matthew Henry first: tab, then 2, in the reader"
              : `${total()} ${total() === 1 ? "verse" : "verses"} in ${app.translation()}${total() > hits().length ? ` · showing the best ${hits().length}` : ""}`
            : "Search every verse. Quote a phrase, narrow with in:psalms, in:ot, in:nt or in:commentary, or type a Strong's number like G26."}
        </text>
      </box>
      <Show when={hits().length > 0}>
        <scrollbox ref={(r: ScrollBoxRenderable) => (scroll = r)} height={Math.min(listHeight(), hits().length * 3)} paddingLeft={1} paddingRight={1} scrollbarOptions={{ visible: false }}>
          <For each={hits()}>
            {(h, i) => {
              const active = () => i() === index()
              return (
                <box
                  id={`hit-${i()}`}
                  flexDirection="column"
                  paddingLeft={3}
                  paddingRight={3}
                  backgroundColor={active() ? t().backgroundElement : TRANSPARENT}
                  onMouseOver={() => setIndex(i())}
                  onMouseUp={() => open(h)}
                >
                  <text wrapMode="none" fg={active() ? t().primary : t().accent} attributes={TextAttributes.BOLD}>
                    {h.heading !== undefined
                      ? `Henry · ${formatRef({ book: h.book, chapter: h.chapter })} · ${h.heading}`
                      : formatRef({ book: h.book, chapter: h.chapter, verseStart: h.verse })}
                  </text>
                  <text wrapMode="word" paddingBottom={1}>
                    <VerseText
                      text={h.marked}
                      matchColor={t().warning}
                      segments={h.heading !== undefined ? { brackets: false, emphasis: true } : undefined}
                    />
                  </text>
                </box>
              )
            }}
          </For>
        </scrollbox>
      </Show>
      <box paddingLeft={4} paddingRight={4}>
        <Hints hints={[{ key: "↑↓", label: "move" }, { key: "enter", label: "open" }, { key: "esc", label: "close" }]} />
      </box>
    </box>
  )
  void query
}

// books and chapters ----------------------------------------------------------------------

export function openBooks(app: App) {
  const progress = new Map(app.progress().books.map((b) => [b.book, b]))
  app.openDialog(() => (
    <SelectDialog
      title="Go to"
      placeholder="Book name, or a reference like rom 8"
      initial={`b${app.position().book}`}
      customFilter
      empty="No book by that name. Type a book and chapter, like romans 8 or ps 23."
      items={(f) => {
        // "romans 8", "rom 8:28", and what is left of "romans 8" after the reader's shortcut keys
        // ate its first letters ("mans 8", "hn 3"): a book part matched anywhere in a book's
        // names, then an optional chapter and verse
        const m = /^(.*?)\s*(\d+)?\s*(?::\s*(\d+))?\s*$/.exec(f.trim())!
        const name = m[1]!.trim()
        const chapter = m[2] ? Number(m[2]) : undefined
        const verse = m[3] ? Number(m[3]) : undefined
        const exact = parseGoTo(f)
        const matched = name ? fuzzyFilter(name, [...BOOKS], (b) => `${b.name} ${b.osis} ${b.aliases.join(" ")}`).map((x) => x.item) : [...BOOKS]
        const books = matched.map((b) => {
          const p = progress.get(b.id)!
          const ch = chapter && chapter <= b.chapters ? chapter : undefined
          return {
            id: `b${b.id}`,
            title: ch ? `${b.name} ${ch}${verse ? `:${verse}` : ""}` : b.name,
            category: `${b.testament === "OT" ? "Old" : "New"} Testament · ${b.group}`,
            hint: ch ? "enter" : p.read ? `${p.read}/${b.chapters}${p.fraction === 1 ? " ✓" : ""}` : `${b.chapters} ch`,
            current: b.id === app.position().book,
            value: { book: b.id, ref: ch ? { book: b.id, chapter: ch, verseStart: verse, verseEnd: verse } : undefined } as {
              book: number
              ref?: ReturnType<typeof parseRef>
            },
          }
        })
        if (exact && /\d/.test(f) && !books.some((x) => x.value.ref?.book === exact.book && x.value.ref.chapter === exact.chapter))
          return [{ id: "ref", title: `Go to ${formatRef(exact)}`, value: { book: exact.book, ref: exact }, hint: "enter" }, ...books]
        return books
      }}
      onSelect={(item) => {
        if (item.value.ref) {
          app.closeAllDialogs()
          return app.goTo(item.value.ref)
        }
        const b = bookById(item.value.book)
        if (b.chapters === 1) {
          app.closeAllDialogs()
          return app.openChapter({ book: b.id, chapter: 1 })
        }
        app.openDialog(() => <ChapterGrid app={app} book={b.id} />)
      }}
    />
  ))
}

function ChapterGrid(props: { app: App; book: number }) {
  const app = props.app
  const t = () => app.theme()
  const b = bookById(props.book)
  const COLS = 10
  const [sel, setSel] = createSignal(app.position().book === b.id ? app.position().chapter : 1)
  // Digits build a number in their own buffer ("1", "2" → 12); a pause starts a new number.
  let typed = ""
  let typedAt = 0
  const reads = createMemo(() => new Set(app.reads().filter((r) => r.book === b.id).map((r) => r.chapter)))
  const today = createMemo(() => new Set(app.reads().filter((r) => r.book === b.id && r.day === app.today()).map((r) => r.chapter)))
  const open = (c: number) => {
    app.closeAllDialogs()
    app.openChapter({ book: b.id, chapter: c })
  }
  const clamp = (c: number) => Math.max(1, Math.min(b.chapters, c))
  app.useKeys(
    (key) => {
      if (key.name === "escape") return app.closeDialog(), true
      if (key.name === "left" || key.name === "h") return setSel((c) => clamp(c - 1)), true
      if (key.name === "right" || key.name === "l") return setSel((c) => clamp(c + 1)), true
      if (key.name === "up" || key.name === "k") return setSel((c) => clamp(c - COLS)), true
      if (key.name === "down" || key.name === "j") return setSel((c) => clamp(c + COLS)), true
      if (key.name === "return") return open(sel()), true
      if (/^[0-9]$/.test(key.name)) {
        const now = Date.now()
        typed = now - typedAt < 1000 ? typed + key.name : key.name
        typedAt = now
        if (Number(typed) > b.chapters) typed = key.name
        setSel(clamp(Number(typed) || 1))
        return true
      }
      return false
    },
    { modal: true },
  )
  const rows = Array.from({ length: Math.ceil(b.chapters / COLS) }, (_, r) => Array.from({ length: COLS }, (_, c) => r * COLS + c + 1).filter((n) => n <= b.chapters))
  return (
    <box flexDirection="column" gap={1}>
      <DialogHeader title={b.name} right={`${reads().size}/${b.chapters} read · esc`} />
      <box paddingLeft={4} paddingRight={4} flexDirection="column">
        <For each={rows}>
          {(row) => (
            <box flexDirection="row">
              <For each={row}>
                {(c) => {
                  const active = () => sel() === c
                  return (
                    <text
                      width={5}
                      wrapMode="none"
                      bg={active() ? t().primary : TRANSPARENT}
                      fg={active() ? t().onPrimary : today().has(c) ? t().success : reads().has(c) ? t().text : t().textMuted}
                      attributes={active() || reads().has(c) ? TextAttributes.BOLD : 0}
                      onMouseOver={() => setSel(c)}
                      onMouseUp={() => open(c)}
                    >
                      {fit(String(c), 4, "right") + " "}
                    </text>
                  )
                }}
              </For>
            </box>
          )}
        </For>
      </box>
      <box paddingLeft={4} paddingRight={4} flexDirection="row" justifyContent="space-between">
        <Hints hints={[{ key: "←↑↓→", label: "move" }, { key: "enter", label: "open" }]} />
        <text wrapMode="none">
          <span style={{ fg: t().success }}>■</span>
          <span style={{ fg: t().textMuted }}> today  </span>
          <span style={{ fg: t().text }}>■</span>
          <span style={{ fg: t().textMuted }}> read  </span>
          <span style={{ fg: t().textMuted }}>■ unread</span>
        </text>
      </box>
    </box>
  )
}

// themes ---------------------------------------------------------------------------------

export function openThemes(app: App) {
  const original = app.config.theme
  const names = app.deps.palette ? ["system", ...THEME_NAMES] : THEME_NAMES
  app.openDialog(() => (
    <SelectDialog
      title="Theme"
      placeholder="Search themes"
      initial={original}
      items={names.map((n) => ({ id: n, title: themeLabel(n), value: n, current: n === original, hint: n === original ? "current" : undefined }))}
      onMove={(item) => item && app.setPreview(item.value)}
      onKey={(key) => {
        if (key.name === "tab") {
          app.setConfig("mode", app.config.mode === "auto" ? "dark" : app.config.mode === "dark" ? "light" : "auto")
          return true
        }
        return false
      }}
      onSelect={(item) => {
        app.setConfig("theme", item.value)
        app.closeDialog()
        app.setPreview(undefined)
        app.toast(`Theme: ${themeLabel(item.value)}`)
      }}
      footer={[
        { key: "↑↓", label: "preview" },
        { key: "enter", label: "apply" },
        { key: "tab", label: `mode: ${app.config.mode}` },
      ]}
    />
  ))
}

// translations ------------------------------------------------------------------------------

export function openTranslations(app: App) {
  const busy = new Set<string>()
  const items = (): SelectItem<string>[] =>
    CATALOG.map((c) => {
      const installed = app.installed().some((i) => i.id === c.id)
      return {
        id: c.id,
        title: `${c.id}  ${c.name}`,
        description: `${c.year}`,
        hint: busy.has(c.id) ? "downloading…" : installed ? (c.id === app.translation() ? "reading" : "installed") : "download",
        category: installed ? "Installed" : "Available",
        current: c.id === app.translation(),
        value: c.id,
      }
    })
  app.openDialog(
    () => (
      <SelectDialog
        title="Translations"
        placeholder="Filter translations"
        initial={app.translation()}
        items={() => {
          app.rev()
          return items()
        }}
        header={<text fg={app.theme().textMuted} paddingTop={1}>All are public domain. Downloads are stored locally and work offline.</text>}
        onKey={(key, item) => {
          if (key.ctrl && key.name === "d" && item) {
            if (item.value === app.translation()) return app.toast("Switch to another translation before removing this one", undefined, "warning"), true
            if (!app.installed().some((i) => i.id === item.value)) return true
            removeTranslation(app.deps.bible.db, item.value)
            app.bump()
            app.toast(`Removed ${item.value}`)
            return true
          }
          return false
        }}
        onSelect={async (item) => {
          const id = item.value
          if (app.installed().some((i) => i.id === id)) {
            app.setConfig("translation", id)
            app.closeDialog()
            app.toast(`Reading the ${CATALOG.find((c) => c.id === id)?.name}`)
            return
          }
          if (busy.has(id)) return
          busy.add(id)
          app.bump()
          app.toast(`Downloading ${id}…`, "About 8 MB, once")
          try {
            await importTranslation(app.deps.bible.db, id)
            app.toast(`Installed ${id}`, "Press enter to read it", "success")
          } catch (e) {
            app.toast(`Could not install ${id}`, e instanceof Error ? e.message : String(e), "error")
          } finally {
            busy.delete(id)
            app.bump()
          }
        }}
        footer={[
          { key: "enter", label: "read / download" },
          { key: "ctrl+d", label: "remove" },
        ]}
      />
    ),
    "large",
  )
}

// plans and goal --------------------------------------------------------------------------------

export function openPlans(app: App) {
  const active = app.activePlan()
  const items: SelectItem<string | undefined>[] = PLANS.map((p) => ({
    id: p.id,
    title: p.name,
    description: `${p.days} days`,
    hint: active?.id === p.id ? `day ${active.status.dayNumber}` : undefined,
    current: active?.id === p.id,
    search: `${p.name} ${p.description}`,
    category: "Plans",
    value: p.id,
  }))
  if (active) items.push({ id: "stop", title: "Stop the current plan", category: "Current", value: undefined, description: `${active.def.name}, started ${prettyDay(active.startedOn)}` })
  app.openDialog(
    () => (
      <SelectDialog
        title="Reading plan"
        placeholder="Choose a plan"
        initial={active?.id}
        items={items}
        header={<PlanPreview app={app} />}
        onMove={(item) => setPreviewPlan(item?.value)}
        onSelect={(item) => {
          app.closeDialog()
          if (item.value === active?.id) return
          app.setPlan(item.value)
          app.toast(item.value ? `Started ${PLANS.find((p) => p.id === item.value)!.name}` : "Plan stopped", item.value ? "Day 1 is today. Ctrl+O opens today's reading." : undefined, "success")
        }}
      />
    ),
    "large",
  )
}

const [previewPlan, setPreviewPlan] = createSignal<string | undefined>()
function PlanPreview(props: { app: App }) {
  const t = () => props.app.theme()
  const def = () => PLANS.find((p) => p.id === previewPlan())
  return (
    <Show when={def()} fallback={<box height={2} />}>
      <text fg={t().textMuted} wrapMode="word" paddingTop={1} height={2}>
        {def()!.description}
      </text>
    </Show>
  )
}

export function openGoal(app: App) {
  const goals: Goal[] = [
    { kind: "chapters", amount: 1 },
    { kind: "chapters", amount: 2 },
    { kind: "chapters", amount: 3 },
    { kind: "chapters", amount: 4 },
    { kind: "chapters", amount: 5 },
    { kind: "minutes", amount: 5 },
    { kind: "minutes", amount: 10 },
    { kind: "minutes", amount: 15 },
    { kind: "minutes", amount: 20 },
    { kind: "minutes", amount: 30 },
  ]
  const current = app.config.goal
  app.openDialog(() => (
    <SelectDialog
      title="Daily goal"
      placeholder="How much do you want to read each day?"
      initial={`${current.kind}-${current.amount}`}
      items={goals.map((g) => ({
        id: `${g.kind}-${g.amount}`,
        title: g.kind === "chapters" ? `${g.amount} ${g.amount === 1 ? "chapter" : "chapters"} a day` : `${g.amount} minutes a day`,
        category: g.kind === "chapters" ? "By chapters" : "By time",
        description: g.kind === "chapters" ? `about ${g.amount * 4} min` : undefined,
        current: g.kind === current.kind && g.amount === current.amount,
        value: g,
      }))}
      onSelect={(item) => {
        app.setConfig("goal", item.value)
        app.closeDialog()
        app.toast("Goal updated", "Streaks and consistency are recalculated against it")
      }}
    />
  ))
}

// bookmarks and notes ----------------------------------------------------------------------------

export function openBookmarks(app: App) {
  const items = (): SelectItem<VerseKey>[] => {
    app.rev()
    return app.deps.store.bookmarks().map((b) => {
      const text = app.deps.bible.verses(app.translation(), { book: b.book, chapter: b.chapter, verseStart: b.verse })[0]?.text ?? ""
      return {
        id: `${b.book}:${b.chapter}:${b.verse}`,
        title: formatRef({ book: b.book, chapter: b.chapter, verseStart: b.verse }),
        description: plain(text).slice(0, 60),
        value: b,
        search: `${formatRef({ book: b.book, chapter: b.chapter, verseStart: b.verse })} ${text}`,
      }
    })
  }
  app.openDialog(
    () => (
      <SelectDialog
        title="Bookmarks"
        placeholder="Filter bookmarks"
        items={() => items()}
        empty="No bookmarks yet. Press b on any verse."
        onKey={(key, item) => {
          if (key.ctrl && key.name === "d" && item) {
            app.deps.store.toggleBookmark(item.value)
            app.bump()
            return true
          }
          return false
        }}
        onSelect={(item) => {
          app.closeAllDialogs()
          app.openChapter(item.value, item.value.verse)
        }}
        footer={[
          { key: "enter", label: "open" },
          { key: "ctrl+d", label: "remove" },
        ]}
      />
    ),
    "large",
  )
}

export function openNotes(app: App) {
  app.openDialog(
    () => (
      <SelectDialog
        title="Notes"
        placeholder="Search your notes"
        items={app.deps.store.notes().map((n) => ({
          id: `${n.book}:${n.chapter}:${n.verse}`,
          title: formatRef({ book: n.book, chapter: n.chapter, verseStart: n.verse }),
          description: n.body.replace(/\s+/g, " ").slice(0, 60),
          hint: prettyDay(new Date(n.updatedAt).toISOString().slice(0, 10)),
          search: `${formatRef({ book: n.book, chapter: n.chapter, verseStart: n.verse })} ${n.body}`,
          value: n as VerseKey,
        }))}
        empty="No notes yet. Press a on any verse."
        onSelect={(item) => {
          app.closeAllDialogs()
          app.openChapter(item.value, item.value.verse)
        }}
      />
    ),
    "large",
  )
}

export function openNote(app: App, v: VerseKey) {
  app.openDialog(() => <NoteDialog app={app} verse={v} />, "large")
}

function NoteDialog(props: { app: App; verse: VerseKey }) {
  const app = props.app
  const t = () => app.theme()
  const existing = app.deps.store.note(props.verse)
  const text = app.deps.bible.verses(app.translation(), { book: props.verse.book, chapter: props.verse.chapter, verseStart: props.verse.verse })[0]?.text ?? ""
  let area: TextareaRenderable | undefined
  const save = () => {
    const body = area?.plainText ?? ""
    app.deps.store.saveNote(props.verse, body)
    app.bump()
    app.closeDialog()
    app.toast(body.trim() ? "Note saved" : existing ? "Note deleted" : "Nothing to save")
  }
  app.useKeys(
    (key) => {
      if (key.name === "escape") return app.closeDialog(), true
      if (key.ctrl && key.name === "s") return save(), true
      return false
    },
    { modal: true },
  )
  return (
    <box flexDirection="column" gap={1}>
      <DialogHeader title={`Note · ${formatRef({ book: props.verse.book, chapter: props.verse.chapter, verseStart: props.verse.verse })}`} />
      <box paddingLeft={4} paddingRight={4} flexDirection="column" gap={1}>
        <box {...LeftBar} borderColor={t().accent} paddingLeft={2}>
          <text wrapMode="word">
            <VerseText text={text} fg={t().textMuted} />
          </text>
        </box>
        <textarea
          ref={(r: TextareaRenderable) => {
            area = r
            setTimeout(() => !r.isDestroyed && r.focus(), 1)
          }}
          initialValue={existing?.body ?? ""}
          placeholder="What is this verse saying to you?"
          placeholderColor={t().textMuted}
          textColor={t().text}
          focusedTextColor={t().text}
          backgroundColor={t().backgroundElement}
          focusedBackgroundColor={t().backgroundElement}
          cursorColor={t().primary}
          height={8}
          wrapMode="word"
        />
        <Hints hints={[{ key: "ctrl+s", label: "save" }, { key: "esc", label: "discard" }, { key: "empty + save", label: "delete" }]} />
      </box>
    </box>
  )
}

// icons ----------------------------------------------------------------------------------

/**
 * Nerd Font glyphs cannot be detected, only seen. Show one and let the reader say whether it
 * renders. `first` marks the one-time question on first launch.
 */
export function openIcons(app: App, first = false) {
  app.openDialog(() => (
    <SelectDialog
      title={first ? "One question" : "Icons"}
      placeholder="Do you see a book here →  ?"
      // unanswered, the safe choice is highlighted: enter without reading must not fill the screen with boxes
      initial={app.config.icons ?? "unicode"}
      header={
        <text fg={app.theme().textMuted} wrapMode="word" paddingTop={1}>
          Selah can draw Nerd Font icons ({"\uf02d \uf06d \uf02e \uf073"}). If those look like a book, a flame, a bookmark and a calendar, choose Nerd Font. If they look like boxes or question marks, choose simple symbols.
        </text>
      }
      items={[
        { id: "nerd", title: "Nerd Font icons", description: "\uf02d \uf06d \uf02e \uf073 \uf00c", value: "nerd" as const, current: app.config.icons === "nerd" },
        { id: "unicode", title: "Simple symbols", description: "▤ ▲ ◆ ▦ ✓", value: "unicode" as const, current: app.config.icons === "unicode" },
        { id: "none", title: "No icons", description: "text only", value: "none" as const, current: app.config.icons === "none" },
      ]}
      onSelect={(item) => {
        app.setConfig("icons", item.value)
        app.closeDialog()
        app.toast(`${app.ip("check")}Icons: ${item.title}`, "Change any time from ctrl+p")
      }}
    />
  ))
}

// help -----------------------------------------------------------------------------------

/** Every key, in words a newcomer understands. Shared with the README's key table in spirit. */
export const KEYS: [string, [string, string][]][] = [
  [
    "Getting around",
    [
      ["↑ ↓  j k", "previous / next verse"],
      ["← →  n p", "previous / next chapter"],
      ["space", "next page (ctrl+d / ctrl+u half a page)"],
      ["g  G", "first / last verse"],
      ["16 enter", "jump to verse 16"],
      ["o", "go to a book and chapter (type: romans 8)"],
      ["/", "search the Bible for words"],
      ["esc", "back, and home from the reader"],
    ],
  ],
  [
    "Study tools",
    [
      ["tab", "open the study pane beside the text, and move between it and the text"],
      ["1", "Notes: your note on this verse, and a journal for the chapter"],
      ["2", "Commentary: Matthew Henry on this verse"],
      ["3", "Words: the Hebrew or Greek behind this verse, with meanings"],
      ["4", "Ask: questions answered by Claude Code or Codex, if you have one"],
      ["i", "Doré's engraving of this passage, when there is one"],
      ["ctrl+l", "show or hide the study pane"],
    ],
  ],
  [
    "Marking the text",
    [
      ["h", "highlight the verse (press again for another colour)"],
      ["b  B", "bookmark the verse / list your bookmarks"],
      ["a", "write a note on the verse"],
      ["v  y", "select several verses / copy them"],
    ],
  ],
  [
    "Your reading",
    [
      ["m", "mark the chapter read (again to unmark)"],
      ["s", "progress and streaks"],
      ["ctrl+o", "today's reading from your plan"],
    ],
  ],
  [
    "How it looks",
    [
      ["t  T", "change translation / two side by side"],
      ["-  =", "narrower / wider text"],
      ["w", "flowing paragraphs or one verse per line"],
      ["z", "focus mode: only the text"],
      ["ctrl+b", "books sidebar (j/k, enter, esc)"],
    ],
  ],
  [
    "Anywhere",
    [
      ["ctrl+p", "commands: type what you want, like 'commentary' or 'dark'"],
      ["?", "this help"],
      ["q  ctrl+c", "quit (ctrl+c on the home screen)"],
    ],
  ],
]

export function openHelp(app: App) {
  app.openDialog(() => {
    const t = () => app.theme()
    const dims = useTerminalDimensions()
    let scroll: ScrollBoxRenderable | undefined
    app.useKeys(
      (key) => {
        if (key.name === "escape" || key.name === "q" || key.sequence === "?") return app.closeDialog(), true
        if (!scroll) return true
        if (key.name === "j" || key.name === "down") return scroll.scrollBy(1), true
        if (key.name === "k" || key.name === "up") return scroll.scrollBy(-1), true
        if (key.name === "space" || key.name === "pagedown") return scroll.scrollBy(Math.max(3, scroll.viewport.height - 2)), true
        if (key.name === "pageup") return scroll.scrollBy(-Math.max(3, scroll.viewport.height - 2)), true
        return true
      },
      { modal: true },
    )
    // as many columns as fit without crushing the words; descriptions wrap, never cut
    const inner = () => Math.min(WIDTHS.xlarge, dims().width - 2) - 8
    const columns = () => (inner() >= 140 ? 3 : inner() >= 90 ? 2 : 1)
    const split = () => {
      const n = columns()
      const out: (typeof KEYS)[] = Array.from({ length: n }, () => [])
      // balance by row count, keeping each group whole
      const load = Array(n).fill(0)
      for (const g of KEYS) {
        const i = load.indexOf(Math.min(...load))
        out[i]!.push(g)
        load[i] += g[1].length + 2
      }
      return out
    }
    const keyWidth = Math.max(...KEYS.flatMap(([, ks]) => ks.map(([k]) => k.length))) + 2
    return (
      <box flexDirection="column" gap={1}>
        <DialogHeader title="How to use Selah" />
        <box paddingLeft={4} paddingRight={4}>
          <text fg={t().text} wrapMode="word">
            In the reader, letters are shortcuts, not typing. To go somewhere, press o and type a book, press / to search, or press ctrl+p and type what you
            want.
          </text>
        </box>
        {/* the dialog opens a sixth of the way down; header, intro, hints and padding take 13 rows */}
        <scrollbox ref={(r: ScrollBoxRenderable) => (scroll = r)} maxHeight={Math.max(4, dims().height - Math.floor(dims().height / 6) - 13)} scrollbarOptions={{ visible: false }}>
          <box flexDirection="row" paddingLeft={4} paddingRight={4} gap={4}>
            <For each={split()}>
              {(groups) => (
                <box flexDirection="column" flexGrow={1} flexBasis={0} gap={1}>
                  <For each={groups}>
                    {([group, keys]) => (
                      <box flexDirection="column">
                        <text fg={t().accent} attributes={TextAttributes.BOLD}>
                          {group}
                        </text>
                        <For each={keys}>
                          {([k, d]) => (
                            <box flexDirection="row">
                              <text wrapMode="none" width={keyWidth} flexShrink={0} fg={t().text}>
                                {k}
                              </text>
                              <text wrapMode="word" flexGrow={1} flexShrink={1} fg={t().textMuted}>
                                {d}
                              </text>
                            </box>
                          )}
                        </For>
                      </box>
                    )}
                  </For>
                </box>
              )}
            </For>
          </box>
          <box paddingLeft={4} paddingRight={4} paddingTop={1}>
            <text fg={t().textMuted} wrapMode="word">
              A chapter counts as read once you reach its end and have spent real time on it (about 30% of the time it takes to read, up to 30 seconds). Time
              away from the keyboard for more than 3 minutes is not counted.
            </text>
          </box>
        </scrollbox>
        <box paddingLeft={4} paddingRight={4}>
          <Hints hints={[{ key: "↑↓", label: "scroll" }, { key: "esc", label: "close" }]} />
        </box>
      </box>
    )
  }, "xlarge")
}
