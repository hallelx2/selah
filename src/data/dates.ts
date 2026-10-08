/** Local calendar days as "YYYY-MM-DD" keys. All tracking is bucketed by the reader's own date. */
export type DayKey = string

const pad = (n: number) => String(n).padStart(2, "0")

export function dayKey(ms: number = Date.now()): DayKey {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseDay(key: DayKey): Date {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y!, m! - 1, d!)
}

export function addDays(key: DayKey, n: number): DayKey {
  const d = parseDay(key)
  d.setDate(d.getDate() + n)
  return dayKey(d.getTime())
}

/** Whole days from a to b (b - a), by calendar date, so DST shifts never matter. */
export function daysBetween(a: DayKey, b: DayKey): number {
  const utc = (k: DayKey) => {
    const [y, m, d] = k.split("-").map(Number)
    return Date.UTC(y!, m! - 1, d!)
  }
  return Math.round((utc(b) - utc(a)) / 86_400_000)
}

export function weekday(key: DayKey): number {
  return parseDay(key).getDay()
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
export const monthName = (key: DayKey) => MONTHS[parseDay(key).getMonth()]!

export function prettyDay(key: DayKey): string {
  const d = parseDay(key)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}
