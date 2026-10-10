import { TextAttributes, type InputRenderable, type KeyEvent, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { EventType, pickAgent, type AgentEvent, type AgentProvider } from "../agent"
import { bookById } from "../data/books"
import { findBook, formatRef, type Ref } from "../data/ref"
import { SelectDialog } from "./components/dialog"
import { Inline } from "./components/inline"
import { LeftBar, TRANSPARENT } from "./components/primitives"
import { plain } from "./components/verse"
import { mixColor } from "./motion"
import { useApp } from "./state"

export interface AskTool {
  id: string
  name: string
  args: string
  result?: string
}

export interface AskSuggestion {
  reference: string
  note: string
  accepted?: boolean
}

export type AskMessage =
  | { role: "user"; text: string; at: number }
  | { role: "assistant"; text: string; tools: AskTool[]; suggestions: AskSuggestion[]; error?: string; provider: string; at: number }

/** Folds one AG-UI event into the answer being built. Pure, so the mapping is testable. */
export function applyEvent(msg: Extract<AskMessage, { role: "assistant" }>, e: AgentEvent) {
  switch (e.type) {
    case EventType.TEXT_MESSAGE_CONTENT:
      msg.text += e.delta
      break
    case EventType.TEXT_MESSAGE_START:
      // a new text block after tool calls starts a new paragraph
      if (msg.text && !msg.text.endsWith("\n")) msg.text += "\n\n"
      break
    case EventType.TOOL_CALL_START:
      if (e.toolCallName !== "ToolSearch") msg.tools.push({ id: e.toolCallId, name: e.toolCallName, args: "" })
      break
    case EventType.TOOL_CALL_ARGS: {
      const t = msg.tools.find((x) => x.id === e.toolCallId)
      if (t) t.args += e.delta
      break
    }
    case EventType.TOOL_CALL_RESULT: {
      const t = msg.tools.find((x) => x.id === e.toolCallId)
      if (!t) break
      t.result = e.content
      // Only a suggestion the tool accepted is offered; a failed call (no verse, a bad
      // reference) would otherwise sit at the top of ctrl+k forever.
      if (t.name === "suggest_note" && !e.isError) {
        try {
          const a = JSON.parse(t.args) as { reference?: string; note?: string }
          if (a.reference && a.note?.trim() && parseVerse(a.reference)) msg.suggestions.push({ reference: a.reference, note: a.note.trim() })
        } catch {
          // a malformed suggestion is simply not offered
        }
      }
      break
    }
    case EventType.RUN_ERROR:
      msg.error = e.message
      break
  }
}

/** A short label for what the agent did, shown as a chip above the answer. */
export function toolLabel(t: AskTool, ip: (name: "book" | "search" | "quote" | "note" | "history" | "light" | "list") => string): string {
  let a: Record<string, unknown> = {}
  try {
    a = JSON.parse(t.args || "{}")
  } catch {
    // arguments still streaming
  }
  const q = (v: unknown) => (v ? `“${String(v)}”` : "")
  switch (t.name) {
    case "get_passage":
      return `${ip("book")}read ${a.reference ?? "a passage"}`
    case "search_bible":
      return `${ip("search")}searched ${q(a.query)}`
    case "get_commentary":
      return `${ip("quote")}Henry on ${a.reference ?? "this"}`
    case "search_commentary":
      return `${ip("quote")}searched Henry for ${q(a.query)}`
    case "get_notes":
      return `${ip("note")}read your notes`
    case "reading_context":
      return `${ip("history")}checked what you are reading`
    case "suggest_note":
      return `${ip("note")}suggested a note`
    case "WebSearch":
    case "web_search":
      return `${ip("light")}searched the web ${q(a.query)}`
    case "WebFetch":
      return `${ip("light")}read ${String(a.url ?? "a page").replace(/^https?:\/\//, "").slice(0, 32)}`
    default:
      return `${ip("list")}${t.name}`
  }
}

const REF = /\b((?:[1-3]\s?)?[A-Z][a-z]+(?:\s(?:of\s)?[A-Z][a-z]+)?)\.?\s(\d{1,3}):(\d{1,3})(?:\s?[–-]\s?(\d{1,3}))?((?:,\s?\d{1,3}:\d{1,3}(?:[–-]\d{1,3})?)*)/g

/** Every Bible reference an answer cites, in order, without repeats: "John 7:50–51", "(John 3:4, 3:9)". */
export function citedRefs(text: string): Ref[] {
  const out: Ref[] = []
  const seen = new Set<string>()
  const add = (r: Ref) => {
    const k = `${r.book}:${r.chapter}:${r.verseStart}`
    if (!seen.has(k) && r.chapter <= bookById(r.book).chapters) {
      seen.add(k)
      out.push(r)
    }
  }
  for (const m of text.matchAll(REF)) {
    // "Later John 7:50": a capitalised word before the book is not part of its name.
    const words = m[1]!.split(/\s+/)
    const book = findBook(m[1]!) ?? findBook(words.slice(-2).join(" ")) ?? findBook(words.at(-1)!)
    if (!book) continue
    add({ book: book.id, chapter: Number(m[2]), verseStart: Number(m[3]), verseEnd: m[4] ? Number(m[4]) : Number(m[3]) })
    for (const c of (m[5] ?? "").matchAll(/(\d{1,3}):(\d{1,3})(?:[–-](\d{1,3}))?/g)) {
      add({ book: book.id, chapter: Number(c[1]), verseStart: Number(c[2]), verseEnd: c[3] ? Number(c[3]) : Number(c[2]) })
    }
  }
  return out
}

/**
 * The Ask tab: questions about the open chapter, answered by the reader's own Claude Code or
 * Codex using Selah's tools. One conversation per chapter, kept in user.db.
 */
export function AskTab(props: { register: (r: { key: (k: KeyEvent) => boolean; captures: () => boolean }) => void }) {
  const app = useApp()
  const t = () => app.theme()
  const chapter = createMemo(
    () => ({ book: app.position().book, chapter: app.position().chapter }),
    undefined,
    { equals: (a, b) => a.book === b.book && a.chapter === b.chapter },
  )
  const [thread, setThread] = createStore<{ messages: AskMessage[]; sessionId?: string; provider?: string }>({ messages: [] })
  const [running, setRunning] = createSignal(false)
  const [elapsed, setElapsed] = createSignal(0)
  const [agent, setAgent] = createSignal<AgentProvider | undefined>()
  const [detected, setDetected] = createSignal(false)
  /**
   * The answer in flight. A run belongs to the chapter it was asked on: when the reader clears
   * the thread or moves to another chapter, the run is detached, so its last events and its
   * cleanup can never land on a thread they do not belong to.
   */
  type Run = {
    key: { book: number; chapter: number }
    controller: AbortController
    /** The run's own copy of the conversation, kept whether or not it is on screen. */
    messages: AskMessage[]
    answer: Extract<AskMessage, { role: "assistant" }>
    index: number
    sessionId?: string
    provider: string
    /** why it stopped belonging to the visible thread */
    detached?: "cleared" | "moved"
  }
  let run: Run | undefined
  const detach = (why: "cleared" | "moved") => {
    if (!run) return
    run.detached = why
    run.controller.abort()
    // Saved now, not only when the agent winds down: a provider slow to honour the abort must
    // not lose the answer so far.
    if (why === "moved") {
      run.answer.error ??= "Stopped"
      app.deps.store.saveAskThread(run.key.book, run.key.chapter, run.provider, run.sessionId, run.messages)
    }
    run = undefined
    setRunning(false)
  }
  let input: InputRenderable | undefined
  let scroll: ScrollBoxRenderable | undefined

  // Find the reader's agents once.
  void (async () => {
    const choice = app.deps.agents ? await app.deps.agents() : undefined
    if (choice) setAgent(pickAgent(choice, app.config.agent))
    setDetected(true)
  })()

  // Each chapter has its own conversation.
  createEffect(
    on(chapter, (c) => {
      detach("moved")
      const saved = app.deps.store.askThread<AskMessage>(c.book, c.chapter)
      setThread({ messages: saved?.messages ?? [], sessionId: saved?.sessionId, provider: saved?.provider })
      setTimeout(() => scroll && !scroll.isDestroyed && scroll.scrollTo(scroll.scrollHeight), 0)
    }),
  )
  const persist = () => {
    const c = chapter()
    app.deps.store.saveAskThread(c.book, c.chapter, thread.provider ?? agent()?.id ?? "", thread.sessionId, thread.messages.slice())
  }

  const focusInput = () => setTimeout(() => input && !input.isDestroyed && app.studyFocused() && input.focus(), 0)
  createEffect(() => {
    if (app.studyFocused()) focusInput()
    else input?.blur()
  })
  onCleanup(() => detach("moved"))

  const timer = setInterval(() => running() && setElapsed((n) => n + 1), 1000)
  onCleanup(() => clearInterval(timer))

  async function ask(question: string) {
    const a = agent()
    const q = question.trim()
    if (!a || !q || running()) return
    input?.setText?.("")
    const c = chapter()
    const p = app.position()
    const verse = app.deps.bible.verses(app.translation(), { book: p.book, chapter: p.chapter, verseStart: p.verse })[0]
    const context = `[The reader has ${formatRef({ book: c.book, chapter: c.chapter })} open in ${app.translation()}, at verse ${p.verse}${verse ? `: "${plain(verse.text)}"` : ""}.]`
    const history = thread.messages.map((m) => ({ role: m.role, text: m.text }))
    const resumable = thread.provider === a.id ? thread.sessionId : undefined
    const user: AskMessage = { role: "user", text: q, at: app.now() }
    const answer: Extract<AskMessage, { role: "assistant" }> = { role: "assistant", text: "", tools: [], suggestions: [], provider: a.label, at: app.now() }
    const r: Run = {
      key: c,
      controller: new AbortController(),
      messages: [...structuredClone(unwrap(thread.messages)), user, answer],
      answer,
      index: thread.messages.length + 1,
      sessionId: resumable,
      provider: a.id,
    }
    run = r
    setThread(produce((s) => s.messages.push(structuredClone(user), structuredClone(answer))))
    setRunning(true)
    setElapsed(0)
    const visible = () => run === r
    const update = (f: (m: Extract<AskMessage, { role: "assistant" }>) => void) => {
      f(r.answer)
      if (visible()) setThread(produce((s) => f(s.messages[r.index] as Extract<AskMessage, { role: "assistant" }>)))
    }
    try {
      for await (const e of a.run({ prompt: `${context}\n\n${q}`, history, sessionId: resumable, threadId: `${c.book}:${c.chapter}`, signal: r.controller.signal })) {
        if (r.controller.signal.aborted) break
        update((m) => applyEvent(m, e))
        if (e.type === EventType.RUN_FINISHED && e.result?.sessionId) {
          r.sessionId = e.result.sessionId
          if (visible()) setThread({ sessionId: e.result.sessionId, provider: a.id })
        }
        if (visible()) setTimeout(() => scroll && !scroll.isDestroyed && scroll.scrollTo(scroll.scrollHeight), 0)
      }
    } catch (err) {
      update((m) => (m.error = err instanceof Error ? err.message : String(err)))
    } finally {
      if (r.controller.signal.aborted) update((m) => (m.error ??= "Stopped"))
      if (visible()) {
        run = undefined
        setRunning(false)
        persist()
      } else if (r.detached === "moved") {
        // The reader went to another chapter: the answer so far is kept on its own chapter.
        app.deps.store.saveAskThread(r.key.book, r.key.chapter, r.provider, r.sessionId, r.messages)
      }
      // "cleared": the reader threw this conversation away; nothing is written back.
    }
  }

  const lastAnswer = () => [...thread.messages].reverse().find((m): m is Extract<AskMessage, { role: "assistant" }> => m.role === "assistant" && !!m.text)
  const pending = () => {
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      const m = thread.messages[i]!
      if (m.role !== "assistant") continue
      // threads saved before suggestions were validated may hold one that names no verse
      const j = m.suggestions.findIndex((s) => !s.accepted && parseVerse(s.reference))
      if (j >= 0) return { i, j, s: m.suggestions[j]! }
    }
  }

  function acceptSuggestion() {
    const p = pending()
    if (!p) return app.toast("No suggested note to accept")
    const ref = parseVerse(p.s.reference)
    if (!ref) return app.toast("That suggestion names no verse", undefined, "warning")
    const existing = app.deps.store.note(ref)?.body
    app.deps.store.saveNote(ref, existing ? `${existing}\n\n${p.s.note}` : p.s.note)
    setThread(produce((s) => ((s.messages[p.i] as Extract<AskMessage, { role: "assistant" }>).suggestions[p.j]!.accepted = true)))
    persist()
    app.bump()
    app.toast(`${app.ip("note")}Note saved on ${formatRef({ ...ref, verseStart: ref.verse })}`)
  }

  function saveAnswer() {
    const a = lastAnswer()
    if (!a) return app.toast("Nothing to save yet")
    const p = app.position()
    const existing = app.deps.store.note(p)?.body
    const body = `${a.text.trim()}\n\n(${a.provider}, ${new Date(a.at).toISOString().slice(0, 10)})`
    app.deps.store.saveNote(p, existing ? `${existing}\n\n${body}` : body)
    app.bump()
    app.toast(`${app.ip("note")}Answer saved as a note on ${formatRef({ book: p.book, chapter: p.chapter, verseStart: p.verse })}`)
  }

  function openReferences() {
    const a = lastAnswer()
    const refs = a ? citedRefs(a.text) : []
    if (!refs.length) return app.toast("The last answer cites no references")
    app.openDialog(() => (
      <SelectDialog
        title="References in the answer"
        placeholder="Open a reference"
        items={refs.map((r, i) => {
          const v = app.deps.bible.verses(app.translation(), r)[0]
          return { id: `r${i}`, title: formatRef(r), description: v ? plain(v.text).slice(0, 56) : "", value: r }
        })}
        onSelect={(item) => {
          app.closeAllDialogs()
          app.setStudyFocused(false)
          app.goTo(item.value)
        }}
      />
    ))
  }

  function clear() {
    detach("cleared")
    setThread({ messages: [], sessionId: undefined, provider: undefined })
    persist()
  }

  props.register({
    captures: () => !!agent(),
    key: (k) => {
      if (k.name === "escape" && running()) return run?.controller.abort(), true
      if (k.ctrl && k.name === "s") return saveAnswer(), true
      if (k.ctrl && k.name === "r") return openReferences(), true
      if (k.ctrl && k.name === "k") return acceptSuggestion(), true
      if (k.ctrl && k.name === "x") return clear(), true
      return false
    },
  })

  const muted = () => mixColor(t().backgroundPanel, t().text, 0.55)

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0} paddingBottom={1}>
        <text wrapMode="none" fg={t().textMuted}>
          {app.ip("light")}
          {agent() ? `${agent()!.label} on ${bookById(chapter().book).name} ${chapter().chapter}` : "Ask"}
        </text>
        <Show when={running()}>
          <text wrapMode="none" fg={t().primary}>
            {"◐◓◑◒"[elapsed() % 4]} thinking {elapsed()}s · esc stop
          </text>
        </Show>
      </box>

      <Show
        when={agent()}
        fallback={
          <box flexDirection="column" gap={1}>
            <text fg={t().text} attributes={TextAttributes.BOLD} wrapMode="word">
              Ask questions about what you are reading
            </text>
            <text fg={t().textMuted} wrapMode="word">
              {detected()
                ? "Ask uses your own Claude Code or Codex, with your existing login. Neither was found on your PATH. Install one (claude.com/claude-code or the codex CLI), sign in once, and reopen this tab."
                : "Looking for Claude Code or Codex…"}
            </text>
          </box>
        }
      >
        <scrollbox ref={(r: ScrollBoxRenderable) => (scroll = r)} flexGrow={1} scrollbarOptions={{ visible: false }}>
          <Show when={!thread.messages.length}>
            <text fg={t().textMuted} wrapMode="word">
              Ask anything about {bookById(chapter().book).name} {chapter().chapter}. Who was this written to? What does this word mean? How does Henry read it? Answers cite the text, and you can open every reference.
            </text>
          </Show>
          <For each={thread.messages}>
            {(m) => (
              <Show
                when={m.role === "assistant"}
                fallback={
                  <box {...LeftBar} borderColor={t().primary} paddingLeft={1} marginTop={1}>
                    <text fg={t().text} attributes={TextAttributes.BOLD} wrapMode="word">
                      {m.text}
                    </text>
                  </box>
                }
              >
                {(() => {
                  const a = m as Extract<AskMessage, { role: "assistant" }>
                  return (
                    <box flexDirection="column" paddingTop={1}>
                      <Show when={a.tools.length}>
                        <box flexDirection="row" flexWrap="wrap" columnGap={1}>
                          <For each={a.tools}>
                            {(tool) => (
                              <text wrapMode="none" fg={muted()} bg={t().backgroundElement}>
                                {` ${toolLabel(tool, app.ip)} `}
                              </text>
                            )}
                          </For>
                        </box>
                      </Show>
                      <For each={a.text.split(/\n{2,}/).filter((x) => x.trim())}>
                        {(para) => (
                          <text wrapMode="word" paddingTop={1}>
                            <Inline text={para.replace(/^#+\s*/gm, "").replace(/^\s*[-*]\s+/gm, "• ")} fg={t().text} />
                          </text>
                        )}
                      </For>
                      <For each={a.suggestions}>
                        {(s) => (
                          <box {...LeftBar} borderColor={s.accepted ? t().success : t().accent} paddingLeft={1} marginTop={1} backgroundColor={t().backgroundElement}>
                            <text wrapMode="word">
                              <span style={{ fg: t().accent }}>
                                {app.ip("note")}Suggested note on {s.reference}
                                {"\n"}
                              </span>
                              <span style={{ fg: t().text }}>{s.note}</span>
                              <span style={{ fg: s.accepted ? t().success : t().textMuted }}>{s.accepted ? "\nsaved" : "\nctrl+k to keep"}</span>
                            </text>
                          </box>
                        )}
                      </For>
                      <Show when={a.error}>
                        <text fg={t().error} wrapMode="word" paddingTop={1}>
                          {a.error}
                        </text>
                      </Show>
                      <Show when={a.text && citedRefs(a.text).length}>
                        <text fg={t().textMuted} wrapMode="word" paddingTop={1}>
                          {citedRefs(a.text)
                            .slice(0, 8)
                            .map((r) => formatRef(r, { short: true }))
                            .join(" · ")}
                          {"  ctrl+r open"}
                        </text>
                      </Show>
                    </box>
                  )
                })()}
              </Show>
            )}
          </For>
        </scrollbox>
        <box flexShrink={0} paddingTop={1}>
          <box {...LeftBar} borderColor={app.studyFocused() ? t().primary : t().borderSubtle} backgroundColor={t().backgroundElement} paddingLeft={1}>
            <input
              ref={(r: InputRenderable) => (input = r)}
              placeholder={running() ? "…" : `Ask about ${bookById(chapter().book).name} ${chapter().chapter}`}
              placeholderColor={t().textMuted}
              textColor={t().text}
              focusedTextColor={t().text}
              backgroundColor={t().backgroundElement}
              focusedBackgroundColor={t().backgroundElement}
              cursorColor={t().primary}
              onSubmit={((v: unknown) =>
                void ask(typeof v === "string" ? v : (input?.value ?? "")).catch((err) =>
                  app.toast(`Ask failed: ${err instanceof Error ? err.message : String(err)}`, undefined, "error"),
                )) as never}
            />
          </box>
          <text fg={t().textMuted} wrapMode="none">
            enter ask · ctrl+r refs · ctrl+k keep note · ctrl+s save answer · ctrl+x clear
          </text>
        </box>
      </Show>
    </box>
  )
}

/** "John 3:16" → a verse that exists, or undefined. */
export function parseVerse(reference: string): { book: number; chapter: number; verse: number } | undefined {
  const m = /^(.*?)\s(\d+):(\d+)/.exec(reference.trim())
  const book = m && findBook(m[1]!)
  if (!book || !m) return undefined
  const chapter = Number(m[2])
  const verse = Number(m[3])
  return chapter >= 1 && chapter <= book.chapters && verse >= 1 ? { book: book.id, chapter, verse } : undefined
}

export { TRANSPARENT }
