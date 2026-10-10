import { ALL_CHAPTERS } from "../src/data/books"
import { addDays, parseDay } from "../src/data/dates"
import { UserStore } from "../src/data/user"

/**
 * A believable reader: started 120 days before `today`, reads most days, skips some weekends,
 * had a two-week lapse, and is on a 9-day streak now. Deterministic.
 */
export function seededStore(today = "2026-10-08"): UserStore {
  const store = UserStore.memory()
  let cursor = ALL_CHAPTERS.findIndex((c) => c.book === 40) // starts in Matthew
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31)
  for (let back = 120; back >= 0; back--) {
    const day = addDays(today, -back)
    const dow = parseDay(day).getDay()
    const lapse = back >= 40 && back <= 53
    const skip = lapse || (back > 9 && (dow === 6 ? rand() < 0.6 : rand() < 0.15))
    if (skip) continue
    const n = back === 0 ? 1 : 1 + Math.floor(rand() * 3)
    const start = parseDay(day).getTime() + 7 * 3_600_000
    for (let i = 0; i < n; i++) {
      const c = ALL_CHAPTERS[cursor++ % ALL_CHAPTERS.length]!
      const id = store.startSession({ day, book: c.book, chapter: c.chapter, translation: "KJV", startedAt: start + i * 300_000 })
      store.updateSession(id, 180_000 + Math.floor(rand() * 240_000), start + i * 300_000 + 240_000)
      store.recordRead({ book: c.book, chapter: c.chapter, day, readAt: start + i * 300_000 + 240_000, source: "auto" })
    }
  }
  store.set("plan", { id: "nt-90", startedOn: addDays(today, -30) })
  return store
}
