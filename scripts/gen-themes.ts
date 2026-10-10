// Regenerates src/theme/builtin.ts from the JSON files in src/theme/assets.
import { readdirSync } from "node:fs"
import { join } from "node:path"

const dir = join(import.meta.dir, "../src/theme/assets")
const names = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort()
const ident = (n: string) => n.replaceAll("-", "_")
const out = [
  "// Generated from src/theme/assets by scripts/gen-themes.ts. Do not edit by hand.",
  "",
  ...names.map((n) => `import ${ident(n)} from "./assets/${n}.json"`),
  "",
  "export const BUILTIN_THEMES: Record<string, unknown> = {",
  ...names.map((n) => `  "${n}": ${ident(n)},`),
  "}",
  "",
]
await Bun.write(join(import.meta.dir, "../src/theme/builtin.ts"), out.join("\n"))
console.log(`${names.length} themes`)
