export interface FuzzyMatch {
  score: number
  /** Indices into the text that matched, for highlighting. */
  indices: number[]
}

const isBoundary = (t: string, i: number) => i === 0 || /[\s\-_:./,]/.test(t[i - 1]!)

/**
 * One matching pass. With `preferWords`, a query character jumps ahead to the next word
 * start ("st" → "Switch Theme") unless it continues the current run ("gos" in "Gospels").
 */
function pass(q: string, t: string, preferWords: boolean): FuzzyMatch | null {
  const indices: number[] = []
  let score = 0
  let ti = 0
  let prev = -2
  for (const ch of q) {
    let found = -1
    let first = -1
    for (let i = ti; i < t.length; i++) {
      if (t[i] !== ch) continue
      if (first === -1) first = i
      if (!preferWords || i === prev + 1 || isBoundary(t, i)) {
        found = i
        break
      }
    }
    if (found === -1) found = first
    if (found === -1) return null
    score += 1
    if (isBoundary(t, found)) score += 8
    if (found === prev + 1) score += 5
    score -= Math.min(found - ti, 6) * 0.5
    indices.push(found)
    prev = found
    ti = found + 1
  }
  if (t.startsWith(q)) score += 20
  score -= t.length * 0.05
  return { score, indices }
}

/**
 * Subsequence matching with the bonuses that make a palette feel right: word starts and
 * consecutive runs score higher, a prefix beats everything. Two passes so preferring word
 * starts can never lose a match that plain left-to-right matching would find.
 */
export function fuzzy(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, "")
  if (!q) return { score: 0, indices: [] }
  const t = text.toLowerCase()
  const a = coherent(pass(q, t, true), t)
  const b = coherent(pass(q, t, false), t)
  const c = substring(q, t)
  const best = [a, b, c].reduce<FuzzyMatch | null>((x, y) => (!y ? x : !x || y.score > x.score ? y : x), null)
  if (!best) return null
  // a query that is a whole word of the text ("ai", "help", "greek") outranks any partial match
  const words = query.toLowerCase().trim().split(/\s+/)
  if (words.every((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[^a-z0-9]/g, "")}([^a-z0-9]|$)`).test(t))) best.score += 40
  return best
}

/**
 * The query as one unbroken run of the text, at a word start when it occurs at one. Greedy
 * left-to-right matching can miss it: "ai" takes the "a" of "ask" before reaching "ai".
 */
function substring(q: string, t: string): FuzzyMatch | null {
  let at = -1
  for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + 1)) {
    if (isBoundary(t, i)) {
      at = i
      break
    }
    if (at === -1) at = i
  }
  if (at === -1) return null
  const indices = Array.from(q, (_, k) => at + k)
  let score = q.length * 6 + (isBoundary(t, at) ? 8 : 0) - Math.min(at, 6) * 0.5 - t.length * 0.05
  if (t.startsWith(q)) score += 20
  return { score, indices }
}

/**
 * Letters scattered through a phrase are noise, not intent: "greek" picked out of
 * "pro*g*ress and st*reak*s", "chat" out of "*cha*p*t*er". A match counts when it is one
 * unbroken run of the text, or when every run starts a word ("gtb" → Go To Book).
 */
function coherent(m: FuzzyMatch | null, t: string): FuzzyMatch | null {
  if (!m || m.indices.length < 2) return m
  const runs: number[] = [m.indices[0]!]
  for (let i = 1; i < m.indices.length; i++) if (m.indices[i] !== m.indices[i - 1]! + 1) runs.push(m.indices[i]!)
  if (runs.length === 1) return m
  return runs.every((start) => isBoundary(t, start)) ? m : null
}

export function fuzzyFilter<T>(query: string, items: T[], text: (item: T) => string): { item: T; match: FuzzyMatch }[] {
  if (!query.trim()) return items.map((item) => ({ item, match: { score: 0, indices: [] } }))
  return items
    .map((item) => ({ item, match: fuzzy(query, text(item)) }))
    .filter((x): x is { item: T; match: FuzzyMatch } => x.match !== null)
    .sort((a, b) => b.match.score - a.match.score)
}
