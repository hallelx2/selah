import { createSdkMcpServer, query, tool, type SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { paths } from "../data/paths"
import { callTool, SYSTEM_PROMPT, TOOLS, type ToolContext } from "./tools"
import { EventType, toolName, type AgentEvent, type AgentProvider, type AskInput } from "./provider"

/**
 * Claude, through the reader's own Claude Code install and login, via the Claude Agent SDK.
 * Selah's tools run in-process as an SDK MCP server. The agent is read-only: it may use Selah's
 * tools and the web, and nothing that touches the file system or a shell. The reader's own
 * Claude Code settings and CLAUDE.md files are not loaded; this is a Bible study, not their
 * coding setup.
 */
export function claudeProvider(ctx: ToolContext, executable?: string): AgentProvider {
  const server = createSdkMcpServer({
    name: "selah",
    version: "1.0.0",
    instructions: "Bible passages, search, Matthew Henry, and the reader's notes and reading context.",
    tools: TOOLS.map((t) =>
      tool(
        t.name,
        t.description,
        t.shape,
        async (args: Record<string, unknown>) => {
          const r = callTool(ctx, t.name, args)
          return { content: [{ type: "text" as const, text: r.text }], isError: r.isError }
        },
        { annotations: { readOnlyHint: true, openWorldHint: false } },
      ),
    ),
  })

  return {
    id: "claude",
    label: "Claude Code",
    async *run(input: AskInput) {
      const abortController = new AbortController()
      input.signal.addEventListener("abort", () => abortController.abort(), { once: true })
      const stream = query({
        prompt: input.prompt,
        options: {
          systemPrompt: SYSTEM_PROMPT,
          mcpServers: { selah: server },
          allowedTools: ["mcp__selah__*", "WebSearch", "WebFetch"],
          disallowedTools: ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "Task", "Read", "Glob", "Grep"],
          permissionMode: "dontAsk",
          settingSources: [],
          includePartialMessages: true,
          maxTurns: 16,
          // Sessions live with Selah's data, not under whatever directory Selah was started from.
          cwd: paths.data,
          abortController,
          ...(input.sessionId ? { resume: input.sessionId } : {}),
          ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
        },
      })
      yield* claudeToAgUi(stream, input.threadId)
    },
  }
}

/**
 * Agent SDK messages → AG-UI events. Text streams token by token from `stream_event` deltas;
 * tool calls stream their JSON arguments; tool results arrive on the following user message.
 */
export async function* claudeToAgUi(stream: AsyncIterable<SDKMessage>, threadId: string): AsyncGenerator<AgentEvent> {
  const runId = crypto.randomUUID()
  yield { type: EventType.RUN_STARTED, threadId, runId }
  // per streamed message: content block index → our message or tool call id
  const blocks = new Map<number, { kind: "text" | "tool"; id: string }>()
  let finished = false
  try {
    for await (const m of stream) {
      if (m.type === "stream_event") {
        const e = m.event as { type: string; index?: number; content_block?: { type: string; id?: string; name?: string }; delta?: { type: string; text?: string; partial_json?: string } }
        if (m.parent_tool_use_id) continue // a sub-agent's inner stream
        if (e.type === "message_start") blocks.clear()
        if (e.type === "content_block_start" && e.index !== undefined && e.content_block) {
          if (e.content_block.type === "text") {
            const id = `${m.uuid}:${e.index}`
            blocks.set(e.index, { kind: "text", id })
            yield { type: EventType.TEXT_MESSAGE_START, messageId: id, role: "assistant" }
          } else if (e.content_block.type === "tool_use" || e.content_block.type === "server_tool_use" || e.content_block.type === "mcp_tool_use") {
            const id = e.content_block.id ?? `${m.uuid}:${e.index}`
            blocks.set(e.index, { kind: "tool", id })
            yield { type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: toolName(e.content_block.name ?? "tool") }
          }
        } else if (e.type === "content_block_delta" && e.index !== undefined) {
          const b = blocks.get(e.index)
          if (b?.kind === "text" && e.delta?.type === "text_delta" && e.delta.text) yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: b.id, delta: e.delta.text }
          if (b?.kind === "tool" && e.delta?.type === "input_json_delta" && e.delta.partial_json) yield { type: EventType.TOOL_CALL_ARGS, toolCallId: b.id, delta: e.delta.partial_json }
        } else if (e.type === "content_block_stop" && e.index !== undefined) {
          const b = blocks.get(e.index)
          if (b?.kind === "text") yield { type: EventType.TEXT_MESSAGE_END, messageId: b.id }
          if (b?.kind === "tool") yield { type: EventType.TOOL_CALL_END, toolCallId: b.id }
        }
      } else if (m.type === "user" && !m.parent_tool_use_id) {
        const content = (m.message as { content?: unknown }).content
        if (Array.isArray(content)) {
          for (const c of content as { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) {
            if (c.type !== "tool_result" || !c.tool_use_id) continue
            const text = typeof c.content === "string" ? c.content : Array.isArray(c.content) ? (c.content as { type: string; text?: string }[]).map((x) => x.text ?? "").join("\n") : ""
            yield { type: EventType.TOOL_CALL_RESULT, messageId: crypto.randomUUID(), toolCallId: c.tool_use_id, content: text, role: "tool", isError: !!c.is_error }
          }
        }
      } else if (m.type === "result") {
        finished = true
        const r = m as { subtype: string; session_id: string; total_cost_usd?: number; is_error?: boolean; result?: string; errors?: string[] }
        if (r.subtype === "success" && !r.is_error) {
          yield { type: EventType.RUN_FINISHED, threadId, runId, result: { sessionId: r.session_id, costUsd: r.total_cost_usd } }
        } else {
          yield { type: EventType.RUN_ERROR, message: r.errors?.join("; ") || r.result || `Claude stopped: ${r.subtype}`, code: r.subtype }
        }
      } else if (m.type === "assistant" && (m as { error?: unknown }).error) {
        const err = (m as { error?: { type?: string; message?: string } | string }).error
        const message = typeof err === "string" ? err : err?.message ?? err?.type ?? "Claude returned an error"
        yield { type: EventType.RUN_ERROR, message, code: typeof err === "string" ? err : err?.type }
        finished = true
      }
    }
  } catch (e) {
    if (!finished) yield { type: EventType.RUN_ERROR, message: e instanceof Error ? e.message : String(e), code: "exception" }
    return
  }
  if (!finished) yield { type: EventType.RUN_FINISHED, threadId, runId }
}
