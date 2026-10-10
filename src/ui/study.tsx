import { TextAttributes, type RGBA, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { bookById } from "../data/books"
import { COMMENTARY_ATTRIBUTION, installCommentary } from "../data/commentary"
import { formatRef } from "../data/ref"
import { Bar, Hints, LeftBar, TRANSPARENT } from "./components/primitives"
import { mixColor } from "./motion"
import { useApp, type StudyTab } from "./state"

const TABS: { id: StudyTab; label: string; key: string }[] = [
  { id: "notes", label: "Notes", key: "1" },
  { id: "commentary", label: "Commentary", key: "2" },
]

/**
 * The study desk's right-hand pane. It follows the reader's cursor verse: the Notes tab edits
 * that verse's note and the chapter's journal, the Commentary tab opens Henry on that verse.
 * `tab` moves the keyboard between the reader and the pane.
 */
export function StudyPane(props: { overlay?: boolean }) {
  const app = useApp()
  const dims = useTerminalDimensions()
  const t = () => app.theme()
  const width = () => Math.max(40, Math.min(app.config.studyWidth, dims().width - 40))
  const focused = app.studyFocused
  const [editing, setEditing] = createSignal<"verse" | "journal" | undefined>()

  app.useKeys((key) => {
    if (!focused()) return false
    app.deps.tracker.activity()
    if (editing()) {
      // While typing, only escape and ctrl chords are ours; every other key belongs to the textarea.
      if (key.name === "escape") return setEditing(undefined), true
      if (key.ctrl && key.name === "c") return false
      return !key.ctrl
    }
    if (key.name === "tab" || key.name === "escape") return app.setStudyFocused(false), true
    if (key.ctrl && key.name === "l") return app.setStudyOpen(false), app.setStudyFocused(false), true
    const tab = TABS.find((x) => x.key === key.name)
    if (tab) return app.setStudyTab(tab.id), true
    if (key.name === "[" || key.name === "]") {
      app.setConfig("studyWidth", Math.max(40, Math.min(120, app.config.studyWidth + (key.name === "]" ? -4 : 4))))
      return true
    }
    // reading keys still move the cursor, so the pane can follow along
    if (key.name === "n" || key.name === "p") return (key.name === "n" ? app.next() : app.prev()), true
    return paneKey?.(key.name, key.sequence) ?? false
  })
  let paneKey: ((name: string, sequence: string) => boolean) | undefined

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
        <text fg={t().textMuted} wrapMode="none" paddingRight={1}>
          {focused() ? "tab reader" : "tab study"}
        </text>
      </box>
      <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingRight={1} paddingTop={1}>
        <Show when={app.studyTab() === "notes"}>
          <NotesTab editing={editing()} setEditing={setEditing} register={(fn) => (paneKey = fn)} />
        </Show>
        <Show when={app.studyTab() === "commentary"}>
          <CommentaryTab register={(fn) => (paneKey = fn)} />
        </Show>
      </box>
    </box>
  )
}

// notes ------------------------------------------------------------------------------

function NotesTab(props: {
  editing: "verse" | "journal" | undefined
  setEditing: (v: "verse" | "journal" | undefined) => void
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
  props.register((name) => {
    if (name === "e" || name === "return") return props.setEditing("verse"), true
    if (name === "w") return props.setEditing("journal"), true
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
              hint="e to write"
              initial={app.deps.store.note({ book: b, chapter: c, verse: v })?.body ?? ""}
              placeholder="What is this verse saying to you?"
              height={8}
              active={props.editing === "verse" && app.studyFocused()}
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
              initial={app.deps.store.journal(b, c)}
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
                  { key: "e", label: "verse note" },
                  { key: "w", label: "journal" },
                  { key: "1 2", label: "tabs" },
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
  initial: string
  placeholder: string
  height?: number
  grow?: boolean
  active: boolean
  onSave: (body: string) => void
}) {
  const app = useApp()
  const t = () => app.theme()
  let area: TextareaRenderable | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = props.initial
  const [state, setState] = createSignal<"" | "editing" | "saved">("")
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    const body = area?.plainText ?? last
    if (body !== last) {
      props.onSave(body)
      last = body
      setState("saved")
    }
  }
  onCleanup(flush)
  createEffect(() => {
    if (!area || area.isDestroyed) return
    // Focus on the next tick: focusing inside the key event that asked for it would hand that
    // very key ("e") to the textarea as typed text.
    if (props.active) setTimeout(() => area && !area.isDestroyed && area.focus(), 0)
    else {
      area.blur()
      flush()
    }
  })
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
      <textarea
        ref={(r: TextareaRenderable) => (area = r)}
        initialValue={props.initial}
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
          setState("editing")
          clearTimeout(timer)
          timer = setTimeout(flush, 600)
        }}
      />
    </box>
  )
}

// commentary ---------------------------------------------------------------------------

/** *italic* and **bold** from Henry's Markdown, nothing more. */
function Inline(props: { text: string; fg: RGBA }) {
  const parts = () => props.text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean)
  return (
    <For each={parts()}>
      {(p) =>
        p.startsWith("**") ? (
          <span style={{ fg: props.fg, attributes: TextAttributes.BOLD }}>{p.slice(2, -2)}</span>
        ) : p.startsWith("*") ? (
          <span style={{ fg: props.fg, attributes: TextAttributes.ITALIC }}>{p.slice(1, -1)}</span>
        ) : (
          <span style={{ fg: props.fg }}>{p}</span>
        )
      }
    </For>
  )
}

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
