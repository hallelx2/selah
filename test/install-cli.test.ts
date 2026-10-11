// HAL-2656: `selah install` says what it can install, and a failed download is a sentence with a
// way forward, never a crash dump of the bundled source.
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installFailed, installTarget, unknownInstall } from "../src/cli"
import { DownloadError } from "../src/data/download"

const IDS = ["KJV", "BSB", "ASV", "YLT", "NHEB"]
const entry = join(import.meta.dir, "..", "src", "index.tsx")

async function selah(args: string[], env: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), "selah-cli-"))
  const p = Bun.spawn(["bun", entry, ...args], { env: { ...process.env, SELAH_HOME: home, ...env }, stdout: "pipe", stderr: "pipe" })
  const [code, stderr] = await Promise.all([p.exited, new Response(p.stderr).text()])
  return { code, stderr }
}

describe("install targets", () => {
  test("study packs and translations, in any case, and their old names", () => {
    expect(installTarget("scenes", IDS)).toEqual({ pack: "scenes" })
    expect(installTarget("DORE", IDS)).toEqual({ pack: "scenes" })
    expect(installTarget("henry", IDS)).toEqual({ pack: "commentary" })
    expect(installTarget("words", IDS)).toEqual({ pack: "concordance" })
    expect(installTarget("ylt", IDS)).toEqual({ translation: "YLT" })
    expect(installTarget("niv", IDS)).toBeUndefined()
  })

  test("an unknown name lists the translations and the study packs (the founder saw only translations)", () => {
    const m = unknownInstall("SCENS", IDS)
    expect(m).toContain('nothing called "scens"')
    expect(m).toContain("KJV, BSB, ASV, YLT, NHEB")
    for (const pack of ["commentary", "concordance", "scenes"]) expect(m).toContain(pack)
  })

  test("a failed download says what failed and how to try again", () => {
    const e = new DownloadError("Could not download plate 001 from www.gutenberg.org: the server timed out (HTTP 504). Tried 4 times.")
    expect(installFailed("SCENES", { pack: "scenes" }, e)).toBe(
      'Could not download plate 001 from www.gutenberg.org: the server timed out (HTTP 504). Tried 4 times.\nRun "selah install scenes" again to try again. What already downloaded is kept.',
    )
    expect(installFailed("HENRY", { pack: "commentary" }, new Error("disk full"))).toBe(
      'Could not install Matthew Henry\'s Commentary: disk full\nRun "selah install henry" again to try again.',
    )
  })
})

describe("selah install, run for real", () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("not here", { status: 404 }) })
  afterAll(() => server.stop(true))

  test("an unknown name exits 1 with the list, and downloads nothing", async () => {
    const r = await selah(["install", "scens"])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('nothing called "scens"')
    expect(r.stderr).toContain("scenes (Doré's engravings)")
  })

  test("a download that fails ends in plain sentences, not the bundle's source", async () => {
    const r = await selah(["install", "scenes"], { SELAH_SCENES_SOURCE: `http://localhost:${server.port}/dore/` })
    expect(r.code).toBe(1)
    expect(r.stderr).toContain(`Could not download plate`)
    expect(r.stderr).toContain("it is not there (HTTP 404)")
    expect(r.stderr).toContain('Run "selah install scenes" again to try again.')
    expect(r.stderr).not.toContain("    at ")
    expect(r.stderr).not.toMatch(/^\d+ \| /m)
  })
})
