import { TextAttributes, type RGBA, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { bookById } from "../data/books"
import { COMMENTARY_ATTRIBUTION, installCommentary } from "../data/commentary"
import { formatRef } from "../data/ref"
import { Bar, Hints, LeftBar, TRANSPARENT } from "./components/primitives"
import { AskTab } from "./ask"
import { WordsTab } from "./words"
import { Inline } from "./components/inline"
import { Markdown } from "./components/markdown"
import { mixColor } from "./motion"
import { useApp, type StudyTab } from "./state"
import { openHelp, openPalette } from "./dialogs"

const TABS: { id: StudyTab; label: string; key: string }[] = [
  { id: "notes", label: "Notes", key: "1" },
  { id: "commentary", label: "Commentary", key: "2" },
  { id: "words", label: "Words", key: "3" },
  { id: "ask", label: "Ask", key: "4" },
]

/**
 * The study desk's right-hand pane. It follows the reader's cursor verse: the Notes tab edits
 * that verse's note and the chapter's journal, the Commentary tab opens Henry on that verse,
 * the Words tab shows its Hebrew or Greek, and Ask answers questions about it.
 * `tab` moves the keyboard between the reader and the pane.
 */
export function StudyPane(props: { overlay?: boolean }) {
  const app = useApp()
  const dims = useTerminalDimensions()
  const t = () => app.theme()
  const width = () => Math.max(40, Math.min(app.config.studyWidth, dims().width - 40))
  const focused = app.studyFocused
  const [editing, setEditing] = createSignal<"verse" | "journal" | undefined>()
  // Text typed into Notes before the editor has the keyboard. The first key opens the editor;
  // keys that arrive before it takes focus (a fast typist, a paste) are added here, not lost.
  const [seed, setSeed] = createSignal<string | undefined>()
  // A tab switch (keyboard or mouse) ends any edit, so the new tab gets its keys.
  createEffect(on(app.studyTab, () => setEditing(undefined), { defer: true }))

  app.useKeys((key) => {
    if (!focused()) return false
    app.deps.tracker.activity()
    // commands work anywhere, as help promises, even mid-note or mid-question
    if (key.ctrl && key.name === "p") return openPalette(app), true
    // A tab with a text input (Ask) takes every key except moving focus away and its ctrl chords.
    if (captures?.()) {
      if (paneKeyEvent?.(key)) return true
      if (key.name === "tab" || (key.name === "escape" && !key.ctrl)) return app.setStudyFocused(false), true
      if (key.ctrl && key.name === "l") return app.setStudyOpen(false), app.setStudyFocused(false), true
      return !key.ctrl
    }
    if (editing()) {
      if (seed() !== undefined && !key.ctrl && !key.meta) {
        if (key.name === "backspace") return setSeed((s) => (s ?? "").slice(0, -1)), true
        if (key.name === "return") return setSeed((s) => `${s ?? ""}\n`), true
        if (key.sequence && [...key.sequence].length === 1 && key.name !== "escape" && key.name !== "tab") return setSeed((s) => `${s ?? ""}${key.sequence}`), true
      }
      // While typing, only escape and ctrl chords are ours; every other key belongs to the textarea.
      if (key.name === "escape") return setEditing(undefined), true
      if (key.ctrl && key.name === "c") return false
      return !key.ctrl
    }
    // escape steps back inside a tab first (a word study back to the verse's words)
    if (key.name === "escape" && paneKey?.("escape", key.sequence)) return true
    if (key.name === "tab" || key.name === "escape") return app.setStudyFocused(false), true
    // help works here as everywhere (outside a text box): ? is never the start of a note
    if (key.sequence === "?") return openHelp(app), true
    if (key.ctrl && key.name === "l") return app.setStudyOpen(false), app.setStudyFocused(false), true
    const tab = TABS.find((x) => x.key === key.name)
    if (tab) return app.setStudyTab(tab.id), true
    if (key.name === "[" || key.name === "]") {
      app.setConfig("studyWidth", Math.max(40, Math.min(120, app.config.studyWidth + (key.name === "]" ? -4 : 4))))
      return true
    }
    // reading keys still move the cursor, so the pane can follow along
    // ← → change chapter from any tab; n and p too, except in Notes, where they are letters to write
    if (key.name === "left" || key.name === "right") return (key.name === "right" ? app.next() : app.prev()), true
    if ((key.name === "n" || key.name === "p") && app.studyTab() !== "notes") return (key.name === "n" ? app.next() : app.prev()), true
    return paneKey?.(key.name, key.sequence) ?? false
  })
  let paneKey: ((name: string, sequence: string) => boolean) | undefined
  let paneKeyEvent: ((key: import("@opentui/core").KeyEvent) => boolean) | undefined
  let captures: (() => boolean) | undefined

  return (
    <box
      width={width()}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={t().backgroundPanel}
      {...(props.overlay ? { position: "absolute" as const, right: 0, top: 0, height: "100%" as const, zIndex: 1500 } : {})}
      border={["left"]}
      customBorderChars={{ ...LeftBar.customBorderChars, vertical: "│" }}
      borderColor={focused() ? t().primary : t().borderSubtle}
    >
      <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1} justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <For each={TABS}>
            {(tab) => {
              const active = () => app.studyTab() === tab.id
              return (
                <text
                  wrapMode="none"
                  bg={active() ? t().backgroundElement : TRANSPARENT}
                  fg={active() ? (focused() ? t().primary : t().text) : t().textMuted}
                  attributes={active() ? TextAttributes.BOLD : 0}
                  onMouseUp={() => {
                    app.setStudyTab(tab.id)
                    app.setStudyFocused(true)
                  }}
                >
                  {` ${tab.label} `}
                </text>
              )
            }}
          </For>
        </box>
        <Show when={width() >= 52}>
          <text fg={t().textMuted} wrapMode="none" paddingRight={1}>
            {focused() ? "tab back to text" : "tab study"}
          </text>
        </Show>
      </box>
      <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingRight={1} paddingTop={1}>
        <Show when={app.studyTab() === "notes"}>
          <NotesTab editing={editing()} setEditing={setEditing} seed={seed} setSeed={setSeed} register={(fn) => ((paneKey = fn), (captures = undefined), (paneKeyEvent = undefined))} />
        </Show>
        <Show when={app.studyTab() === "commentary"}>
          <CommentaryTab register={(fn) => ((paneKey = fn), (captures = undefined), (paneKeyEvent = undefined))} />
        </Show>
        <Show when={app.studyTab() === "words"}>
          <WordsTab register={(fn) => ((paneKey = fn), (captures = undefined), (paneKeyEvent = undefined))} />
        </Show>
        <Show when={app.studyTab() === "ask"}>
          <AskTab
            register={(r) => {
              paneKey = undefined
              paneKeyEvent = r.key
              captures = r.captures
            }}
          />
        </Show>
      </box>
    </box>
  )
}

// notes ------------------------------------------------------------------------------

function NotesTab(props: {
  editing: "verse" | "journal" | undefined
  setEditing: (v: "verse" | "journal" | undefined) => void
  seed: () => string | undefined
  setSeed: (v: string | undefined) => void
  register: (fn: (name: string, sequence: string) => boolean) => void
}) {
  const app = useApp()
  const t = () => app.theme()
  const verseKey = createMemo(() => {
    const p = app.position()
    return `${p.book}:${p.chapter}:${p.verse}`
  })
  const chapterKey = createMemo(() => {
    const p = app.position()
    return `${p.book}:${p.chapter}`
  })
  // a newcomer types straight away: any ordinary character starts the verse note with it
  props.register((name, sequence) => {
    if (name === "e" || name === "return") return props.setEditing("verse"), true
    if (name === "w") return props.setEditing("journal"), true
    if (sequence && [...sequence].length === 1 && /[\p{L}\p{N}\p{P}\p{S} ]/u.test(sequence)) {
      props.setSeed(sequence)
      props.setEditing("verse")
      return true
    }
    return false
  })
  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <Show when={verseKey()} keyed>
        {(key: string) => {
          const [b, c, v] = key.split(":").map(Number) as [number, number, number]
          return (
            <Editor
              title={`${app.ip("note")}${formatRef({ book: b, chapter: c, verseStart: v })}`}
              hint="type to write"
              load={() => app.deps.store.note({ book: b, chapter: c, verse: v })?.body ?? ""}
              placeholder="What is this verse saying to you?"
              height={8}
              active={props.editing === "verse" && app.studyFocused()}
              seed={() => {
                const s = props.seed()
                props.setSeed(undefined)
                return s
              }}
              onSave={(body) => {
                app.deps.store.saveNote({ book: b, chapter: c, verse: v }, body)
                app.bump()
              }}
            />
          )
        }}
      </Show>
      <Show when={chapterKey()} keyed>
        {(key: string) => {
          const [b, c] = key.split(":").map(Number) as [number, number]
          return (
            <Editor
              title={`${app.ip("book")}${bookById(b).name} ${c} journal`}
              hint="w to write"
              load={() => app.deps.store.journal(b, c)}
              placeholder="Thoughts on the whole chapter: what stood out, what to pray, what to do."
              grow
              active={props.editing === "journal" && app.studyFocused()}
              onSave={(body) => app.deps.store.saveJournal(b, c, body)}
            />
          )
        }}
      </Show>
      <Show when={app.studyFocused()}>
        <Hints
          hints={
            props.editing
              ? [{ key: "esc", label: "done" }]
              : [
                  { key: "type", label: "verse note" },
                  { key: "w", label: "journal" },
                  { key: "1-4", label: "tabs" },
                  { key: "[ ]", label: "width" },
                ]
          }
        />
      </Show>
    </box>
  )
}

/** A notes textarea that saves itself 600ms after the last keystroke, and on leaving. */
function Editor(props: {
  title: string
  hint: string
  /** Reads the saved text. Re-read whenever notes change elsewhere and this editor is idle. */
  load: () => string
  placeholder: string
  height?: number
  grow?: boolean
  active: boolean
  /** Text typed before the editor opened (the key that opened it), added at the end on opening. */
  seed?: () => string | undefined
  onSave: (body: string) => void
}) {
  const app = useApp()
  const t = () => app.theme()
  let area: TextareaRenderable | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const initial = props.load()
  let last = initial
  const [state, setState] = createSignal<"" | "editing" | "saved">("")
  // The latest text, captured on every change: by the time an unmount saves, the textarea
  // may already be destroyed, and reading it then would throw and lose the edit.
  let current = initial
  // what the preview shows: the saved text, kept in step with every edit and reload
  const [text, setText] = createSignal(initial)
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    const body = current
    if (body !== last) {
      props.onSave(body)
      last = body
      setState("saved")
    }
  }
  onCleanup(flush)
  // Someone else (the note dialog, a re-import) saved: show it, so an edit here never
  // starts from stale text and overwrites theirs.
  createEffect(
    on(
      app.rev,
      () => {
        if (props.active || !area || area.isDestroyed) return
        const fresh = props.load()
        if (fresh !== last && fresh !== current) {
          area.setText(fresh)
          last = fresh
          current = fresh
          setText(fresh)
        }
      },
      { defer: true },
    ),
  )
  createEffect(() => {
    if (!area || area.isDestroyed) return
    if (!props.active) {
      area.blur()
      flush()
    }
  })
  // Focus on the next tick (focusing inside the key event that asked for it would hand that very
  // key, "e", to the textarea as typed text), and again whenever a dialog over it closes.
  let placed = false
  app.useReturnFocus(
    () => {
      if (!area || area.isDestroyed || !props.active) return
      area.focus()
      // continue writing where the note ends, the first time; after a dialog, where the cursor was
      if (!placed) area.cursorOffset = area.plainText.length
      placed = true
      const s = props.seed?.()
      if (s) area.insertText(s)
    },
    () => props.active,
  )
  createEffect(() => !props.active && (placed = false))
  return (
    <box flexDirection="column" flexGrow={props.grow ? 1 : 0} flexShrink={props.grow ? 1 : 0}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={props.active ? t().primary : t().text} attributes={TextAttributes.BOLD} wrapMode="none">
          {props.title}
        </text>
        <text fg={t().textMuted} wrapMode="none">
          {state() === "saved" ? `${app.i("check")} saved` : props.active ? "autosaves" : props.hint}
        </text>
      </box>
      {/* Not editing: the note as Markdown. The textarea stays mounted (hidden) so reloads and
          saves keep working, and e brings it back with the raw text. */}
      <Show when={!props.active && text().trim()}>
        <scrollbox
          height={props.height}
          flexGrow={props.grow ? 1 : 0}
          minHeight={props.grow ? 4 : undefined}
          backgroundColor={t().backgroundElement}
          scrollbarOptions={{ visible: false }}
          paddingLeft={1}
          paddingRight={1}
        >
          <Markdown content={text()} />
        </scrollbox>
      </Show>
      <textarea
        visible={props.active || !text().trim()}
        ref={(r: TextareaRenderable) => (area = r)}
        initialValue={initial}
        placeholder={props.placeholder}
        placeholderColor={t().textMuted}
        textColor={t().text}
        focusedTextColor={t().text}
        backgroundColor={t().backgroundElement}
        focusedBackgroundColor={t().backgroundElement}
        cursorColor={t().primary}
        height={props.height}
        flexGrow={props.grow ? 1 : 0}
        minHeight={props.grow ? 4 : undefined}
        wrapMode="word"
        onContentChange={() => {
          if (area && !area.isDestroyed) current = area.plainText
          setText(current)
          setState("editing")
          clearTimeout(timer)
          timer = setTimeout(flush, 600)
        }}
      />
    </box>
  )
}

// commentary ---------------------------------------------------------------------------

function CommentaryTab(props: { register: (fn: (name: string, sequence: string) => boolean) => void }) {
  const app = useApp()
  const t = () => app.theme()
  const commentary = app.deps.commentary
  const [installed, setInstalled] = createSignal(!!commentary?.installed)
  const [progress, setProgress] = createSignal<number | undefined>()
  const [error, setError] = createSignal<string | undefined>()
  let scroll: ScrollBoxRenderable | undefined

  const chapter = createMemo(
    () => ({ book: app.position().book, chapter: app.position().chapter }),
    undefined,
    { equals: (a, b) => a.book === b.book && a.chapter === b.chapter },
  )
  const sections = createMemo(() => (installed() && commentary ? commentary.chapter(chapter().book, chapter().chapter) : []))
  const target = createMemo(() => {
    const v = app.position().verse
    const s = sections()
    let section = s.findIndex((x) => x.verseStart !== null && x.verseEnd !== null && v >= x.verseStart && v <= x.verseEnd)
    if (section === -1) section = Math.max(0, s.findLastIndex((x) => (x.verseStart ?? 0) <= v && x.verseStart !== null))
    const paragraph = s[section] ? Math.max(0, s[section]!.paragraphs.findIndex((p) => p.verses.includes(v))) : 0
    return { section, paragraph }
  })

  // Land on Henry's words about the cursor verse whenever it moves.
  createEffect(
    on(target, (tg) =>
      setTimeout(() => {
        if (!scroll || scroll.isDestroyed) return
        const el = scroll.content.findDescendantById(`cp-${tg.section}-${tg.paragraph}`) ?? scroll.content.findDescendantById(`cs-${tg.section}`)
        if (el) scroll.scrollTo(Math.max(0, el.y - scroll.content.y - 1))
      }, 0),
    ),
  )

  async function install() {
    if (!commentary || progress() !== undefined) return
    setError(undefined)
    setProgress(0)
    try {
      await installCommentary(commentary.db, app.deps.cacheDir ?? "/tmp", (e) =>
        setProgress(e.phase === "download" ? e.fraction * 0.8 : e.phase === "import" ? 0.85 : 1),
      )
      setInstalled(true)
      app.toast(`${app.ip("library")}Matthew Henry installed`, "1189 chapters of commentary, offline")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setProgress(undefined)
    }
  }

  props.register((name, sequence) => {
    if (!installed()) {
      if (name === "i" || name === "return") return void install(), true
      return false
    }
    if (!scroll) return false
    if (name === "j" || name === "down") return scroll.scrollBy(2), true
    if (name === "k" || name === "up") return scroll.scrollBy(-2), true
    if (name === "space" || name === "pagedown") return scroll.scrollBy(Math.max(4, scroll.viewport.height - 3)), true
    if (name === "pageup") return scroll.scrollBy(-Math.max(4, scroll.viewport.height - 3)), true
    if (name === "g" && sequence !== "G") return scroll.scrollTo(0), true
    return false
  })

  return (
    <Show
      when={installed()}
      fallback={
        <box flexDirection="column" gap={1}>
          <text fg={t().text} attributes={TextAttributes.BOLD}>
            {app.ip("library")}Matthew Henry's Commentary
          </text>
          <text fg={t().textMuted} wrapMode="word">
            The complete commentary on the whole Bible (1706–1721), verse by verse. About 14 MB, downloaded once, then offline.
          </text>
          <Show
            when={progress() !== undefined}
            fallback={
              <text wrapMode="none">
                <span style={{ fg: t().textMuted }}>press </span>
                <span style={{ fg: t().text }}>i</span>
                <span style={{ fg: t().textMuted }}> to install{app.studyFocused() ? "" : " (tab to focus this pane)"}</span>
              </text>
            }
          >
            <Bar fraction={progress()!} width={36} />
          </Show>
          <Show when={error()}>
            <text fg={t().error} wrapMode="word">
              {error()}
            </text>
          </Show>
        </box>
      }
    >
      {/* pinned: where Henry is, whatever the scroll position */}
      <box flexDirection="column" flexShrink={0} paddingBottom={1}>
        <text wrapMode="none" fg={t().textMuted}>
          On {formatRef({ book: chapter().book, chapter: chapter().chapter, verseStart: app.position().verse })}
        </text>
        <Show when={sections()[target().section]}>
          {(s: () => { heading: string; verseStart: number | null; verseEnd: number | null }) => (
            <text wrapMode="word" attributes={TextAttributes.BOLD} fg={t().text}>
              {s().heading}
              <Show when={s().verseStart !== null}>
                <span style={{ fg: t().textMuted, attributes: 0 }}>
                  {"  ·  "}v. {s().verseStart}
                  {s().verseEnd !== s().verseStart ? `–${s().verseEnd}` : ""}
                </span>
              </Show>
            </text>
          )}
        </Show>
      </box>
      <scrollbox ref={(r: ScrollBoxRenderable) => (scroll = r)} flexGrow={1} scrollbarOptions={{ visible: false }}>
        <For each={sections()}>
          {(s, si) => (
            <box id={`cs-${si()}`} flexDirection="column" paddingBottom={1}>
              <text wrapMode="word" attributes={TextAttributes.BOLD} fg={t().accent}>
                {s.heading}
                <Show when={s.verseStart !== null}>
                  <span style={{ fg: t().textMuted, attributes: 0 }}>
                    {"  "}v. {s.verseStart}
                    {s.verseEnd !== s.verseStart ? `–${s.verseEnd}` : ""}
                  </span>
                </Show>
              </text>
              <For each={s.paragraphs}>
                {(p, pi) => {
                  const here = () => target().section === si() && target().paragraph === pi() && p.verses.includes(app.position().verse)
                  return (
                    <box
                      id={`cp-${si()}-${pi()}`}
                      paddingTop={1}
                      {...LeftBar}
                      borderColor={here() ? t().primary : TRANSPARENT}
                      paddingLeft={1}
                    >
                      <text wrapMode="word">
                        <Inline text={p.body} fg={here() ? t().text : mixColor(t().backgroundPanel, t().text, 0.82)} />
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>
          )}
        </For>
        <text fg={t().textMuted} wrapMode="word" paddingTop={1}>
          {COMMENTARY_ATTRIBUTION}
        </text>
      </scrollbox>
    </Show>
  )
}

export type { JSX }
