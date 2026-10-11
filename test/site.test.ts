// selah.hallelx2.com (HAL-2637 to HAL-2642): the built site keeps its promises. The docs' commands
// are real, /keys is the app's own key list, the privacy page names every request the code can
// make, the tour is whole, every internal link lands, and every download link answers.
import { beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { BOOKS } from "../src/data/books"
import { parseRef } from "../src/data/ref"
import { PLATES } from "../src/data/scenes"
import { CATALOG } from "../src/data/translations"
import { KEYS } from "../src/ui/keys"

const root = join(import.meta.dir, "..")
const dist = join(root, "site", "dist")
const read = (p: string) => readFileSync(join(dist, p), "utf8")
const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')

beforeAll(async () => {
  const build = Bun.spawn(["bun", join(root, "site", "build.ts")], { stdout: "pipe", stderr: "pipe" })
  const [code, err] = await Promise.all([build.exited, new Response(build.stderr).text()])
  if (code !== 0) throw new Error(`site build failed:\n${err}`)
}, 600_000)

describe("the site", () => {
  test("builds every page", () => {
    for (const p of ["index", "docs", "keys", "engravings", "download", "changelog", "privacy", "404"]) expect(existsSync(join(dist, `${p}.html`))).toBe(true)
  })

  test("the home page's numbers are the measured ones", () => {
    const home = read("index.html")
    const n = (x: number) => `<b>${x.toLocaleString("en-US")}</b>`
    expect(home).toContain(n(BOOKS.length))
    expect(home).toContain(n(31_102))
    expect(home).toContain(n(CATALOG.length))
    expect(home).toContain(n(PLATES.length))
    expect(home).toContain(n(readdirSync(join(root, "src/theme/assets")).filter((f) => f.endsWith(".json")).length))
  })

  test("every command in the docs is one Selah has", async () => {
    const md = readFileSync(join(root, "site/content/docs.md"), "utf8")
    const help = await Bun.$`bun ${join(root, "src/index.tsx")} --help`.text()
    const blocks = [...md.matchAll(/```(?:sh|powershell)\n([\s\S]*?)```/g)].map((m) => m[1]!)
    const commands = blocks.flatMap((b) => b.split("\n")).filter((l) => /(^|\s)selah\s/.test(l) && !/selah\.hallelx2\.com/.test(l))
    expect(commands.length).toBeGreaterThan(5)
    const installable = new Set([...CATALOG.map((t) => t.id), "commentary", "concordance", "scenes"])
    for (const line of commands) {
      const args = line.slice(line.lastIndexOf("selah ") + 6).trim().split(/\s+/)
      const [verb, ...rest] = args
      if (verb === "install") for (const what of rest) expect(installable.has(what!)).toBe(true)
      else if (["mcp", "stats", "search", "translations", "notes"].includes(verb!)) expect(help).toContain(`selah ${verb}`)
      else expect(parseRef(args.join(" "))).not.toBeNull()
    }
  })

  test("/keys is the app's own key list", () => {
    const keys = unescape(read("keys.html"))
    for (const [group, rows] of KEYS) {
      expect(keys).toContain(group)
      for (const [, what] of rows) expect(keys).toContain(what)
    }
  })

  test("the privacy page names every file that makes a request", () => {
    const privacy = readFileSync(join(root, "site/content/privacy.md"), "utf8")
    const files: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name)
        if (f.isDirectory()) walk(p)
        else if (/\.tsx?$/.test(f.name) && /\b(fetch|fetcher)\(/.test(readFileSync(p, "utf8"))) files.push(p.slice(root.length + 1))
      }
    }
    walk(join(root, "src"))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      // the scene viewer starts the scenes install, which privacy lists under src/data/scenes.ts
      const named = f === "src/ui/scene.tsx" ? "src/data/scenes.ts" : f
      expect(privacy).toContain(named)
    }
    for (const host of ["raw.githubusercontent.com", "codeload.github.com", "www.gutenberg.org", "selah.hallelx2.com/scenes"]) expect(privacy).toContain(host)
  })

  test("the tours are whole: every step has its screen, and every step but the last a key", () => {
    for (const file of ["tour.json", "tour-narrow.json"]) {
      const t = JSON.parse(read(`media/${file}`)) as { cols: number; rows: number; palette: string[]; frames: [string, number, number, number][][][]; steps: { frame: number; key?: string; caption: string }[] }
      expect(t.steps.length).toBeGreaterThan(10)
      for (const [i, s] of t.steps.entries()) {
        expect(t.frames[s.frame]).toBeDefined()
        expect(t.frames[s.frame]!.length).toBe(t.rows)
        if (i < t.steps.length - 1) expect(s.key).toBeTruthy()
        expect(s.caption.length).toBeGreaterThan(5)
      }
      for (const frame of t.frames) for (const line of frame) for (const [, fg, bg] of line) expect(t.palette[fg] !== undefined && t.palette[bg] !== undefined).toBe(true)
      expect(Bun.gzipSync(readFileSync(join(dist, "media", file))).length).toBeLessThan(400_000)
    }
  })

  test("every internal link and anchor lands", () => {
    const pages = readdirSync(dist).filter((f) => f.endsWith(".html"))
    const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
    for (const page of pages) {
      const html = read(page)
      for (const [, href] of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
        const [path, hash] = href!.split("#")
        const target = path === "/" ? "index.html" : path!.slice(1)
        const file = [target, `${target}.html`].find((f) => f && existsSync(join(dist, f)))
        expect(file, `${page} links to ${href}`).toBeDefined()
        if (hash && file?.endsWith(".html")) expect(ids(read(file)).has(hash), `${page} links to ${href}`).toBe(true)
      }
      for (const [, hash] of html.matchAll(/href="#([^"]+)"/g)) {
        // the gallery's plate links are opened by its script, and the plates are ids in its data
        if (page === "engravings.html" && /^\d{3}$/.test(hash!)) continue
        expect(ids(html).has(hash!), `${page} links to #${hash}`).toBe(true)
      }
    }
  })

  test("the site mirrors every plate byte for byte, so the app can fetch them from here", async () => {
    const { createHash } = await import("node:crypto")
    for (const p of PLATES) {
      const data = readFileSync(join(dist, "scenes", p.image.file))
      expect(createHash("sha256").update(data).digest("hex"), p.id).toBe(p.image.sha256)
    }
  })

  test("/demo lists every chapter of the film, in order, each within it", () => {
    const { chapters: marks, duration } = JSON.parse(readFileSync(join(root, "docs/demo/selah-product-demo-chapters.json"), "utf8")) as {
      duration: number
      chapters: { name: string; start: number }[]
    }
    expect(marks.at(-1)!.start).toBeLessThan(duration)
    const html = read("demo.html")
    const seeks = [...html.matchAll(/data-seek="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(seeks).toEqual(marks.map((m) => m.start))
    expect(seeks.every((t, i) => i === 0 || t > seeks[i - 1]!)).toBe(true)
    // every chapter has a human title, not its file name
    for (const m of marks) expect(html).not.toContain(`<span>${m.name}</span>`)
    expect(existsSync(join(dist, "selah-product-demo.mp4"))).toBe(true)
  })

  test("the film's length reads as a person would say it", async () => {
    const { filmLength } = await import("../site/film")
    expect(filmLength(200)).toBe("3 minutes and 20 seconds")
    expect(filmLength(60)).toBe("1 minute")
    expect(filmLength(61)).toBe("1 minute and 1 second")
    expect(filmLength(45)).toBe("45 seconds")
  })

  test("/download offers what the installers install: never a pre-release", async () => {
    const { latestRelease } = await import("../site/pages")
    const r = (tag: string, prerelease = false) => ({ tag, name: tag, date: "2026-10-11T00:00:00Z", html: "", url: "", prerelease, assets: [] })
    expect(latestRelease([r("v0.4.0-rc1", true), r("v0.3.1"), r("v0.3.0")]).tag).toBe("v0.3.1")
    expect(() => latestRelease([r("v0.4.0-rc1", true)])).toThrow("no published release")
  })

  test("every download link answers", async () => {
    const html = read("download.html")
    const links = [...html.matchAll(/href="(https:\/\/github\.com\/hallelx2\/selah\/releases\/download\/[^"]+)"/g)].map((m) => m[1]!)
    expect(links.length).toBeGreaterThanOrEqual(9)
    const codes = await Promise.all(links.map(async (l) => (await fetch(l, { method: "HEAD", redirect: "follow" })).status))
    for (const [i, c] of codes.entries()) expect(c, links[i]).toBe(200)
  }, 60_000)
})
