import { Database } from "bun:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { Bible } from "../src/data/bible"
import { openBibleDb } from "../src/data/db"
import { importTranslation } from "../src/data/importer"

const root = join(import.meta.dir, "..")
process.env.SELAH_SOURCES = join(root, ".selah-test-sources")
process.env.SELAH_HOME = join(root, ".selah-test-home")

/** One imported KJV + BSB database shared by every test file; built on first use. */
export async function fixtureBible(): Promise<Bible> {
  const dir = join(root, ".selah-test-home")
  mkdirSync(dir, { recursive: true })
  const file = join(dir, "fixture-bible.db")
  if (!existsSync(file) || !new Database(file, { readonly: true }).query(`SELECT 1 FROM translations WHERE id = 'BSB'`).get()) {
    const db = openBibleDb(file)
    await importTranslation(db, "KJV")
    await importTranslation(db, "BSB")
    db.close()
  }
  return new Bible(openBibleDb(file))
}

/** Matthew Henry imported once from the cached pinned tarball into a shared fixture study.db. */
export async function fixtureCommentary() {
  const { Commentary, COMMENTARY_URL, importCommentary } = await import("../src/data/commentary")
  const { readTar } = await import("../src/data/tar")
  const dir = join(root, ".selah-test-home")
  mkdirSync(dir, { recursive: true })
  const file = join(dir, "fixture-study.db")
  const db = new Database(file, { create: true })
  const c = new Commentary(db)
  if (c.installed) return c
  const tarFile = join(root, ".selah-test-sources", "mhenry-complete.tar.gz")
  if (!existsSync(tarFile)) await Bun.write(tarFile, await (await fetch(COMMENTARY_URL)).arrayBuffer())
  const decoder = new TextDecoder()
  const files = [...readTar(new Uint8Array(await Bun.file(tarFile).arrayBuffer()))].map((e) => ({ path: e.path, text: decoder.decode(e.data) }))
  importCommentary(db, files)
  return c
}

/** The STEPBible concordance imported once into its own fixture db (the pinned files download on first use). */
export async function fixtureConcordance() {
  const { Concordance, installConcordance } = await import("../src/data/concordance")
  const dir = join(root, ".selah-test-home")
  mkdirSync(dir, { recursive: true })
  const db = new Database(join(dir, "fixture-concordance.db"), { create: true })
  const c = new Concordance(db)
  if (!c.installed) await installConcordance(db, join(root, ".selah-test-sources"))
  return c
}
