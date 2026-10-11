import { existsSync, linkSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
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
      // The prompt goes on stdin ("-"): a long thread is far past the kernel's 128 KiB limit on
      // one argument.
      const proc = Bun.spawn([executable, "exec", "--json", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-"], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: new Blob([promptWithHistory(input)]),
        cwd: home,
        env: { ...process.env, CODEX_HOME: home },
      })
      const kill = () => proc.kill()
      if (input.signal.aborted) kill()
      input.signal.addEventListener("abort", kill, { once: true })
      // Read from the start rather than after exit. Bun 1.4.2 buffers an unread pipe itself (8 MB
      // measured, no stall), but nothing promises that, and a stalled Codex would hang Ask.
      const stderr = new Response(proc.stderr).text()
      try {
        yield* codexToAgUi(lines(proc.stdout), input.threadId, async () => {
          const code = await proc.exited
          if (code === 0) return undefined
          return (await stderr).trim().split("\n").slice(-3).join(" ") || `codex exited with ${code}`
        })
      } finally {
        input.signal.removeEventListener("abort", kill)
        if (proc.exitCode === null) proc.kill()
      }
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
  linkAuth(join(userHome, "auth.json"), join(home, "auth.json"))
  const mcp = selahMcpCommand()
  const toml = (v: string) => JSON.stringify(v)
  // Codex starts MCP servers with a minimal environment, so everything that decides where
  // Selah's data lives goes along, or the server would open a different library than the app.
  const inherited = Object.fromEntries(PATH_VARS.map((k) => [k, process.env[k]]))
  const envPairs = Object.entries({ ...inherited, ...env }).filter(([, v]) => v)
  writeFileSync(
    join(home, "config.toml"),
    [
      "# Written by Selah for Ask. Only Selah's tools; the reader's own Codex config is untouched.",
      // The read-only sandbox still lets a shell read any file the reader can. Ask needs none of
      // Codex's own tools, so they are off; web search stays.
      "[features]",
      ...CODEX_TOOLS_OFF.map((f) => `${f} = false`),
      "",
      "[mcp_servers.selah]",
      `command = ${toml(mcp.command)}`,
      `args = [${mcp.args.map(toml).join(", ")}]`,
      ...(envPairs.length ? [`env = { ${envPairs.map(([k, v]) => `${k} = ${toml(v!)}`).join(", ")} }`] : []),
      "",
    ].join("\n"),
  )
  return home
}

/** Codex features that reach the machine (shell, files, images, browsers, plugins, sub-agents); names as of codex-cli 0.153.4. */
export const CODEX_TOOLS_OFF = [
  "shell_tool",
  "unified_exec",
  "shell_snapshot",
  "view_image",
  "image_generation",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "in_app_browser",
  "in_app_local_automation",
  "apps",
  "plugins",
  "multi_agent",
  "hooks",
  "skill_mcp_dependency_install",
]

/** Every variable `src/data/paths.ts` reads. */
const PATH_VARS = ["SELAH_HOME", "SELAH_SOURCES", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"]

/** Points `link` at the reader's auth.json, repairing a dangling or stale link, never touching a real file. */
export function linkAuth(
  target: string,
  link: string,
  symlink: (t: string, l: string) => void = symlinkSync,
  platform = process.platform,
  hardlink: (t: string, l: string) => void = linkSync,
) {
  // Windows refuses symlinks without Developer Mode or admin rights; there the login is shared
  // through a hard link instead. Codex saves auth.json in place (OpenOptions truncate+write, in
  // codex-rs/login/src/auth/storage.rs, read 2026-10-11), so a refreshed token lands in the one
  // file both names share. The link is remade each run so that a logout (the reader's file
  // deleted) or a fresh login elsewhere is followed. The marker says the link is ours.
  const marker = `${link}.selah-hardlink`
  if (existsSync(marker)) {
    rmSync(link, { force: true })
    rmSync(marker, { force: true })
  }
  let current: string | undefined
  try {
    const st = lstatSync(link)
    if (!st.isSymbolicLink()) return // a login made inside Selah's Codex home; leave it be
    current = readlinkSync(link)
  } catch {
    // no link yet
  }
  if (current === target && existsSync(target)) return
  if (current !== undefined) unlinkSync(link)
  if (!existsSync(target)) return
  try {
    symlink(target, link)
  } catch (e) {
    // only Windows refusing the symlink itself falls back; anything else is a real error
    const code = (e as { code?: string }).code
    if (platform !== "win32" || (code !== "EPERM" && code !== "EACCES")) throw e
    try {
      hardlink(target, link)
      writeFileSync(marker, target)
    } catch {
      // a hard link cannot cross drives (Selah's data on D:, the login on C:); Codex then asks
      // the reader to sign in inside Ask rather than every question failing
    }
  }
}

/** Codex has no session to resume in ephemeral mode, so earlier turns ride along in the prompt. */
export function promptWithHistory(input: AskInput): string {
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
  result?: { content?: { type: string; text?: string }[]; is_error?: boolean; isError?: boolean } | string
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
        const isError = item.status === "failed" || !!item.error || (typeof r === "object" && !!(r.is_error || r.isError))
        yield { type: EventType.TOOL_CALL_RESULT, messageId: crypto.randomUUID(), toolCallId: item.id, content: text, role: "tool", isError }
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
  if (failed || exitError) yield { type: EventType.RUN_ERROR, message: readable(failed ?? exitError!), code: "codex" }
  else yield { type: EventType.RUN_FINISHED, threadId, runId }
}

/** Codex passes API errors through as JSON in a string; the reader should see the sentence inside. */
function readable(message: string): string {
  try {
    const e = JSON.parse(message) as { message?: string; error?: { message?: string } }
    return e.error?.message ?? e.message ?? message
  } catch {
    return message
  }
}
