/**
 * Hebrew in a terminal. Terminals lay text out left to right, one cell per character, and
 * almost none apply the Unicode bidirectional algorithm, so a Hebrew word printed as stored
 * reads backwards. Selah reverses it by grapheme (a letter with its vowel points stays
 * together) unless the reader's terminal does bidi itself (`"hebrew": "logical"` in config).
 */

/** Cantillation marks (te'amim, U+0591–U+05AF) and meteg; vowel points and dagesh stay. */
const CANTILLATION = /[֑-ֽ֯]/g

export const stripCantillation = (s: string) => s.replace(CANTILLATION, "")

const graphemes = new Intl.Segmenter("he", { granularity: "grapheme" })

export const isHebrew = (s: string) => /[֐-׿]/.test(s)

/** The word as it should be drawn, left to right, in a terminal without bidi. */
export function displayHebrew(s: string, mode: "visual" | "logical" = "visual"): string {
  const clean = stripCantillation(s)
  if (mode === "logical" || !isHebrew(clean)) return clean
  return [...graphemes.segment(clean)].map((g) => g.segment).reverse().join("")
}
