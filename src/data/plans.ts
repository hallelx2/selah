import { ALL_CHAPTERS, type ChapterKey } from "./books"
import { addDays, daysBetween, type DayKey } from "./dates"

export interface PlanStream {
  /** Book ids read in canonical order, split evenly across the plan's days. */
  books: number[]
}

export interface PlanDef {
  id: string
  name: string
  description: string
  days: number
  /** Several streams are read side by side each day (e.g. one Proverb plus some Psalms). */
  streams: PlanStream[]
  /**
   * Upper bound on the 95th-percentile portion over the 5th, by words, checked by the tests.
   * Max over min is meaningless here: Psalm 119 alone is longer than two portions of the
   * two-year plan, and chapters are never split.
   */
  maxSpread: number
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

export const PLANS: readonly PlanDef[] = [
  {
    id: "bible-year",
    name: "Bible in a Year",
    description: "Genesis to Revelation in 365 days, about 20 minutes a day.",
    days: 365,
    streams: [{ books: range(1, 66) }],
    maxSpread: 1.6,
  },
  {
    id: "bible-2year",
    name: "Bible in Two Years",
    description: "The whole Bible at a gentler pace, about 10 minutes a day.",
    days: 730,
    streams: [{ books: range(1, 66) }],
    maxSpread: 2.3,
  },
  {
    id: "nt-90",
    name: "New Testament in 90 Days",
    description: "Matthew to Revelation in three months, about 15 minutes a day.",
    days: 90,
    streams: [{ books: range(40, 66) }],
    maxSpread: 1.7,
  },
  {
    id: "gospels-30",
    name: "The Gospels in 30 Days",
    description: "Matthew, Mark, Luke and John in a month.",
    days: 30,
    streams: [{ books: range(40, 43) }],
    maxSpread: 1.5,
  },
  {
    id: "psalms-proverbs",
    name: "Psalms and Proverbs in a Month",
    description: "A chapter of Proverbs and about five Psalms each day for 31 days.",
    days: 31,
    streams: [{ books: [20] }, { books: [19] }],
    maxSpread: 1.5,
  },
]

export interface BuiltPlan {
  def: PlanDef
  days: ChapterKey[][]
}

const wordsOf = (words: Map<string, number>, c: ChapterKey) => words.get(`${c.book}:${c.chapter}`) ?? 1

/**
 * Splits a run of chapters into `k` contiguous, non-empty portions as evenly as possible by
 * word count. Dynamic programming over the sum of squared deviations from the mean portion,
 * so one long chapter (Psalm 119) shortens its neighbours instead of skewing the whole plan.
 */
function partition(chapters: ChapterKey[], k: number, words: Map<string, number>): ChapterKey[][] {
  const n = chapters.length
  if (k >= n) return Array.from({ length: k }, (_, i) => (i < n ? [chapters[i]!] : []))
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + wordsOf(words, chapters[i]!)
  const mean = prefix[n]! / k
  const maxSpan = Math.min(n, Math.max(8, Math.ceil((4 * n) / k)))
  const INF = Number.POSITIVE_INFINITY
  const cost = new Float64Array((k + 1) * (n + 1)).fill(INF)
  const from = new Int32Array((k + 1) * (n + 1)).fill(-1)
  const at = (d: number, i: number) => d * (n + 1) + i
  cost[at(0, 0)] = 0
  for (let d = 1; d <= k; d++) {
    // Each of the d portions needs at least one chapter; the rest need room too.
    const lo = d
    const hi = n - (k - d)
    for (let i = lo; i <= hi; i++) {
      let best = INF
      let arg = -1
      for (let j = Math.max(d - 1, i - maxSpan); j < i; j++) {
        const prev = cost[at(d - 1, j)]!
        if (prev === INF) continue
        const dev = prefix[i]! - prefix[j]! - mean
        const c = prev + dev * dev
        if (c < best) {
          best = c
          arg = j
        }
      }
      cost[at(d, i)] = best
      from[at(d, i)] = arg
    }
  }
  const out: ChapterKey[][] = []
  let i = n
  for (let d = k; d >= 1; d--) {
    const j = from[at(d, i)]!
    out.unshift(chapters.slice(j, i))
    i = j
  }
  return out
}

const cache = new Map<string, BuiltPlan>()

export function buildPlan(def: PlanDef, words: Map<string, number>): BuiltPlan {
  const key = `${def.id}:${words.size}`
  const hit = cache.get(key)
  if (hit) return hit
  const streams = def.streams.map((s) =>
    partition(
      ALL_CHAPTERS.filter((c) => s.books.includes(c.book)),
      def.days,
      words,
    ),
  )
  const days = Array.from({ length: def.days }, (_, d) => streams.flatMap((s) => s[d] ?? []))
  const plan = { def, days }
  cache.set(key, plan)
  return plan
}

export interface PlanStatus {
  /** 1-based day of the plan that today is. */
  dayNumber: number
  /** The first portion not yet fully read. */
  next: { index: number; chapters: ChapterKey[] }
  todayDone: boolean
  behind: number
  ahead: number
  completedPortions: number
  fraction: number
  projectedFinish: DayKey | undefined
  finished: boolean
}

/** Where a reader stands against a plan, counting any read of a chapter since the plan began. */
export function planStatus(plan: BuiltPlan, startedOn: DayKey, reads: ChapterKey[], today: DayKey): PlanStatus {
  const done = new Set(reads.map((c) => `${c.book}:${c.chapter}`))
  const isDone = (c: ChapterKey) => done.has(`${c.book}:${c.chapter}`)
  const portionDone = plan.days.map((d) => d.every(isDone))
  const dayIndex = Math.max(0, Math.min(plan.days.length - 1, daysBetween(startedOn, today)))
  let next = portionDone.findIndex((d) => !d)
  const finished = next === -1
  if (finished) next = plan.days.length
  const completedPortions = portionDone.filter(Boolean).length
  const all = plan.days.flat()
  const fraction = all.filter(isDone).length / all.length
  const elapsed = daysBetween(startedOn, today) + 1
  const pace = completedPortions / Math.max(1, elapsed)
  const remaining = plan.days.length - completedPortions
  const projectedFinish = finished ? today : pace > 0 ? addDays(today, Math.ceil(remaining / pace)) : undefined
  return {
    dayNumber: dayIndex + 1,
    next: { index: next, chapters: plan.days[next] ?? [] },
    todayDone: portionDone[dayIndex] ?? false,
    behind: Math.max(0, dayIndex - next),
    ahead: Math.max(0, next - (dayIndex + 1)),
    completedPortions,
    fraction,
    projectedFinish,
    finished,
  }
}
