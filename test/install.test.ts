// The installers (HAL-2624): install.sh and install.ps1, run for real against a local server
// standing in for the GitHub release. install.ps1 runs the way users run it, piped through
// `irm | iex`, under PowerShell 7 when one is available (PWSH=/path/to/pwsh or pwsh on PATH).
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const pwsh = process.env.PWSH ?? Bun.which("pwsh")
const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex")

/** Async on purpose: the release stand-in is served from this process, and a sync spawn would block it. */
async function spawn(cmd: string[], env: Record<string, string | undefined>) {
  const p = Bun.spawn(cmd, { env: env as Record<string, string>, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  return { exitCode: await p.exited, stdout, stderr }
}

// a stand-in binary: prints a version like the real one
const fakeUnix = "#!/bin/sh\necho 9.9.9\n"
const fakeExe = "MZ fake windows executable for the installer test"
let files: Record<string, string> = {}
let server: ReturnType<typeof Bun.serve>
let base: string

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const name = new URL(req.url).pathname.slice(1)
      if (name === "install.ps1") return new Response(readFileSync(join(root, "install.ps1")))
      return name in files ? new Response(files[name]) : new Response("not found", { status: 404 })
    },
  })
  base = `http://localhost:${server.port}`
})
afterAll(() => server.stop(true))

const release = (over: Partial<Record<string, string>> = {}) => {
  const assets: Record<string, string> = {
    "selah-linux-x64": fakeUnix,
    "selah-linux-arm64": fakeUnix,
    "selah-darwin-arm64": fakeUnix,
    "selah-darwin-x64": fakeUnix,
    "selah-windows-x64.exe": fakeExe,
    "selah-windows-arm64.exe": fakeExe,
  }
  const sums = Object.entries(assets)
    .map(([n, b]) => `${sha(b)}  ${n}`)
    .join("\n")
  files = { ...assets, SHA256SUMS: `${sums}\n`, ...over }
}

describe("install.sh", () => {
  test("installs the binary for this machine and verifies its checksum", async () => {
    release()
    const dir = mkdtempSync(join(tmpdir(), "selah-sh-"))
    const p = await spawn(["sh", join(root, "install.sh")], { ...process.env, SELAH_DOWNLOAD_BASE: base, SELAH_INSTALL_DIR: dir })
    const out = p.stdout + p.stderr
    expect(p.exitCode).toBe(0)
    expect(out).toContain("checksum ok")
    expect(out).toContain(`installed 9.9.9 to ${dir}/selah`)
    rmSync(dir, { recursive: true, force: true })
  })

  test("refuses a binary that does not match its checksum", async () => {
    release({ "selah-linux-x64": "#!/bin/sh\necho tampered\n", "selah-linux-arm64": "tampered" })
    const dir = mkdtempSync(join(tmpdir(), "selah-sh-"))
    const p = await spawn(["sh", join(root, "install.sh")], { ...process.env, SELAH_DOWNLOAD_BASE: base, SELAH_INSTALL_DIR: dir })
    expect(p.exitCode).not.toBe(0)
    expect(p.stderr).toContain("checksum mismatch")
    expect(existsSync(join(dir, "selah"))).toBe(false)
  })
})

describe.skipIf(!pwsh)("install.ps1 (PowerShell)", () => {
  const run = (script: string, dir: string, extra: Record<string, string> = {}) =>
    spawn([pwsh!, "-NoProfile", "-NonInteractive", "-Command", script], { ...process.env, SELAH_DOWNLOAD_BASE: base, SELAH_INSTALL_DIR: dir, HOME: dir, ...extra })

  test("irm | iex installs selah.exe for this processor and verifies its checksum", async () => {
    release()
    const dir = mkdtempSync(join(tmpdir(), "selah-ps-"))
    const p = await run(`irm ${base}/install.ps1 | iex`, dir)
    const out = p.stdout
    expect(p.exitCode).toBe(0)
    const arch = process.arch === "arm64" ? "arm64" : "x64"
    expect(out).toContain(`downloading selah-windows-${arch}.exe (latest)`)
    expect(out).toContain("checksum ok")
    expect(readFileSync(join(dir, "selah.exe"), "utf8")).toBe(fakeExe)
    // off Windows it cannot touch the registry PATH, so it says what to add instead
    expect(out).toContain(`add ${dir} to your PATH`)
  })

  test("a checksum mismatch throws, installs nothing, and leaves the caller's shell running", async () => {
    release({ "selah-windows-x64.exe": "tampered", "selah-windows-arm64.exe": "tampered" })
    const dir = mkdtempSync(join(tmpdir(), "selah-ps-"))
    const p = await run(`try { irm ${base}/install.ps1 | iex } catch { "CAUGHT: $($_.Exception.Message)" }; "STILL-HERE"`, dir)
    const out = p.stdout
    expect(out).toMatch(/CAUGHT: Checksum mismatch for selah-windows-(x64|arm64)\.exe/)
    expect(out).toContain("STILL-HERE") // no exit: the user's window stays open
    expect(existsSync(join(dir, "selah.exe"))).toBe(false)
  })

  test("a missing asset says which URL failed", async () => {
    release()
    delete files["selah-windows-x64.exe"]
    delete files["selah-windows-arm64.exe"]
    const dir = mkdtempSync(join(tmpdir(), "selah-ps-"))
    const p = await run(`try { irm ${base}/install.ps1 | iex } catch { "CAUGHT: $($_.Exception.Message)" }`, dir)
    expect(p.stdout).toMatch(/CAUGHT: Could not download http:\/\/localhost:\d+\/selah-windows-(x64|arm64)\.exe/)
  })

  test("SELAH_VERSION picks a release tag", async () => {
    release()
    const dir = mkdtempSync(join(tmpdir(), "selah-ps-"))
    const p = await run(`irm ${base}/install.ps1 | iex`, dir, { SELAH_VERSION: "v0.3.1" })
    expect(p.stdout).toContain("(v0.3.1)")
  })
})

test("both installers name exactly the assets the release build produces", async () => {
  const { RELEASE_TARGETS } = await import("../scripts/build")
  const assets = RELEASE_TARGETS.map((t) => `selah-${t.replace(/^bun-/, "")}${t.includes("windows") ? ".exe" : ""}`)
  expect(assets).toContain("selah-windows-x64.exe")
  expect(assets).toContain("selah-windows-arm64.exe")
  const ps = readFileSync(join(root, "install.ps1"), "utf8")
  expect(ps).toContain('$asset = "selah-windows-$arch.exe"')
  const sh = readFileSync(join(root, "install.sh"), "utf8")
  expect(sh).toContain('asset="selah-$os-$arch$libc"')
  chmodSync(join(root, "install.sh"), 0o755)
})
