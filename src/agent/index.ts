import type { AgentProvider } from "./provider"
import type { ToolContext } from "./tools"

export interface AgentChoice {
  available: AgentProvider[]
  /** Which installs were found on PATH, for the empty state. */
  found: { claude?: string; codex?: string }
}

/**
 * The reader's own agents, found on PATH. Nothing is installed or configured by Selah: if the
 * reader has Claude Code or Codex, Ask uses it with their existing login.
 */
export async function detectAgents(ctx: ToolContext): Promise<AgentChoice> {
  const claude = Bun.which("claude") ?? undefined
  const codex = Bun.which("codex") ?? undefined
  const available: AgentProvider[] = []
  if (claude) available.push((await import("./claude")).claudeProvider(ctx, claude))
  if (codex) available.push((await import("./codex")).codexProvider(codex))
  return { available, found: { claude, codex } }
}

export function pickAgent(choice: AgentChoice, preference: "auto" | "claude" | "codex"): AgentProvider | undefined {
  if (preference !== "auto") return choice.available.find((a) => a.id === preference) ?? choice.available[0]
  return choice.available[0]
}

export * from "./provider"
