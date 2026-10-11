// Compiles Selah into one self-contained executable: Bun runtime, OpenTUI's native core,
// the themes and the app. Translations are downloaded on first run, not bundled.
//
//   bun scripts/build.ts                 dist/selah for this machine
//   bun scripts/build.ts --release       every release target plus dist/release/SHA256SUMS
//   bun scripts/build.ts bun-linux-arm64 one or more named targets
//
// Cross-compiling needs every platform's OpenTUI core: bun install --os='*' --cpu='*'
import solidPlugin from "@opentui/solid/bun-plugin"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename } from "node:path"

export const RELEASE_TARGETS = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-linux-x64-musl",
  "bun-linux-arm64-musl",
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-windows-x64",
  "bun-windows-arm64",
]

/** Bun's name for a platform: Node says "win32", Bun's compile targets say "windows". */
export const bunTarget = (platform: string, arch: string) => `bun-${platform === "win32" ? "windows" : platform}-${arch}`

async function build() {
  const args = process.argv.slice(2)
  const release = args.includes("--release")
  const named = args.filter((a) => !a.startsWith("--"))
  const outDir = release ? "dist/release" : "dist"
  if (release) rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const here = bunTarget(process.platform, process.arch)
  const targets = release ? RELEASE_TARGETS : named.length ? named : [here]
  const built: string[] = []

  for (const target of targets) {
    // Bun names a Windows executable .exe itself; the release asset carries the same name.
    const exe = target.includes("windows") ? ".exe" : ""
    const outfile = release || named.length ? `${outDir}/selah-${target.replace(/^bun-/, "")}` : "dist/selah"
    const result = await Bun.build({
      entrypoints: ["./src/index.tsx"],
      target: "bun",
      plugins: [solidPlugin],
      minify: true,
      sourcemap: release ? "none" : "linked",
      // A user running selah inside some project must never pick up that project's bunfig or .env.
      compile: { target: target as never, outfile, autoloadBunfig: false, autoloadDotenv: false } as never,
    })
    if (!result.success) {
      for (const log of result.logs) console.error(log)
      process.exit(1)
    }
    built.push(outfile + exe)
    console.log(`built ${outfile + exe}`)
  }

  if (release) {
    const sums = built.map((f) => `${createHash("sha256").update(readFileSync(f)).digest("hex")}  ${basename(f)}`)
    writeFileSync(`${outDir}/SHA256SUMS`, sums.join("\n") + "\n")
    console.log(`wrote ${outDir}/SHA256SUMS`)
  }
}

// Importing this file (tests read RELEASE_TARGETS) must never start a build.
if (import.meta.main) await build()
