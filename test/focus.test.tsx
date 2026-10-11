// Text boxes get the keyboard back when a dialog closes (HAL-2627). The owner typed on the home
// screen, opened search, closed it, and could not type again.
import { afterEach, describe, expect, test } from "bun:test"
import { EventType, type AgentProvider } from "../src/agent/provider"
import { harness, type Harness } from "./harness"

let h: Harness | undefined
afterEach(() => {
  h?.destroy()
  h = undefined
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("home", () => {
  test("after search opens and closes, typing in the home box works again", async () => {
    h = await harness({ width: 120, height: 40 })
    await h.type("resume luke 22x")
    await h.press("return") // not a reference: search opens
    expect(h.frame()).toContain("Search")
    await h.press("escape")
    await wait(10)
    await h.settle()
    await h.press("escape") // clear the box
    await h.type("john 3")
    await h.press("return")
    expect(h.frame()).toContain("John 3 · KJV")
  })

  test("after the command palette closes, typing works again", async () => {
    h = await harness({ width: 120, height: 40 })
    await h.press("p", { ctrl: true })
    await h.press("escape")
    await wait(10)
    await h.settle()
    await h.type("ps 23")
    await h.press("return")
    expect(h.frame()).toContain("Psalms 23 · KJV")
  })

  test("phrases around a reference go to the passage: resume, go to, open, read", async () => {
    for (const [typed, shown] of [
      ["resume luke 21", "Luke 21 · KJV"],
      ["go to john 3", "John 3 · KJV"],
      ["open ps 23", "Psalms 23 · KJV"],
      ["read romans 8", "Romans 8 · KJV"],
    ] as const) {
      h = await harness({ width: 120, height: 40 })
      await h.type(typed)
      expect(h.frame()).toContain(`press enter to go to ${shown.split(" · ")[0]}`)
      await h.press("return")
      expect(h.frame()).toContain(shown)
      h.destroy()
      h = undefined
    }
  })
})

describe("Ask", () => {
  test("after the references dialog is closed with esc, typing in Ask works again", async () => {
    const seen: string[] = []
    const agent: AgentProvider = {
      id: "fake",
      label: "Fake Claude",
      async *run(input) {
        seen.push(input.prompt)
        yield { type: EventType.TEXT_MESSAGE_START, messageId: "m" }
        yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "See John 3:16." }
        yield { type: EventType.TEXT_MESSAGE_END, messageId: "m" }
        yield { type: EventType.RUN_FINISHED, threadId: "t", runId: "r" }
      },
    }
    h = await harness({ width: 200, height: 48, agents: [agent], initial: { route: "reader", book: 43, chapter: 3, verse: 1 } })
    await h.press("tab")
    await h.press("4")
    await wait(30)
    await h.settle()
    await h.type("first?")
    await h.press("return")
    await wait(50)
    await h.settle()
    await h.press("r", { ctrl: true })
    expect(h.frame()).toContain("References in the answer")
    await h.press("escape")
    await wait(10)
    await h.settle()
    await h.type("second?")
    await h.press("return")
    await wait(50)
    await h.settle()
    expect(seen).toHaveLength(2)
    expect(seen[1]!.endsWith("second?")).toBe(true)
  })
})
