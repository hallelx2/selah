import { beforeEach, describe, expect, test } from "bun:test"
import { ReadingTracker, minimumReadMs, IDLE_MS } from "../src/data/tracker"
import { UserStore } from "../src/data/user"
import { dayKey } from "../src/data/dates"

let now = 0
const clock = () => now
let store: UserStore

beforeEach(() => {
  now = new Date(2026, 9, 8, 7, 0, 0).getTime()
  store = UserStore.memory()
})

const tracker = () => new ReadingTracker(store, clock)

describe("minimumReadMs", () => {
  test("scales with length and caps at 30s", () => {
    expect(minimumReadMs(33)).toBeLessThan(3000) // Psalm 117
    expect(minimumReadMs(800)).toBe(30_000) // a long chapter
    expect(minimumReadMs(0)).toBeGreaterThanOrEqual(1000)
  })
})

describe("ReadingTracker", () => {
  test("active time counts gaps between input, and drops gaps longer than the idle limit", () => {
    const t = tracker()
    t.open({ book: 43, chapter: 3, translation: "KJV", words: 800 })
    for (let i = 0; i < 6; i++) {
      now += 10_000
      t.activity()
    }
    now += IDLE_MS + 60_000 // walked away
    t.activity()
    now += 5_000
    t.activity()
    t.close()
    expect(t.lastSessionActiveMs).toBe(65_000)
    expect(store.sessionsOn(dayKey(now))[0]?.activeMs).toBe(65_000)
  })

  test("a skim to the end in 2 seconds is not a read", () => {
    const t = tracker()
    t.open({ book: 43, chapter: 3, translation: "KJV", words: 800 })
    now += 2_000
    t.activity()
    t.reachedEnd()
    t.close()
    expect(store.chapterReads().length).toBe(0)
  })

  test("reaching the end after enough active time records the chapter once", () => {
    const t = tracker()
    t.open({ book: 43, chapter: 3, translation: "KJV", words: 800 })
    for (let i = 0; i < 4; i++) {
      now += 9_000
      t.activity()
    }
    t.reachedEnd()
    expect(store.chapterReads().length).toBe(1)
    now += 5_000
    t.activity()
    t.reachedEnd()
    expect(store.chapterReads().length).toBe(1)
    expect(store.chapterReads()[0]).toMatchObject({ book: 43, chapter: 3, source: "auto", day: "2026-10-08" })
  })

  test("reaching the end early, then reading on long enough, still counts", () => {
    const t = tracker()
    t.open({ book: 19, chapter: 23, translation: "KJV", words: 120 })
    t.reachedEnd()
    expect(store.chapterReads().length).toBe(0)
    for (let i = 0; i < 4; i++) {
      now += 3_000
      t.activity()
    }
    expect(store.chapterReads().length).toBe(1)
  })

  test("marking read manually twice in a day records one completion", () => {
    const t = tracker()
    t.open({ book: 1, chapter: 1, translation: "KJV", words: 800 })
    t.markRead()
    t.markRead()
    expect(store.chapterReads()).toHaveLength(1)
    expect(store.chapterReads()[0]?.source).toBe("manual")
  })

  test("the same chapter on two different days counts on both days", () => {
    const t = tracker()
    t.open({ book: 1, chapter: 1, translation: "KJV", words: 800 })
    t.markRead()
    now += 86_400_000
    t.open({ book: 1, chapter: 1, translation: "KJV", words: 800 })
    t.markRead()
    expect(store.chapterReads().map((r) => r.day)).toEqual(["2026-10-08", "2026-10-09"])
  })

  test("opening another chapter closes the previous session", () => {
    const t = tracker()
    t.open({ book: 1, chapter: 1, translation: "KJV", words: 800 })
    now += 20_000
    t.activity()
    t.open({ book: 1, chapter: 2, translation: "KJV", words: 800 })
    now += 10_000
    t.activity()
    t.close()
    const sessions = store.sessionsOn("2026-10-08")
    expect(sessions.map((s) => [s.chapter, s.activeMs])).toEqual([
      [1, 20_000],
      [2, 10_000],
    ])
  })

  test("a session that crosses midnight is credited to the day it started", () => {
    now = new Date(2026, 9, 8, 23, 59, 50).getTime()
    const t = tracker()
    t.open({ book: 1, chapter: 1, translation: "KJV", words: 800 })
    now += 20_000
    t.activity()
    t.close()
    expect(store.sessionsOn("2026-10-08")[0]?.activeMs).toBe(20_000)
  })
})
