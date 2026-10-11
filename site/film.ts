// The product demo's length in words, for the /demo page.

/** "3 minutes and 20 seconds", "1 minute", "45 seconds". */
export function filmLength(seconds: number): string {
  const s = Math.round(seconds)
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  const m = Math.floor(s / 60)
  const r = s % 60
  return m === 0 ? unit(r, "second") : r === 0 ? unit(m, "minute") : `${unit(m, "minute")} and ${unit(r, "second")}`
}
