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
  const a = pass(q, t, true)
  const b = pass(q, t, false)
  if (!a) return b
  if (!b) return a
  return a.score >= b.score ? a : b
}

export function fuzzyFilter<T>(query: string, items: T[], text: (item: T) => string): { item: T; match: FuzzyMatch }[] {
  if (!query.trim()) return items.map((item) => ({ item, match: { score: 0, indices: [] } }))
  return items
    .map((item) => ({ item, match: fuzzy(query, text(item)) }))
    .filter((x): x is { item: T; match: FuzzyMatch } => x.match !== null)
    .sort((a, b) => b.match.score - a.match.score)
}
