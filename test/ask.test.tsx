// The Ask tab (HAL-2584), driven by a scripted AG-UI agent in the test renderer.
import { afterEach, describe, expect, test } from "bun:test"
import { EventType, type AgentEvent, type AgentProvider, type AskInput } from "../src/agent/provider"
import { UserStore } from "../src/data/user"
import type { AskMessage } from "../src/ui/ask"
import { harness, type Harness } from "./harness"

let h: Harness | undefined
afterEach(() => {
  h?.destroy()
  h = undefined
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const tick = async (hh: Harness, ms = 40) => {
  await wait(ms)
  await hh.settle()
}

/** An agent that replays a script; `gate` holds it mid-answer until released. */
function fakeAgent(script: AgentEvent[], seen: AskInput[] = [], gate?: Promise<void>): AgentProvider {
  return {
    id: "fake",
    label: "Fake Claude",
    async *run(input) {
      seen.push(input)
      for (const [i, e] of script.entries()) {
        if (gate && i === Math.floor(script.length / 2)) await gate
        if (input.signal.aborted) return
        yield e
      }
    },
  }
}

const answer: AgentEvent[] = [
  { type: EventType.RUN_STARTED, threadId: "t", runId: "r" },
  { type: EventType.TOOL_CALL_START, toolCallId: "c1", toolCallName: "search_bible" },
  { type: EventType.TOOL_CALL_ARGS, toolCallId: "c1", delta: '{"query":"Nicodemus"}' },
  { type: EventType.TOOL_CALL_END, toolCallId: "c1" },
  { type: EventType.TOOL_CALL_RESULT, messageId: "x", toolCallId: "c1", content: "John 3:1 …" },
  { type: EventType.TEXT_MESSAGE_START, messageId: "m" },
  { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "Nicodemus was a Pharisee (John 3:1). " },
  { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "He defends Jesus in John 7:50–51 and helps bury him in John 19:39." },
  { type: EventType.TEXT_MESSAGE_END, messageId: "m" },
  { type: EventType.TOOL_CALL_START, toolCallId: "c2", toolCallName: "suggest_note" },
  { type: EventType.TOOL_CALL_ARGS, toolCallId: "c2", delta: '{"reference":"John 3:2","note":"He came by night, but he came."}' },
  { type: EventType.TOOL_CALL_END, toolCallId: "c2" },
  { type: EventType.TOOL_CALL_RESULT, messageId: "y", toolCallId: "c2", content: "Suggested a note on John 3:2 for the reader to accept." },
  { type: EventType.RUN_FINISHED, threadId: "t", runId: "r", result: { sessionId: "sess-1" } },
]

async function openAsk(opts: Parameters<typeof harness>[0]) {
  const hh = await harness({ width: 200, height: 48, initial: { route: "reader", book: 43, chapter: 3, verse: 1 }, ...opts })
  await hh.press("tab")
  await hh.press("4")
  await tick(hh)
  return hh
}

describe("Ask tab", () => {
  test("without Claude Code or Codex it says how to get one", async () => {
    h = await openAsk({})
    expect(h.frame()).toContain("Ask questions about what you are reading")
    expect(h.frame()).toContain("Neither was found on your PATH")
  })

  test("if finding an agent fails, Ask says so instead of searching forever", async () => {
    h = await openAsk({ agents: async () => Promise.reject(new Error("SDK failed to load")) })
    await tick(h)
    expect(h.frame()).not.toContain("Looking for Claude Code or Codex")
    expect(h.frame()).toContain("Ask could not start: SDK failed to load")
  })

  test("streams an answer with tool chips, references and a suggested note", async () => {
    const seen: AskInput[] = []
    const store = UserStore.memory()
    h = await openAsk({ agents: [fakeAgent(answer, seen)], store })
    expect(h.frame()).toContain("Fake Claude on John 3")
    await h.type("Who is Nicodemus?")
    await h.press("return")
    await tick(h, 80)
    const f = h.frame()
    expect(f).toContain("Who is Nicodemus?")
    expect(f).toContain("searched “Nicodemus”")
    expect(f).toContain("Nicodemus was a Pharisee (John 3:1).")
    expect(f).toContain("Suggested note on John 3:2")
    expect(f).toMatch(/John 3:1 · John 7:50–51 · John 19:39/)
    // the agent saw the passage and verse the reader is on
    expect(seen[0]!.prompt).toContain("open in KJV, at verse 1")
    expect(seen[0]!.prompt).toContain("There was a man of the Pharisees")
    // ctrl+k keeps the suggestion as a real note
    await h.press("k", { ctrl: true })
    expect(store.note({ book: 43, chapter: 3, verse: 2 })?.body).toBe("He came by night, but he came.")
    expect(h.frame()).toContain("saved")
  })

  test("ctrl+r lists the answer's references and opens one in the reader", async () => {
    h = await openAsk({ agents: [fakeAgent(answer)] })
    await h.type("Who is Nicodemus?")
    await h.press("return")
    await tick(h, 80)
    await h.press("r", { ctrl: true })
    expect(h.frame()).toContain("References in the answer")
    await h.press("down")
    await h.press("return")
    expect(h.frame()).toContain("John 7 · KJV")
    expect(h.frame()).toContain("verse 50/53")
  })

  test("a follow-up resumes the provider session, and the thread persists per chapter", async () => {
    const seen: AskInput[] = []
    const store = UserStore.memory()
    h = await openAsk({ agents: [fakeAgent(answer, seen)], store })
    await h.type("Who is Nicodemus?")
    await h.press("return")
    await tick(h, 80)
    await h.type("And Joseph of Arimathea?")
    await h.press("return")
    await tick(h, 80)
    expect(seen[1]!.sessionId).toBe("sess-1")
    expect(seen[1]!.history.map((m) => m.role)).toEqual(["user", "assistant"])
    const saved = store.askThread<{ role: string; text: string }>(43, 3)!
    expect(saved.messages.filter((m) => m.role === "user").map((m) => m.text)).toEqual(["Who is Nicodemus?", "And Joseph of Arimathea?"])
    expect(saved.sessionId).toBe("sess-1")
  })

  test("esc stops a running answer", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    h = await openAsk({ agents: [fakeAgent(answer, [], gate)] })
    await h.type("Who is Nicodemus?")
    await h.press("return")
    await tick(h, 60)
    expect(h.frame()).toContain("thinking")
    await h.press("escape")
    release()
    await tick(h, 60)
    expect(h.frame()).toContain("Stopped")
    expect(h.frame()).not.toContain("thinking")
  })

  // the Words header's sibling: a narrow pane must not paint "thinking" over the agent's name
  test.each([64, 80])("mid-answer, the header keeps the agent's name and the thinking line whole at %i columns", async (width) => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    h = await openAsk({ agents: [fakeAgent(answer, [], gate)], width, height: 36 })
    await h.type("Who is Nicodemus?")
    await h.press("return")
    await tick(h, 60)
    const f = h.frame()
    expect(f).toContain("Fake Claude on John 3")
    expect(f).toMatch(/thinking \d+s · esc stop/)
    release()
    await tick(h, 60)
  })

  test("ctrl+x mid-answer clears the thread and Ask keeps working", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const seen: AskInput[] = []
    const store = UserStore.memory()
    h = await openAsk({ agents: [fakeAgent(answer, seen, gate)], store })
    await h.type("Who is Nicodemus?")
    await h.press("return")
    await tick(h, 60)
    expect(h.frame()).toContain("thinking")
    await h.press("x", { ctrl: true })
    release()
    await tick(h, 80)
    expect(h.frame()).not.toContain("thinking")
    expect(h.frame()).not.toContain("Who is Nicodemus?")
    expect(store.askThread(43, 3)?.messages ?? []).toEqual([]) // the old run wrote nothing back
    // and the tab is not stuck: a new question runs
    await h.type("Who wrote John?")
    await h.press("return")
    await tick(h, 80)
    expect(seen).toHaveLength(2)
    expect(h.frame()).toContain("Nicodemus was a Pharisee")
  })

  test("moving to another chapter mid-answer keeps that answer on its own chapter", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const store = UserStore.memory()
    h = await openAsk({ agents: [fakeAgent(answer, [], gate)], store })
    await h.type("Who is Nicodemus?")
    await h.press("return")
    await tick(h, 60)
    await h.press("tab") // back to the reader
    await h.press("n") // John 4
    await tick(h, 60)
    release()
    await tick(h, 80)
    expect(h.frame()).toContain("John 4 · KJV")
    expect(h.frame()).not.toContain("Stopped")
    expect(h.frame()).not.toContain("Who is Nicodemus?")
    expect(store.askThread(43, 4)?.messages ?? []).toEqual([])
    const john3 = store.askThread<AskMessage>(43, 3)!.messages
    expect(john3.map((m) => m.role)).toEqual(["user", "assistant"])
    expect(john3[0]!.text).toBe("Who is Nicodemus?")
    expect((john3[1] as { error?: string }).error).toBe("Stopped")
  })

  test("coming back and clearing is never undone by the old run winding down", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const store = UserStore.memory()
    h = await openAsk({ agents: [fakeAgent(answer, [], gate)], store })
    await h.type("Who is Nicodemus?")
    await h.press("return")
    await tick(h, 60)
    await h.press("tab")
    await h.press("n") // away to John 4…
    await tick(h, 40)
    await h.press("p") // …and back to John 3
    await tick(h, 40)
    expect(h.frame()).toContain("Who is Nicodemus?") // the answer so far was kept
    await h.press("tab")
    await h.press("x", { ctrl: true })
    release() // the old run only now winds down
    await tick(h, 80)
    expect(store.askThread(43, 3)?.messages ?? []).toEqual([])
  })

  test("moving away mid-answer keeps the thread's earlier provider session", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const store = UserStore.memory()
    store.saveAskThread(43, 3, "claude", "claude-session", [{ role: "user", text: "Earlier", at: 0 }, { role: "assistant", text: "Before.", tools: [], suggestions: [], provider: "Claude Code", at: 0 }])
    h = await openAsk({ agents: [fakeAgent(answer, [], gate)], store })
    await h.type("Who is Nicodemus?")
    await h.press("return")
    await tick(h, 60)
    await h.press("tab")
    await h.press("n")
    release()
    await tick(h, 80)
    const saved = store.askThread(43, 3)!
    expect(saved.provider).toBe("claude")
    expect(saved.sessionId).toBe("claude-session")
  })

  test("a suggested note on a verse the chapter does not have is not offered", async () => {
    const script = answer.map((e) =>
      e.type === EventType.TOOL_CALL_ARGS && e.toolCallId === "c2" ? { ...e, delta: '{"reference":"John 3:99","note":"Nowhere."}' } : e,
    )
    h = await openAsk({ agents: [fakeAgent(script)] })
    await h.type("Who is Nicodemus?")
    await h.press("return")
    await tick(h, 80)
    expect(h.frame()).toContain("Nicodemus was a Pharisee")
    expect(h.frame()).not.toContain("Suggested note on John 3:99")
  })

  test("typing in Ask never triggers pane shortcuts", async () => {
    const seen: AskInput[] = []
    h = await openAsk({ agents: [fakeAgent(answer, seen)] })
    await h.type("Psalm 1 [2] n p 1")
    await h.press("return")
    await tick(h, 60)
    expect(seen[0]!.prompt.endsWith("Psalm 1 [2] n p 1")).toBe(true)
    expect(h.frame()).toContain("John 3 · KJV") // n/p did not change chapter
  })
})
