// The Codex provider as a process (HAL-2591): a fake `codex` stands in for the real CLI, so
// argument limits, pipes and the Codex home are exercised for real.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { codexHome, codexProvider } from "../src/agent/codex"
import { EventType, type AgentEvent, type AskInput } from "../src/agent/provider"

const saved = { ...process.env }
let dir: string
let fake: string
let userCodex: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "selah-codex-"))
  userCodex = join(dir, "user-codex")
  mkdirSync(userCodex)
  writeFileSync(join(userCodex, "auth.json"), "{}")
  process.env.SELAH_HOME = join(dir, "selah")
  process.env.CODEX_HOME = userCodex
  fake = join(dir, "codex")
  // records what it was given, floods stderr past any pipe buffer, then answers
  writeFileSync(
    fake,
    [
      "#!/bin/sh",
      'printf "%s\\n" "$@" > "$CODEX_HOME/argv"',
      'cat > "$CODEX_HOME/stdin"',
      "head -c 400000 /dev/zero | tr '\\0' e >&2",
      `echo '{"type":"item.completed","item":{"id":"a","type":"agent_message","text":"amen"}}'`,
      `echo '{"type":"turn.completed"}'`,
    ].join("\n"),
  )
  chmodSync(fake, 0o755)
})

afterAll(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
  Object.assign(process.env, saved)
  rmSync(dir, { recursive: true, force: true })
})

async function ask(input: Partial<AskInput>) {
  const out: AgentEvent[] = []
  const run = codexProvider(fake).run({ prompt: "Who is Nicodemus?", history: [], threadId: "t", signal: new AbortController().signal, ...input })
  for await (const e of run) out.push(e)
  return out
}

describe("codex provider", () => {
  test("a long thread goes on stdin, not past the argument limit", async () => {
    // well over the kernel's 128 KiB cap on a single argument
    const history = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: "x".repeat(8_000) }))
    const ev = await ask({ history })
    expect(ev.at(-1)?.type).toBe(EventType.RUN_FINISHED)
    const home = codexHome()
    expect(readFileSync(join(home, "argv"), "utf8").trim().split("\n").at(-1)).toBe("-")
    const stdin = readFileSync(join(home, "stdin"), "utf8")
    expect(stdin.length).toBeGreaterThan(300_000)
    expect(stdin.endsWith("Reader: Who is Nicodemus?")).toBe(true)
  })

  // guard, not a regression: Bun 1.4.2 did not stall on the old code either
  test("a chatty stderr never stalls the answer", async () => {
    const ev = await ask({})
    expect(ev.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT).map((e) => (e as { delta: string }).delta)).toEqual(["amen"])
  }, 10_000)

  test("Selah's MCP server gets every variable that decides where its data lives", () => {
    process.env.SELAH_SOURCES = join(dir, "sources")
    process.env.XDG_CONFIG_HOME = join(dir, "xdg-config")
    process.env.XDG_DATA_HOME = join(dir, "xdg-data")
    const toml = readFileSync(join(codexHome(), "config.toml"), "utf8")
    for (const k of ["SELAH_HOME", "SELAH_SOURCES", "XDG_CONFIG_HOME", "XDG_DATA_HOME"]) expect(toml).toContain(`${k} = ${JSON.stringify(process.env[k])}`)
  })

  test("a dangling auth.json link is repaired, and a real file is left alone", () => {
    const home = codexHome()
    const link = join(home, "auth.json")
    rmSync(link, { force: true })
    symlinkSync(join(dir, "gone", "auth.json"), link)
    expect(existsSync(link)).toBe(false) // dangling
    expect(() => codexHome()).not.toThrow()
    expect(readlinkSync(link)).toBe(join(userCodex, "auth.json"))
    rmSync(link)
    writeFileSync(link, '{"own":true}')
    codexHome()
    expect(readFileSync(link, "utf8")).toBe('{"own":true}')
  })
})

test("Codex's own machine tools are off in Selah's Codex home", () => {
  const toml = readFileSync(join(codexHome(), "config.toml"), "utf8")
  expect(toml).toContain("[features]\nshell_tool = false\n")
  for (const f of ["unified_exec", "view_image", "browser_use", "computer_use", "plugins", "multi_agent"]) expect(toml).toContain(`\n${f} = false\n`)
})
