export interface TranslationInfo {
  id: string
  name: string
  year: number
  description: string
  license: string
  /** Installed on first run. */
  default?: boolean
}

/**
 * Source texts come from scrollmapper/bible_databases (MIT), pinned to one commit so an
 * import is reproducible. Every text listed here is in the public domain.
 */
export const SOURCE_COMMIT = "e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c"
export const sourceUrl = (id: string) =>
  `https://raw.githubusercontent.com/scrollmapper/bible_databases/${SOURCE_COMMIT}/formats/json/${id}.json`

export const CATALOG: readonly TranslationInfo[] = [
  {
    id: "KJV",
    name: "King James Version",
    year: 1769,
    description: "The Authorized Version, Blayney's 1769 Oxford text. Words the translators supplied are shown in italics.",
    license: "Public domain",
    default: true,
  },
  {
    id: "BSB",
    name: "Berean Standard Bible",
    year: 2022,
    description: "A modern, readable translation from the original languages, dedicated to the public domain in 2023.",
    license: "Public domain (CC0)",
    default: true,
  },
  {
    id: "ASV",
    name: "American Standard Version",
    year: 1901,
    description: "The American revision of the KJV, known for its literal precision.",
    license: "Public domain",
  },
  {
    id: "YLT",
    name: "Young's Literal Translation",
    year: 1898,
    description: "Robert Young's word-for-word rendering, preserving Hebrew and Greek tense.",
    license: "Public domain",
  },
  {
    id: "NHEB",
    name: "New Heart English Bible",
    year: 2010,
    description: "A modern English update of the World English Bible tradition.",
    license: "Public domain",
  },
]

export function translationInfo(id: string): TranslationInfo | undefined {
  return CATALOG.find((t) => t.id === id)
}
