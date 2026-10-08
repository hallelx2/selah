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
