// Compiles Selah into one self-contained executable: Bun runtime, OpenTUI's native core,
// the themes and the app. Translations are downloaded on first run, not bundled.
import solidPlugin from "@opentui/solid/bun-plugin"
import { mkdirSync } from "node:fs"

const targets = process.argv.slice(2)
const platform = `bun-${process.platform}-${process.arch}`
mkdirSync("dist", { recursive: true })

for (const target of targets.length ? targets : [platform]) {
  const outfile = targets.length ? `dist/selah-${target.replace(/^bun-/, "")}` : "dist/selah"
  const result = await Bun.build({
    entrypoints: ["./src/index.tsx"],
    target: "bun",
    plugins: [solidPlugin],
    minify: true,
    sourcemap: "linked",
    // A user running selah inside some project must never pick up that project's bunfig or .env.
    compile: { target: target as never, outfile, autoloadBunfig: false, autoloadDotenv: false } as never,
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
  console.log(`built ${outfile}`)
}
