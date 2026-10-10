import { createHash } from "node:crypto"
import { existsSync, mkdirSync, renameSync, statSync } from "node:fs"
import { join } from "node:path"
import catalogue from "./scenes.json"

/**
 * Gustave Doré's Bible engravings, from Project Gutenberg #8710, The Doré Bible Gallery
 * (public domain). The catalogue (`scenes.json`, built by scripts/dore-catalogue.ts) maps each
 * plate to the passage it shows and pins every image by size and SHA-256; the images
 * themselves download once with `selah install scenes`.
 */
export interface Plate {
  id: string
  title: string
  /** verseEnd null: the whole chapter. null ref: an Apocrypha plate, not on any of the 66 books. */
  ref: { book: number; chapter: number; verseStart: number; verseEnd: number | null } | null
  caption: string
  description: string
  image: { file: string; bytes: number; sha256: string; width: number; height: number }
}

export const PLATES: readonly Plate[] = (catalogue as { plates: Plate[] }).plates
export const SCENES_SOURCE = (catalogue as { images: string }).images
export const SCENES_BYTES = PLATES.reduce((n, p) => n + p.image.bytes, 0)
export const SCENE_ATTRIBUTION = "Engravings by Gustave Doré (1866), from The Doré Bible Gallery, Project Gutenberg #8710. Public domain."

/** Plates showing a passage in this chapter, in verse order. */
export function scenesFor(book: number, chapter: number): Plate[] {
  return PLATES.filter((p) => p.ref?.book === book && p.ref.chapter === chapter).sort((a, b) => a.ref!.verseStart - b.ref!.verseStart)
}

const covers = (p: Plate, verse: number) => verse >= p.ref!.verseStart && (p.ref!.verseEnd === null || verse <= p.ref!.verseEnd)

/** The plate for a verse: one whose passage covers it, else the chapter's nearest before it, else its first. */
export function sceneAt(book: number, chapter: number, verse: number): Plate | undefined {
  const here = scenesFor(book, chapter)
  return here.find((p) => covers(p, verse)) ?? here.filter((p) => p.ref!.verseStart <= verse).at(-1) ?? here[0]
}

export const sceneFile = (dir: string, p: Plate) => join(dir, p.image.file)

/** Installed means every plate is on disk at its pinned size. */
export function scenesInstalled(dir: string): boolean {
  return PLATES.every((p) => {
    const f = sceneFile(dir, p)
    return existsSync(f) && statSync(f).size === p.image.bytes
  })
}

export type ScenesProgress = (e: { done: number; total: number; bytes: number }) => void

/** The install in flight, shared: a second caller (another scene view) joins it. */
let inflight: { dir: string; promise: Promise<{ downloaded: number; total: number }>; listeners: Set<ScenesProgress> } | undefined

/**
 * Downloads the plates that are missing or wrong, four at a time, verifying each against its
 * pinned SHA-256 before it is kept. Plates already on disk at their pinned size are not fetched.
 * Only one install runs at a time; a call while one is running joins it. The first failure
 * stops the others, and no progress is reported once the install has settled.
 */
export function installScenes(dir: string, onProgress?: ScenesProgress, fetcher: typeof fetch = fetch): Promise<{ downloaded: number; total: number }> {
  if (inflight && inflight.dir === dir) {
    if (onProgress) inflight.listeners.add(onProgress)
    return inflight.promise
  }
  const listeners = new Set<ScenesProgress>(onProgress ? [onProgress] : [])
  let settled = false
  const report = (e: { done: number; total: number; bytes: number }) => {
    if (!settled) for (const l of listeners) l(e)
  }
  const run = async () => {
    mkdirSync(dir, { recursive: true })
    const todo = PLATES.filter((p) => {
      const f = sceneFile(dir, p)
      return !existsSync(f) || statSync(f).size !== p.image.bytes
    })
    let done = PLATES.length - todo.length
    let bytes = PLATES.filter((p) => !todo.includes(p)).reduce((n, p) => n + p.image.bytes, 0)
    report({ done, total: PLATES.length, bytes })
    const queue = [...todo]
    let failed = false
    const worker = async () => {
      for (let p = queue.shift(); p && !failed; p = queue.shift()) {
        try {
          const res = await fetcher(`${SCENES_SOURCE}${p.image.file}`)
          if (!res.ok) throw new Error(`Download of plate ${p.id} failed: HTTP ${res.status}`)
          const data = new Uint8Array(await res.arrayBuffer())
          const sha = createHash("sha256").update(data).digest("hex")
          if (data.length !== p.image.bytes || sha !== p.image.sha256) throw new Error(`Plate ${p.id} did not match its pinned checksum`)
          if (failed) return
          const file = sceneFile(dir, p)
          const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.part`
          await Bun.write(tmp, data)
          renameSync(tmp, file)
          done++
          bytes += data.length
          report({ done, total: PLATES.length, bytes })
        } catch (e) {
          failed = true
          throw e
        }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    return { downloaded: todo.length, total: PLATES.length }
  }
  const promise = run().finally(() => {
    settled = true
    if (inflight?.promise === promise) inflight = undefined
  })
  inflight = { dir, promise, listeners }
  return promise
}
