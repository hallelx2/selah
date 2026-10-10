import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { paths } from "../data/paths"
import { SYSTEM_PROMPT } from "./tools"
import { EventType, selahMcpCommand, toolName, type AgentEvent, type AgentProvider, type AskInput } from "./provider"

/**
 * Codex, through the reader's own `codex` CLI and login (`codex exec --json`). Selah's tools
 * reach it as the `selah mcp` server. It runs ephemeral, in a read-only sandbox, from a scratch
 * directory: it answers questions, it does not touch files.
 */
export function codexProvider(executable: string, env: Record<string, string | undefined> = {}): AgentProvider {
  return {
    id: "codex",
    label: "Codex",
    async *run(input: AskInput) {
      const home = codexHome(env)
      const args = ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", promptWithHistory(input)]
      const proc = Bun.spawn([executable, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        cwd: home,
        env: { ...process.env, CODEX_HOME: home },
      })
      input.signal.addEventListener("abort", () => proc.kill(), { once: true })
      yield* codexToAgUi(lines(proc.stdout), input.threadId, async () => {
        const code = await proc.exited
        return code === 0 ? undefined : (await new Response(proc.stderr).text()).trim().split("\n").slice(-3).join(" ") || `codex exited with ${code}`
      })
    },
  }
}

/**
 * A Codex home of Selah's own, so a Bible question never runs inside the reader's coding
 * setup: none of their MCP servers, skills, AGENTS.md or hooks, only Selah's MCP server. The
 * login is shared by symlinking their auth.json (never copied, never read by Selah).
 */
export function codexHome(env: Record<string, string | undefined> = {}): string {
  const home = join(paths.data, "codex-home")
  mkdirSync(home, { recursive: true })
  const userHome = process.env.CODEX_HOME && !process.env.CODEX_HOME.startsWith(home) ? process.env.CODEX_HOME : join(homedir(), ".codex")
  const auth = join(home, "auth.json")
  if (!existsSync(auth) && existsSync(join(userHome, "auth.json"))) symlinkSync(join(userHome, "auth.json"), auth)
  const mcp = selahMcpCommand()
  const toml = (v: string) => JSON.stringify(v)
  const envPairs = Object.entries({ SELAH_HOME: process.env.SELAH_HOME, ...env }).filter(([, v]) => v)
  writeFileSync(
    join(home, "config.toml"),
    [
      "# Written by Selah for Ask. Only Selah's tools; the reader's own Codex config is untouched.",
      "[mcp_servers.selah]",
      `command = ${toml(mcp.command)}`,
      `args = [${mcp.args.map(toml).join(", ")}]`,
      ...(envPairs.length ? [`env = { ${envPairs.map(([k, v]) => `${k} = ${toml(v!)}`).join(", ")} }`] : []),
      "",
    ].join("\n"),
  )
  return home
}

/** Codex has no session to resume in ephemeral mode, so earlier turns ride along in the prompt. */
function promptWithHistory(input: AskInput): string {
  const past = input.history.map((h) => `${h.role === "user" ? "Reader" : "You"}: ${h.text}`).join("\n\n")
  return [SYSTEM_PROMPT, past ? `Conversation so far:\n\n${past}` : "", `Reader: ${input.prompt}`].filter(Boolean).join("\n\n---\n\n")
}

async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buf = ""
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true })
    let i: number
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) yield line
    }
  }
  if (buf.trim()) yield buf.trim()
}

interface CodexItem {
  id: string
  type: string
  text?: string
  message?: string
  server?: string
  tool?: string
  arguments?: unknown
  status?: string
  result?: { content?: { type: string; text?: string }[] } | string
  error?: { message?: string } | string
}

/**
 * `codex exec --json` lines → AG-UI events. Codex emits whole items rather than token deltas,
 * so an agent message arrives as one content event; MCP tool calls map to the tool-call events.
 * Its non-fatal "error" items (for example about its own skills list) are notices, not failures.
 */
export async function* codexToAgUi(input: AsyncIterable<string>, threadId: string, exit?: () => Promise<string | undefined>): AsyncGenerator<AgentEvent> {
  const runId = crypto.randomUUID()
  yield { type: EventType.RUN_STARTED, threadId, runId }
  const started = new Set<string>()
  let failed: string | undefined
  for await (const line of input) {
    let e: { type: string; item?: CodexItem; error?: { message?: string }; message?: string }
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    const item = e.item
    if ((e.type === "item.started" || e.type === "item.completed") && item?.type === "mcp_tool_call") {
      if (!started.has(item.id)) {
        started.add(item.id)
        yield { type: EventType.TOOL_CALL_START, toolCallId: item.id, toolCallName: toolName(item.tool ?? "tool") }
        if (item.arguments !== undefined) yield { type: EventType.TOOL_CALL_ARGS, toolCallId: item.id, delta: JSON.stringify(item.arguments) }
      }
      if (e.type === "item.completed") {
        yield { type: EventType.TOOL_CALL_END, toolCallId: item.id }
        const r = item.result
        const text = typeof r === "string" ? r : r?.content?.map((c) => c.text ?? "").join("\n") ?? (typeof item.error === "string" ? item.error : item.error?.message ?? "")
        yield { type: EventType.TOOL_CALL_RESULT, messageId: crypto.randomUUID(), toolCallId: item.id, content: text, role: "tool" }
      }
    } else if ((e.type === "item.started" || e.type === "item.completed") && item?.type === "web_search") {
      if (!started.has(item.id)) {
        started.add(item.id)
        yield { type: EventType.TOOL_CALL_START, toolCallId: item.id, toolCallName: "web_search" }
      }
      if (e.type === "item.completed") yield { type: EventType.TOOL_CALL_END, toolCallId: item.id }
    } else if (e.type === "item.completed" && item?.type === "agent_message" && item.text) {
      yield { type: EventType.TEXT_MESSAGE_START, messageId: item.id, role: "assistant" }
      yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: item.id, delta: item.text }
      yield { type: EventType.TEXT_MESSAGE_END, messageId: item.id }
    } else if (e.type === "turn.failed") {
      failed = e.error?.message ?? "Codex could not finish"
    } else if (e.type === "error") {
      failed = e.message ?? "Codex reported an error"
    }
  }
  const exitError = await exit?.()
  if (failed || exitError) yield { type: EventType.RUN_ERROR, message: failed ?? exitError!, code: "codex" }
  else yield { type: EventType.RUN_FINISHED, threadId, runId }
}
