import { BOOKS, TOTAL_CHAPTERS } from "./books"
import { addDays, weekday, type DayKey } from "./dates"

export interface DayTotals {
  chapters: number
  minutes: number
}

export interface Goal {
  kind: "chapters" | "minutes"
  amount: number
}

export const DEFAULT_GOAL: Goal = { kind: "chapters", amount: 1 }

const value = (t: DayTotals | undefined, goal: Goal) => (t ? (goal.kind === "chapters" ? t.chapters : t.minutes) : 0)
export const met = (t: DayTotals | undefined, goal: Goal) => value(t, goal) >= goal.amount

/**
 * Consecutive days meeting the goal, ending today. An unfinished today does not break the
 * streak: if yesterday met the goal, the streak is still alive until today ends.
 */
export function currentStreak(days: Map<DayKey, DayTotals>, goal: Goal, today: DayKey): number {
  let day = met(days.get(today), goal) ? today : addDays(today, -1)
  let n = 0
  while (met(days.get(day), goal)) {
    n++
    day = addDays(day, -1)
  }
  return n
}

export function longestStreak(days: Map<DayKey, DayTotals>, goal: Goal): number {
  const hits = [...days.entries()].filter(([, t]) => met(t, goal)).map(([d]) => d).sort()
  let best = 0
  let run = 0
  let prev: DayKey | undefined
  for (const d of hits) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1
    best = Math.max(best, run)
    prev = d
  }
  return best
}

/**
 * Share of days in the window that met the goal. The window ends today if today is already
 * met, otherwise yesterday, so an unfinished morning never drags the number down.
 */
export function consistency(days: Map<DayKey, DayTotals>, goal: Goal, today: DayKey, window: number): number {
  const end = met(days.get(today), goal) ? today : addDays(today, -1)
  let hits = 0
  for (let i = 0; i < window; i++) if (met(days.get(addDays(end, -i)), goal)) hits++
  return hits / window
}

export interface Verdict {
  label: string
  tone: "success" | "primary" | "warning" | "error"
}

export function verdict(score: number): Verdict {
  if (score >= 0.85) return { label: "Very consistent", tone: "success" }
  if (score >= 0.6) return { label: "Consistent", tone: "primary" }
  if (score >= 0.3) return { label: "Building the habit", tone: "warning" }
  return { label: "Inconsistent", tone: "error" }
}

export interface HeatCell {
  day: DayKey
  level: 0 | 1 | 2 | 3 | 4
  value: number
}

/** Level 0 none, 1 below goal, 2 met, 3 well over, 4 double the goal or more. */
export function level(v: number, goal: Goal): HeatCell["level"] {
  if (v <= 0) return 0
  if (v < goal.amount) return 1
  if (v < goal.amount * 1.5) return 2
  if (v < goal.amount * 2) return 3
  return 4
}

/** A GitHub-style grid: `weeks` columns of 7 days (Sunday first), the last column holding today. */
export function heatmap(days: Map<DayKey, DayTotals>, goal: Goal, today: DayKey, weeks = 53) {
  const lastSunday = addDays(today, -weekday(today))
  const firstSunday = addDays(lastSunday, -(weeks - 1) * 7)
  const grid: (HeatCell | null)[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: (HeatCell | null)[] = []
    for (let d = 0; d < 7; d++) {
      const day = addDays(firstSunday, w * 7 + d)
      if (day > today) {
        col.push(null)
        continue
      }
      const v = value(days.get(day), goal)
      col.push({ day, level: level(v, goal), value: v })
    }
    grid.push(col)
  }
  return { weeks: grid, start: firstSunday }
}

/** Totals for the last `n` days, oldest first, for the bar chart. */
export function lastDays(days: Map<DayKey, DayTotals>, today: DayKey, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(today, i - n + 1)
    return { day, ...(days.get(day) ?? { chapters: 0, minutes: 0 }) }
  })
}

export interface Progress {
  read: number
  total: number
  fraction: number
}

const prog = (read: number, total: number): Progress => ({ read, total, fraction: total ? read / total : 0 })

/** Distinct chapters ever read, per book, per testament and for the whole Bible. */
export function bookProgress(reads: { book: number; chapter: number }[]) {
  const seen = new Set(reads.map((r) => `${r.book}:${r.chapter}`))
  const perBook = new Map<number, number>()
  for (const key of seen) {
    const book = Number(key.split(":")[0])
    perBook.set(book, (perBook.get(book) ?? 0) + 1)
  }
  const books = BOOKS.map((b) => ({ book: b.id, ...prog(perBook.get(b.id) ?? 0, b.chapters) }))
  const sum = (filter: (id: number) => boolean) =>
    books.filter((b) => filter(b.book)).reduce((acc, b) => [acc[0]! + b.read, acc[1]! + b.total], [0, 0])
  const [otRead, otTotal] = sum((id) => id <= 39)
  const [ntRead, ntTotal] = sum((id) => id >= 40)
  return {
    books,
    ot: prog(otRead!, otTotal!),
    nt: prog(ntRead!, ntTotal!),
    total: prog(seen.size, TOTAL_CHAPTERS),
    booksFinished: books.filter((b) => b.fraction === 1).length,
  }
}

export function formatMinutes(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`
  if (minutes < 60) return `${Math.round(minutes)}m`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m ? `${h}h ${m}m` : `${h}h`
}
