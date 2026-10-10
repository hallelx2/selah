/**
 * Morphology codes in plain English. STEPBible tags Greek words with Robinson's codes
 * ("V-AAI-3S") and Hebrew words with the OSHB scheme per morpheme ("Hc/Vqw3ms"), which mean
 * nothing to most readers; the Words tab shows what they say.
 */

const CASE: Record<string, string> = { N: "nominative", G: "genitive", D: "dative", A: "accusative", V: "vocative" }
const NUMBER: Record<string, string> = { S: "singular", P: "plural" }
const GENDER: Record<string, string> = { M: "masculine", F: "feminine", N: "neuter" }
const PERSON: Record<string, string> = { "1": "1st person", "2": "2nd person", "3": "3rd person" }
const TENSE: Record<string, string> = {
  P: "present",
  I: "imperfect",
  F: "future",
  "2F": "second future",
  A: "aorist",
  "2A": "second aorist",
  R: "perfect",
  "2R": "second perfect",
  L: "pluperfect",
  "2L": "second pluperfect",
  X: "",
}
const VOICE: Record<string, string> = {
  A: "active",
  M: "middle",
  P: "passive",
  E: "middle or passive",
  D: "middle deponent",
  O: "passive deponent",
  N: "middle or passive deponent",
  Q: "impersonal active",
  X: "",
}
const MOOD: Record<string, string> = {
  I: "indicative",
  S: "subjunctive",
  O: "optative",
  M: "imperative",
  N: "infinitive",
  P: "participle",
  R: "participle with imperative sense",
}
const GREEK_POS: Record<string, string> = {
  N: "noun",
  A: "adjective",
  T: "article",
  P: "personal pronoun",
  R: "relative pronoun",
  D: "demonstrative pronoun",
  I: "interrogative pronoun",
  X: "indefinite pronoun",
  Q: "correlative pronoun",
  K: "correlative pronoun",
  F: "reflexive pronoun",
  C: "reciprocal pronoun",
  S: "possessive pronoun",
}
const GREEK_WORDS: Record<string, string> = {
  CONJ: "conjunction",
  PREP: "preposition",
  ADV: "adverb",
  PRT: "particle",
  COND: "conditional particle",
  INJ: "interjection",
  HEB: "Hebrew word",
  ARAM: "Aramaic word",
}
const GREEK_SUFFIX: Record<string, string> = {
  P: "proper name (person)",
  L: "proper name (place)",
  T: "title",
  PRI: "proper name, indeclinable",
  LI: "letter, indeclinable",
  OI: "number, indeclinable",
  NUI: "number, indeclinable",
  C: "comparative",
  S: "superlative",
  I: "interrogative",
  N: "negative",
  K: "crasis",
  ATT: "Attic form",
  ABB: "abbreviated",
}

const cng = (s: string) => [CASE[s[0]!], NUMBER[s[1]!], GENDER[s[2]!]].filter(Boolean).join(" ")

/** "V-AAI-3S" → "verb · aorist active indicative · 3rd person singular". */
export function describeGreek(code: string): string {
  const crasis = /^(.*?)\s*\+\s*G\d+/.exec(code)
  if (crasis) return `${describeGreek(crasis[1]!)} (joined with the next word)`
  const [head = "", ...rest] = code.split("-")
  if (GREEK_WORDS[head]) {
    const suffix = rest.map((r) => GREEK_SUFFIX[r]).filter(Boolean)
    return [GREEK_WORDS[head], ...suffix].join(" · ")
  }
  if (head === "V") {
    const tvm = /^(2?[A-Z])([A-Z])([A-Z])$/.exec(rest[0] ?? "")
    const parts = ["verb"]
    if (tvm) parts.push([TENSE[tvm[1]!], VOICE[tvm[2]!], MOOD[tvm[3]!]].filter(Boolean).join(" "))
    const form = rest[1]
    if (form && /^[123][SP]$/.test(form)) parts.push(`${PERSON[form[0]!]} ${NUMBER[form[1]!]}`)
    else if (form && /^[NGDAV][SP][MFN]$/.test(form)) parts.push(cng(form))
    return parts.join(" · ")
  }
  const pos = GREEK_POS[head]
  if (!pos) return code
  const parts = [pos]
  for (const r of rest) {
    if (/^[NGDAV][SP][MFN]$/.test(r)) parts.push(cng(r))
    else if (/^[123][NGDAV][SP][MFN]?$/.test(r)) parts.push(`${PERSON[r[0]!]} ${cng(r.slice(1))}`)
    else if (/^[NGDAV][SP]$/.test(r)) parts.push(`${CASE[r[0]!]} ${NUMBER[r[1]!]}`)
    else if (/^[123][SP][NGDAV][SP][MFN]$/.test(r)) parts.push(`${PERSON[r[0]!]}, ${NUMBER[r[1]!]} possessor · ${cng(r.slice(2))}`)
    else if (/^[123]$/.test(r)) parts.push(PERSON[r]!)
    else if (GREEK_SUFFIX[r]) parts.push(GREEK_SUFFIX[r]!)
  }
  return parts.join(" · ")
}

const HEB_STEM: Record<string, string> = {
  q: "qal",
  N: "niphal",
  p: "piel",
  P: "pual",
  h: "hiphil",
  H: "hophal",
  t: "hithpael",
  o: "polel",
  O: "polal",
  r: "hithpolel",
  m: "poel",
  M: "poal",
  k: "palel",
  K: "pulal",
  Q: "qal passive",
  l: "pilpel",
  L: "polpal",
  f: "hithpalpel",
  D: "nithpael",
  j: "pealal",
  i: "pilel",
  u: "hothpaal",
  c: "tiphil",
  v: "hishtaphel",
  w: "nithpalel",
  y: "nithpoel",
  z: "hithpoel",
}
const ARAM_STEM: Record<string, string> = {
  q: "peal",
  Q: "peil",
  u: "hithpeel",
  p: "pael",
  P: "ithpaal",
  M: "hithpaal",
  a: "aphel",
  h: "haphel",
  s: "saphel",
  e: "shaphel",
  H: "hophal",
  i: "ithpeel",
  t: "hishtaphel",
  v: "ishtaphel",
  w: "hithaphel",
  o: "polel",
  z: "ithpoel",
  r: "hithpolel",
  f: "hithpalpel",
  b: "hophal",
  c: "tiphel",
  m: "poel",
  l: "palpel",
  L: "ithpalpel",
  O: "ithpolel",
  G: "ittaphal",
}
const HEB_CONJ: Record<string, string> = {
  p: "perfect (qatal)",
  q: "sequential perfect (weqatal)",
  i: "imperfect (yiqtol)",
  w: "sequential imperfect (wayyiqtol)",
  h: "cohortative",
  j: "jussive",
  v: "imperative",
  r: "active participle",
  s: "passive participle",
  a: "infinitive absolute",
  c: "infinitive construct",
}
const HEB_GENDER: Record<string, string> = { m: "masculine", f: "feminine", c: "common", b: "both genders" }
const HEB_NUMBER: Record<string, string> = { s: "singular", p: "plural", d: "dual" }
const HEB_STATE: Record<string, string> = { a: "absolute", c: "construct", d: "determined" }
const HEB_PERSON: Record<string, string> = { "1": "1st person", "2": "2nd person", "3": "3rd person" }

/** person/gender/number/state letters, in whichever of those the code carries */
function pgns(s: string): string {
  const out: string[] = []
  let rest = s
  if (/^[123]/.test(rest)) {
    out.push(HEB_PERSON[rest[0]!]!)
    rest = rest.slice(1)
  }
  const g = HEB_GENDER[rest[0] ?? ""]
  const n = HEB_NUMBER[rest[1] ?? ""]
  const st = HEB_STATE[rest[2] ?? ""]
  if (g || n) out.push([g, n].filter(Boolean).join(" "))
  if (st) out.push(st)
  return out.join(" ")
}

function hebrewMorpheme(m: string, aramaic: boolean): string {
  const pos = m[0]
  const t = m[1] ?? ""
  const rest = m.slice(2)
  switch (pos) {
    case "V": {
      const stem = (aramaic ? ARAM_STEM : HEB_STEM)[t] ?? ""
      const conj = HEB_CONJ[rest[0] ?? ""] ?? ""
      // an infinitive has no person, gender or number; STEPBible's trailing letter there is not one
      const infinitive = rest[0] === "a" || rest[0] === "c"
      return ["verb", [stem, conj].filter(Boolean).join(" "), infinitive ? "" : pgns(rest.slice(1))].filter(Boolean).join(", ")
    }
    case "N": {
      if (t === "p") return `proper name${{ m: " (person)", l: " (place)", t: " (title)" }[rest[0] ?? ""] ?? ""}`
      const kind = t === "g" ? "gentilic noun" : "noun"
      return [kind, pgns(rest)].filter(Boolean).join(", ")
    }
    case "A": {
      const kind = { a: "adjective", c: "number", g: "gentilic adjective", o: "ordinal number" }[t] ?? "adjective"
      return [kind, pgns(rest)].filter(Boolean).join(", ")
    }
    case "P": {
      const kind = { d: "demonstrative pronoun", f: "indefinite pronoun", i: "interrogative pronoun", p: "personal pronoun", r: "relative pronoun" }[t] ?? "pronoun"
      return [kind, pgns(rest)].filter(Boolean).join(", ")
    }
    case "S": {
      if (t === "p") return ["suffix", pgns(rest)].filter(Boolean).join(", ")
      return { d: "directional ending", h: "paragogic he", n: "paragogic nun" }[t] ?? "suffix"
    }
    case "T":
      return (
        { a: "affirming particle", d: "definite article", e: "exhortation", i: "interrogative particle", j: "interjection", m: "demonstrative particle", n: "negative", o: "object marker", r: "relative particle", c: "conjunction" }[t] ??
        "particle"
      )
    case "R":
      return t === "d" ? "preposition with the article" : "preposition"
    case "C":
    case "c":
      return "conjunction"
    case "D":
      return "adverb"
    default:
      return m
  }
}

/** "Hc/Vqw3ms" → "conjunction + verb, qal sequential imperfect (wayyiqtol), 3rd person masculine singular". */
export function describeHebrew(code: string): string {
  const aramaic = code.startsWith("A")
  const body = code.replace(/^[HA]/, "")
  const out = body
    .split("/")
    .filter(Boolean)
    .map((m) => hebrewMorpheme(m, aramaic))
    .join(" + ")
  return aramaic ? `Aramaic: ${out}` : out
}

export function describeMorphology(code: string, book: number): string {
  if (!code) return ""
  return book <= 39 ? describeHebrew(code) : describeGreek(code)
}
