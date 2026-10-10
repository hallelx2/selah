// Agent event mapping (HAL-2584): Agent SDK and Codex streams → AG-UI, plus answer parsing.
import { describe, expect, test } from "bun:test"
import { claudeToAgUi } from "../src/agent/claude"
import { codexToAgUi } from "../src/agent/codex"
import { EventType, type AgentEvent } from "../src/agent/provider"
import { applyEvent, citedRefs, toolLabel, type AskMessage } from "../src/ui/ask"

async function collect(it: AsyncIterable<AgentEvent>) {
  const out: AgentEvent[] = []
  for await (const e of it) out.push(e)
  return out
}
async function* from<T>(items: T[]) {
  for (const i of items) yield i
}

describe("Claude Agent SDK → AG-UI", () => {
  // shapes as observed from the real SDK (0.3.296) on 2026-10-10
  const se = (event: unknown, uuid = "m1") => ({ type: "stream_event", event, parent_tool_use_id: null, uuid, session_id: "s" })
  const sdk = [
    { type: "system", subtype: "init", session_id: "s" },
    se({ type: "message_start" }),
    se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name: "mcp__selah__search_bible" } }),
    se({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query": "Nicod' } }),
    se({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'emus"}' } }),
    se({ type: "content_block_stop", index: 0 }),
    { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "John 3:9: Nicodemus answered" }] }] } },
    se({ type: "message_start" }, "m2"),
    se({ type: "content_block_start", index: 0, content_block: { type: "text" } }, "m2"),
    se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "He appears in " } }, "m2"),
    se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "John 7:50." } }, "m2"),
    se({ type: "content_block_stop", index: 0 }, "m2"),
    { type: "result", subtype: "success", session_id: "s", total_cost_usd: 0.01, is_error: false },
  ]

  test("streams tool calls, results and text, and finishes with the session", async () => {
    const ev = await collect(claudeToAgUi(from(sdk as never[]), "t"))
    expect(ev.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ])
    expect(ev[1]).toMatchObject({ toolCallName: "search_bible" }) // MCP prefix stripped
    expect(ev[5]).toMatchObject({ toolCallId: "tu1", content: "John 3:9: Nicodemus answered" })
    expect(ev.at(-1)).toMatchObject({ result: { sessionId: "s", costUsd: 0.01 } })
  })

  test("an error result becomes RUN_ERROR; a thrown stream too", async () => {
    const err = await collect(claudeToAgUi(from([{ type: "result", subtype: "error_max_turns", session_id: "s", is_error: true }] as never[]), "t"))
    expect(err.at(-1)).toMatchObject({ type: EventType.RUN_ERROR, code: "error_max_turns" })
    async function* boom() {
      yield* []
      throw new Error("not logged in")
    }
    const thrown = await collect(claudeToAgUi(boom() as never, "t"))
    expect(thrown.at(-1)).toMatchObject({ type: EventType.RUN_ERROR, message: "not logged in" })
  })
})

describe("codex exec --json → AG-UI", () => {
  // the first five lines are verbatim from a real run on 2026-10-10; the mcp_tool_call item is
  // the documented shape (a live capture was blocked by the account's usage limit)
  const lines = [
    '{"type":"thread.started","thread_id":"01a1"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Skill descriptions were shortened to fit the skills context budget."}}',
    '{"type":"item.started","item":{"id":"item_1","type":"mcp_tool_call","server":"selah","tool":"get_passage","arguments":{"reference":"John 3:16"},"status":"in_progress"}}',
    '{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"selah","tool":"get_passage","arguments":{"reference":"John 3:16"},"status":"completed","result":{"content":[{"type":"text","text":"16 For God so loved the world"}]}}}',
    '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"amen"}}',
    '{"type":"turn.completed","usage":{"input_tokens":21702,"output_tokens":5}}',
  ]

  test("maps tool calls and messages, and treats notice items as harmless", async () => {
    const ev = await collect(codexToAgUi(from(lines), "t"))
    expect(ev.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ])
    expect(ev[4]).toMatchObject({ content: "16 For God so loved the world" })
  })

  test("an API error wrapped in JSON reads as its sentence", async () => {
    // verbatim from a real run on 2026-10-10
    const line = String.raw`{"type":"turn.failed","error":{"message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account.\"}}"}}`
    const ev = await collect(codexToAgUi(from([line]), "t"))
    expect(ev.at(-1)).toMatchObject({ type: EventType.RUN_ERROR, message: "The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account." })
  })

  test("a usage-limit failure surfaces its message", async () => {
    const ev = await collect(codexToAgUi(from(['{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit."}}']), "t"))
    expect(ev.at(-1)).toMatchObject({ type: EventType.RUN_ERROR, message: "You've hit your usage limit." })
  })
})

describe("answers", () => {
  test("applyEvent builds text, hides ToolSearch, and turns suggest_note into a suggestion", () => {
    const m: Extract<AskMessage, { role: "assistant" }> = { role: "assistant", text: "", tools: [], suggestions: [], provider: "x", at: 0 }
    const apply = (e: Partial<AgentEvent> & { type: EventType }) => applyEvent(m, e as AgentEvent)
    apply({ type: EventType.TOOL_CALL_START, toolCallId: "a", toolCallName: "ToolSearch" })
    apply({ type: EventType.TOOL_CALL_START, toolCallId: "b", toolCallName: "suggest_note" })
    apply({ type: EventType.TOOL_CALL_ARGS, toolCallId: "b", delta: '{"reference":"John 3:16","note":"God so loved"}' })
    apply({ type: EventType.TOOL_CALL_END, toolCallId: "b" })
    expect(m.suggestions).toEqual([]) // not until the tool says it took it
    apply({ type: EventType.TOOL_CALL_RESULT, messageId: "r", toolCallId: "b", content: "Suggested a note on John 3:16 for the reader to accept." })
    apply({ type: EventType.TEXT_MESSAGE_START, messageId: "t" })
    apply({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "t", delta: "Hello" })
    expect(m.tools.map((t) => t.name)).toEqual(["suggest_note"])
    expect(m.suggestions).toEqual([{ reference: "John 3:16", note: "God so loved" }])
    expect(m.text).toBe("Hello")
  })

  test("a suggest_note the tool rejected, or one naming no real verse, is never offered", () => {
    const m: Extract<AskMessage, { role: "assistant" }> = { role: "assistant", text: "", tools: [], suggestions: [], provider: "x", at: 0 }
    const suggest = (id: string, args: unknown, isError = false) => {
      applyEvent(m, { type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: "suggest_note" })
      applyEvent(m, { type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: JSON.stringify(args) })
      applyEvent(m, { type: EventType.TOOL_CALL_END, toolCallId: id })
      applyEvent(m, { type: EventType.TOOL_CALL_RESULT, messageId: id, toolCallId: id, content: isError ? "Suggest a note on one verse" : "ok", isError })
    }
    suggest("whole-chapter", { reference: "John 3", note: "x" }, true)
    suggest("no-such-chapter", { reference: "John 30:1", note: "x" })
    suggest("not-a-book", { reference: "Hezekiah 4:2", note: "x" })
    suggest("empty", { reference: "John 3:2", note: "  " })
    suggest("good", { reference: "John 3:2", note: "He came by night." })
    expect(m.suggestions).toEqual([{ reference: "John 3:2", note: "He came by night." }])
  })

  test("tool errors carry through from Claude and Codex", async () => {
    const claude = await collect(
      claudeToAgUi(
        from([{ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "c", content: "bad", is_error: true }] } }]) as never,
        "t",
      ),
    )
    expect(claude.find((e) => e.type === EventType.TOOL_CALL_RESULT)).toMatchObject({ isError: true })
    const codex = await collect(
      codexToAgUi(from(['{"type":"item.completed","item":{"id":"i","type":"mcp_tool_call","tool":"suggest_note","arguments":{},"status":"failed","error":{"message":"bad"}}}']), "t"),
    )
    expect(codex.find((e) => e.type === EventType.TOOL_CALL_RESULT)).toMatchObject({ isError: true, content: "bad" })
  })

  test("tool chips say what the agent did, word studies included", () => {
    const label = (name: string, args: unknown) => toolLabel({ id: "x", name, args: JSON.stringify(args) }, () => "")
    expect(label("get_original_words", { reference: "John 3:16" })).toBe("read the original of John 3:16")
    expect(label("concordance", { strongs: "G0026", book: "1 John" })).toBe("traced G0026 in 1 John")
    expect(label("concordance", { strongs: "H2617" })).toBe("traced H2617")
    expect(label("search_bible", { query: "Nicodemus" })).toBe("searched “Nicodemus”")
  })

  test("citedRefs finds references, ranges and continuations, once each", () => {
    const text = 'He came by night (John 3:1). "How can these things be?" (John 3:4, 3:9). Later John 7:50–51 and John 19:39; compare 1 Cor 15:3. Not a ref: Chapter 12:4 of nothing.'
    expect(citedRefs(text).map((r) => `${r.book}:${r.chapter}:${r.verseStart}-${r.verseEnd}`)).toEqual([
      "43:3:1-1",
      "43:3:4-4",
      "43:3:9-9",
      "43:7:50-51",
      "43:19:39-39",
      "46:15:3-3",
    ])
  })
})
