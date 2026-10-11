import { EventType, type BaseEvent } from "@ag-ui/core"

/**
 * Every agent Selah can talk to streams AG-UI events (https://docs.ag-ui.com), so the Ask tab
 * renders Claude Code, Codex or a test double the same way.
 */
export { EventType }

export type AgentEvent =
  | (BaseEvent & { type: EventType.RUN_STARTED; threadId: string; runId: string })
  | (BaseEvent & { type: EventType.RUN_FINISHED; threadId: string; runId: string; result?: { sessionId?: string; costUsd?: number } })
  | (BaseEvent & { type: EventType.RUN_ERROR; message: string; code?: string })
  | (BaseEvent & { type: EventType.TEXT_MESSAGE_START; messageId: string; role?: "assistant" })
  | (BaseEvent & { type: EventType.TEXT_MESSAGE_CONTENT; messageId: string; delta: string })
  | (BaseEvent & { type: EventType.TEXT_MESSAGE_END; messageId: string })
  | (BaseEvent & { type: EventType.TOOL_CALL_START; toolCallId: string; toolCallName: string; parentMessageId?: string })
  | (BaseEvent & { type: EventType.TOOL_CALL_ARGS; toolCallId: string; delta: string })
  | (BaseEvent & { type: EventType.TOOL_CALL_END; toolCallId: string })
  // isError is Selah's addition: AG-UI's result carries only content, and a failed tool call must
  // not count as done (a failed suggest_note is no suggestion).
  | (BaseEvent & { type: EventType.TOOL_CALL_RESULT; messageId: string; toolCallId: string; content: string; role?: "tool"; isError?: boolean })

export interface AskInput {
  /** The question, already including any context the provider should see first. */
  prompt: string
  /** Earlier turns of this conversation, oldest first, for providers without sessions. */
  history: { role: "user" | "assistant"; text: string }[]
  /** A provider session to continue, from a previous RUN_FINISHED. */
  sessionId?: string
  threadId: string
  signal: AbortSignal
}

export interface AgentProvider {
  id: "claude" | "codex" | "fake"
  label: string
  run(input: AskInput): AsyncIterable<AgentEvent>
}

/** Strips the MCP prefix agents put on Selah's tools: mcp__selah__get_passage → get_passage. */
export const toolName = (name: string) => name.replace(/^mcp__selah__/, "")

/** How to launch `selah mcp` from wherever this process is running (compiled binary or source). */
export function selahMcpCommand(): { command: string; args: string[] } {
  const exe = process.execPath
  const compiled = !/[\\/]bun(\.exe)?$/i.test(exe)
  return compiled ? { command: exe, args: ["mcp"] } : { command: exe, args: [Bun.main, "mcp"] }
}
