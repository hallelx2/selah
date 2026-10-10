import { dayKey, type DayKey } from "./dates"
import type { UserStore } from "./user"

/** A gap between key presses longer than this is treated as time away, and not counted at all. */
export const IDLE_MS = 3 * 60_000

/** Average silent reading speed, in words per minute. */
const WPM = 250

/**
 * The least active time on a chapter before reaching its end counts as reading it:
 * 30% of the time it would take at 250 wpm, never less than 1s, never more than 30s.
 * A long chapter skimmed in two seconds does not count; Psalm 117 read properly does.
 */
export function minimumReadMs(words: number): number {
  return Math.round(Math.min(30_000, Math.max(1_000, (words / WPM) * 60_000 * 0.3)))
}

interface Open {
  book: number
  chapter: number
  translation: string
  words: number
  sessionId: number
  day: DayKey
  last: number
  activeMs: number
  reachedEnd: boolean
  recorded: boolean
}

export type ReadListener = (event: { book: number; chapter: number; day: DayKey; source: "auto" | "manual" }) => void

/**
 * Turns reader input into honest records: active time per chapter, and a chapter read only
 * when it was actually read. Time comes from the injected clock so the rules are testable.
 */
export class ReadingTracker {
  private current: Open | undefined
  private listeners = new Set<ReadListener>()
  lastSessionActiveMs = 0

  constructor(
    private store: UserStore,
    private clock: () => number = Date.now,
  ) {}

  onRead(fn: ReadListener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  get active() {
    return this.current
  }

  open(c: { book: number; chapter: number; translation: string; words: number }) {
    const cur = this.current
    if (cur && cur.book === c.book && cur.chapter === c.chapter && cur.day === dayKey(this.clock())) {
      // Same chapter, perhaps a different translation: keep the session going.
      cur.translation = c.translation
      this.activity()
      return
    }
    this.close()
    const now = this.clock()
    const day = dayKey(now)
    const sessionId = this.store.startSession({ day, book: c.book, chapter: c.chapter, translation: c.translation, startedAt: now })
    this.current = {
      ...c,
      sessionId,
      day,
      last: now,
      activeMs: 0,
      reachedEnd: false,
      recorded: this.store.readOn(c.book, c.chapter, day),
    }
  }

  /** Call on every key press or scroll in the reader. */
  activity() {
    const c = this.current
    if (!c) return
    const now = this.clock()
    const gap = now - c.last
    if (gap > 0 && gap <= IDLE_MS) c.activeMs += gap
    c.last = now
    this.store.updateSession(c.sessionId, c.activeMs, now)
    this.check()
  }

  /** The reader has scrolled the last verse into view. */
  reachedEnd() {
    const c = this.current
    if (!c) return
    c.reachedEnd = true
    this.check()
  }

  markRead() {
    const c = this.current
    if (!c) return
    this.record(c, "manual")
  }

  /** Removes the open chapter's read for its session day, so it can be read (or marked) again. */
  unmarkRead() {
    const c = this.current
    if (!c) return
    this.store.unrecordRead(c.book, c.chapter, c.day)
    c.recorded = false
  }

  /** The day reads in the open session are credited to: the day the session started. */
  get day(): DayKey | undefined {
    return this.current?.day
  }

  /** Active milliseconds on the open chapter so far. */
  get activeMs() {
    return this.current?.activeMs ?? 0
  }

  get requiredMs() {
    return this.current ? minimumReadMs(this.current.words) : 0
  }

  close() {
    const c = this.current
    if (!c) return
    // The session ends at the last sign of life, not when the app noticed it was gone.
    this.store.updateSession(c.sessionId, c.activeMs, c.last)
    this.lastSessionActiveMs = c.activeMs
    this.current = undefined
  }

  private check() {
    const c = this.current
    if (!c || c.recorded || !c.reachedEnd) return
    if (c.activeMs >= minimumReadMs(c.words)) this.record(c, "auto")
  }

  private record(c: Open, source: "auto" | "manual") {
    // A read is credited to the day the session started, so midnight never splits a chapter.
    const inserted = this.store.recordRead({ book: c.book, chapter: c.chapter, day: c.day, readAt: this.clock(), source })
    c.recorded = true
    if (inserted) for (const fn of this.listeners) fn({ book: c.book, chapter: c.chapter, day: c.day, source })
  }
}
