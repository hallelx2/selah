import { beforeAll, describe, expect, test } from "bun:test"
import { ALL_CHAPTERS, BOOKS } from "../src/data/books"
import { addDays } from "../src/data/dates"
import { PLANS, buildPlan, planStatus, type BuiltPlan } from "../src/data/plans"
import { fixtureBible } from "./fixture"

let words: Map<string, number>
beforeAll(async () => {
  words = (await fixtureBible()).chapterWords("KJV")
}, 120_000)

const scope = (id: string) => {
  const def = PLANS.find((p) => p.id === id)!
  return def.streams.flatMap((s) => ALL_CHAPTERS.filter((c) => s.books.includes(c.book)))
}

describe("plans", () => {
  for (const def of PLANS) {
    test(`${def.id}: covers every chapter in scope exactly once, in ${def.days} days`, () => {
      const plan = buildPlan(def, words)
      expect(plan.days).toHaveLength(def.days)
      const keys = plan.days.flat().map((c) => `${c.book}:${c.chapter}`)
      expect(new Set(keys).size).toBe(keys.length)
      expect(keys.sort()).toEqual(scope(def.id).map((c) => `${c.book}:${c.chapter}`).sort())
      expect(plan.days.every((d) => d.length > 0)).toBe(true)
    })

    test(`${def.id}: daily portions are balanced by word count`, () => {
      const plan = buildPlan(def, words)
      const sizes = plan.days.map((d) => d.reduce((s, c) => s + (words.get(`${c.book}:${c.chapter}`) ?? 0), 0))
      const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length
      // Chapters are indivisible, so a portion can only be as even as its chapters allow;
      // the bound is "within one long chapter of the mean" rather than a fixed ratio.
      const longest = Math.max(...plan.days.flat().map((c) => words.get(`${c.book}:${c.chapter}`) ?? 0))
      for (const s of sizes) expect(Math.abs(s - mean)).toBeLessThanOrEqual(longest)
      const sorted = [...sizes].sort((a, b) => a - b)
      const pct = (q: number) => sorted[Math.floor((sorted.length - 1) * q)]!
      expect(pct(0.95) / pct(0.05)).toBeLessThan(def.maxSpread)
    })
  }

  test("the Bible-in-a-year plan reads in canonical order within each stream", () => {
    const plan = buildPlan(PLANS.find((p) => p.id === "bible-year")!, words)
    const ot = plan.days.flat().filter((c) => c.book <= 39)
    for (let i = 1; i < ot.length; i++) {
      const a = ot[i - 1]!
      const b = ot[i]!
      expect(b.book * 1000 + b.chapter).toBeGreaterThan(a.book * 1000 + a.chapter)
    }
  })
})

describe("planStatus", () => {
  let plan: BuiltPlan
  beforeAll(() => {
    plan = buildPlan(PLANS.find((p) => p.id === "gospels-30")!, words)
  })
  const start = "2026-10-01"
  const readDays = (n: number) => plan.days.slice(0, n).flat()

  test("on track: today's portion pending, everything before it done", () => {
    const s = planStatus(plan, start, readDays(7), "2026-10-08")
    expect(s.dayNumber).toBe(8)
    expect(s.behind).toBe(0)
    expect(s.ahead).toBe(0)
    expect(s.todayDone).toBe(false)
    expect(s.next.chapters).toEqual(plan.days[7]!)
  })

  test("behind by the number of missed portions", () => {
    const s = planStatus(plan, start, readDays(4), "2026-10-08")
    expect(s.behind).toBe(3)
    expect(s.next.index).toBe(4)
  })

  test("ahead when future portions are done", () => {
    const s = planStatus(plan, start, readDays(10), "2026-10-08")
    expect(s.ahead).toBe(2)
    expect(s.todayDone).toBe(true)
  })

  test("projects the finish date from the current pace", () => {
    const s = planStatus(plan, start, readDays(4), "2026-10-08")
    // 4 portions in 8 days → half pace → 26 portions left take 52 days
    expect(s.projectedFinish).toBe(addDays("2026-10-08", 52))
    expect(s.fraction).toBeCloseTo(plan.days.slice(0, 4).flat().length / plan.days.flat().length)
  })

  test("chapters read out of order still count toward their portion", () => {
    const s = planStatus(plan, start, [...plan.days[2]!, ...plan.days[0]!, ...plan.days[1]!], "2026-10-04")
    expect(s.next.index).toBe(3)
    expect(s.behind).toBe(0)
  })
})

void BOOKS
