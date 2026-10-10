// The Ask tab (HAL-2584), driven by a scripted AG-UI agent in the test renderer.
import { afterEach, describe, expect, test } from "bun:test"
import { EventType, type AgentEvent, type AgentProvider, type AskInput } from "../src/agent/provider"
import { UserStore } from "../src/data/user"
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
