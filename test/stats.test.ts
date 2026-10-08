import { describe, expect, test } from "bun:test"
import { addDays, dayKey } from "../src/data/dates"
import {
  bookProgress,
  consistency,
  currentStreak,
  heatmap,
  longestStreak,
  verdict,
  type DayTotals,
  type Goal,
} from "../src/data/stats"

const today = "2026-10-08"
const goal: Goal = { kind: "chapters", amount: 1 }

/** Days relative to today: 0 = today, 1 = yesterday … with chapters read on each. */
function days(spec: Record<number, number>): Map<string, DayTotals> {
  return new Map(
    Object.entries(spec).map(([back, chapters]) => [addDays(today, -Number(back)), { chapters, minutes: chapters * 5 }]),
  )
}

describe("streaks", () => {
  test("counts consecutive days that met the goal, ending today", () => {
    expect(currentStreak(days({ 0: 1, 1: 2, 2: 1, 4: 1 }), goal, today)).toBe(3)
  })

  test("is still live when today is unfinished but yesterday met the goal", () => {
    expect(currentStreak(days({ 1: 1, 2: 1 }), goal, today)).toBe(2)
  })

  test("is zero once a full day was missed", () => {
    expect(currentStreak(days({ 2: 1, 3: 1 }), goal, today)).toBe(0)
  })

  test("days below the goal break the streak", () => {
    const g: Goal = { kind: "chapters", amount: 3 }
    expect(currentStreak(days({ 0: 3, 1: 2, 2: 3 }), g, today)).toBe(1)
  })

  test("a minutes goal uses minutes", () => {
    const g: Goal = { kind: "minutes", amount: 10 }
    expect(currentStreak(days({ 0: 2, 1: 2, 2: 1 }), g, today)).toBe(2)
  })

  test("longest streak finds the longest run anywhere", () => {
    expect(longestStreak(days({ 0: 1, 1: 1, 5: 1, 6: 1, 7: 1, 8: 1, 20: 1 }), goal)).toBe(4)
    expect(longestStreak(new Map(), goal)).toBe(0)
  })
})

describe("consistency", () => {
  test("days meeting the goal over the window, counting today only once it is met", () => {
    expect(consistency(days({ 0: 1, 1: 1, 3: 1 }), goal, today, 7)).toBeCloseTo(3 / 7)
    // today unmet: the window is the previous 7 days, so an unfinished today never lowers the score
    expect(consistency(days({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 }), goal, today, 7)).toBe(1)
  })

  test("verdicts", () => {
    expect(verdict(0.95).label).toBe("Very consistent")
    expect(verdict(0.7).label).toBe("Consistent")
    expect(verdict(0.4).label).toBe("Building the habit")
    expect(verdict(0.1).label).toBe("Inconsistent")
  })
})

describe("heatmap", () => {
  test("53 weeks × 7 days, Sunday-first columns, ending on the week of today", () => {
    const grid = heatmap(days({ 0: 4 }), goal, today, 53)
    expect(grid.weeks).toHaveLength(53)
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true)
    const last = grid.weeks.at(-1)!
    const cell = last.find((c) => c?.day === today)
    expect(cell?.level).toBe(4)
    // days after today in the final week are null
    expect(last.slice(new Date(2026, 9, 8).getDay() + 1).every((c) => c === null)).toBe(true)
  })

  test("five intensity levels relative to the goal", () => {
    const grid = heatmap(days({ 0: 0, 1: 1, 2: 2, 3: 3, 4: 8 }), { kind: "chapters", amount: 2 }, today, 2)
    const level = (back: number) => grid.weeks.flat().find((c) => c?.day === addDays(today, -back))?.level
    expect([level(0), level(1), level(2), level(3), level(4)]).toEqual([0, 1, 2, 3, 4])
  })
})

describe("bookProgress", () => {
  test("distinct chapters read over total, per book and whole Bible", () => {
    const reads = [
      { book: 43, chapter: 1 },
      { book: 43, chapter: 1 },
      { book: 43, chapter: 2 },
      { book: 57, chapter: 1 },
    ]
    const p = bookProgress(reads)
    expect(p.books.find((b) => b.book === 43)).toMatchObject({ read: 2, total: 21 })
    expect(p.books.find((b) => b.book === 57)?.fraction).toBe(1)
    expect(p.total).toMatchObject({ read: 3, total: 1189 })
    expect(p.nt).toMatchObject({ read: 3, total: 260 })
    expect(p.ot).toMatchObject({ read: 0, total: 929 })
  })
})

test("dayKey uses the local date", () => {
  expect(dayKey(new Date(2026, 9, 8, 23, 59).getTime())).toBe("2026-10-08")
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
})
