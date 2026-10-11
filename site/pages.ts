// Generated pages and parts: the keyboard map and /keys from the app's KEYS, the engravings from
// its scenes catalogue, and /download and /changelog from the GitHub releases. Nothing here is
// typed by hand that the app or the release already knows.
import { esc } from "./layout"

type Keys = readonly (readonly [string, readonly (readonly [string, string])[]])[]

// --- the keyboard map -------------------------------------------------------------------------
const ROWS: string[][] = [
  ["esc", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="],
  ["tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "enter"],
  ["shift", "z", "x", "c", "v", "b", "n", "m", "/"],
  ["ctrl", "space", "←", "↑", "↓", "→"],
]
const LABEL: Record<string, string> = { "/": "/ ?", "-": "-", "=": "=" }

/** Which key on the board a token from KEYS lands on; a number like "16" is an example, not a key. */
function keyOf(token: string): string[] {
  if (token.startsWith("ctrl+")) return ["ctrl", token.slice(5).toLowerCase()]
  if (["esc", "tab", "space", "enter", "←", "→", "↑", "↓"].includes(token)) return [token]
  if (token === "?") return ["shift", "/"]
  if (/^[A-Z]$/.test(token)) return ["shift", token.toLowerCase()]
  if (/^[a-z0-9/=-]$/.test(token)) return [token]
  return []
}

/** Every key the app binds, mapped to the help lines that use it. */
export function keyMap(KEYS: Keys): Record<string, { keys: string; what: string; group: string }[]> {
  const map: Record<string, { keys: string; what: string; group: string }[]> = {}
  for (const [group, rows] of KEYS)
    for (const [spec, what] of rows)
      for (const token of spec.split(/\s+/).filter(Boolean))
        for (const k of keyOf(token)) {
          const list = (map[k] ??= [])
          if (!list.some((e) => e.keys === spec)) list.push({ keys: spec, what, group })
        }
  return map
}

export function keyboard(KEYS: Keys): string {
  const map = keyMap(KEYS)
  const rows = ROWS.map(
    (row) =>
      `<div class="kb-row">${row
        .map((k) => {
          const lit = map[k]?.length
          const wide = ["esc", "tab", "enter", "shift", "ctrl", "space"].includes(k) ? ` k-${k}` : ""
          const label = LABEL[k] ?? k
          return lit
            ? `<button type="button" class="key lit${wide}" data-k="${esc(k)}" aria-label="${esc(label)}: ${esc(map[k]!.map((e) => e.what).join("; "))}">${esc(label)}</button>`
            : `<span class="key${wide}" aria-hidden="true">${esc(label)}</span>`
        })
        .join("")}</div>`,
  ).join("")
  return `<div class="kb" data-kb>
          <div class="kb-board">${rows}</div>
          <div class="kb-out" aria-live="polite" data-kb-out><p class="kb-idle">Point at a lit key.</p></div>
          <script type="application/json" data-kb-map>${JSON.stringify(map).replace(/</g, "\\u003c")}</script>
        </div>`
}

export function keysPage(KEYS: Keys): string {
  return `
      <section class="hero slim">
        <p class="kicker">[ every key ]</p>
        <h1>Every key in Selah</h1>
        <p class="lede">The same words as Selah's own help, which is always one <kbd>?</kbd> away. This page is generated from the app's key list, so it cannot fall out of date.</p>
      </section>
      <section class="block">${keyboard(KEYS)}</section>
      <section class="block keys-tables">
        ${KEYS.map(
          ([group, rows]) => `<div class="keys-group">
          <h2>${esc(group)}</h2>
          <table>
            <tbody>
              ${rows.map(([k, what]) => `<tr><th scope="row">${k.split(/\s{2,}/).map((part) => part.split(" ").map((x) => `<kbd>${esc(x)}</kbd>`).join(" ")).join(' <span class="or">or</span> ')}</th><td>${esc(what)}</td></tr>`).join("\n              ")}
            </tbody>
          </table>
        </div>`,
        ).join("\n        ")}
      </section>`
}

// --- the engravings ---------------------------------------------------------------------------
export interface Plate {
  id: string
  title: string
  ref: string
  testament: "OT" | "NT" | "AP"
  caption: string
  width: number
  height: number
}

export function engravingsPage(plates: Plate[]): string {
  const count = (t: Plate["testament"]) => plates.filter((p) => p.testament === t).length
  return `
      <section class="hero slim">
        <p class="kicker">[ the Doré Bible gallery ]</p>
        <h1>Doré's ${plates.length} engravings</h1>
        <p class="lede">
          Gustave Doré engraved these for an illustrated Bible in 1866. Selah shows each one at the passage it depicts, and here they all are with their
          passages and the gallery's captions. They are in the public domain, from Project Gutenberg #8710.
        </p>
        <div class="gallery-tools">
          <div class="seg" role="group" aria-label="Testament">
            <button type="button" aria-pressed="true" data-t="all">All ${plates.length}</button>
            <button type="button" aria-pressed="false" data-t="OT">Old Testament ${count("OT")}</button>
            <button type="button" aria-pressed="false" data-t="NT">New Testament ${count("NT")}</button>
            ${count("AP") ? `<button type="button" aria-pressed="false" data-t="AP">Apocrypha ${count("AP")}</button>` : ""}
          </div>
          <label class="search"><span class="sr">Filter the engravings</span><input type="search" placeholder="Filter: Moses, Psalms, angel…" data-q /></label>
        </div>
        <p class="count" aria-live="polite" data-count></p>
      </section>
      <section class="block gallery-block">
        <ul class="gallery" data-gallery>
          ${plates
            .map(
              (p) => `<li data-id="${p.id}" data-testament="${p.testament}" data-text="${esc(`${p.title} ${p.ref} ${p.caption}`.toLowerCase())}">
            <a href="#${p.id}" class="plate">
              <img src="/engravings/thumb/${p.id}.webp" alt="${esc(p.title)}" width="360" height="${Math.round((360 * p.height) / p.width)}" loading="lazy" decoding="async" />
              <span class="plate-meta"><span class="plate-no">${p.id}</span><b>${esc(p.title)}</b><span>${esc(p.ref)}</span></span>
            </a>
          </li>`,
            )
            .join("\n          ")}
        </ul>
      </section>
      <dialog class="lightbox" data-lightbox aria-label="Engraving">
        <div class="lb-stage" data-stage><img alt="" data-lb-img /></div>
        <div class="lb-side">
          <p class="plate-no" data-lb-no></p>
          <h2 data-lb-title></h2>
          <p class="lb-ref" data-lb-ref></p>
          <p class="lb-caption" data-lb-caption></p>
          <p class="lb-hint">Click the picture to zoom, drag to look around. ← → for the next, esc to close.</p>
          <div class="lb-nav">
            <button type="button" class="ghost" data-prev>← previous</button>
            <button type="button" class="ghost" data-next>next →</button>
            <button type="button" class="ghost" data-close>close</button>
          </div>
        </div>
      </dialog>
      <script type="application/json" data-plates>${JSON.stringify(plates).replace(/</g, "\\u003c")}</script>`
}

// --- download and changelog -------------------------------------------------------------------
export interface Release {
  tag: string
  name: string
  date: string
  html: string
  url: string
  prerelease?: boolean
  assets: { name: string; size: number; url: string; sha256?: string }[]
}

/** The release /download offers: the one the installers fetch (releases/latest, never a pre-release). */
export function latestRelease(releases: Release[]): Release {
  const latest = releases.find((r) => !r.prerelease)
  if (!latest) throw new Error("no published release on GitHub to offer on /download")
  return latest
}

const PLATFORM: Record<string, [os: string, label: string]> = {
  "selah-linux-x64": ["linux", "Linux · x64 (glibc)"],
  "selah-linux-arm64": ["linux", "Linux · ARM64 (glibc)"],
  "selah-linux-x64-musl": ["linux", "Linux · x64 (musl, e.g. Alpine)"],
  "selah-linux-arm64-musl": ["linux", "Linux · ARM64 (musl)"],
  "selah-darwin-arm64": ["mac", "macOS · Apple silicon"],
  "selah-darwin-x64": ["mac", "macOS · Intel"],
  "selah-windows-x64.exe": ["windows", "Windows · x64"],
  "selah-windows-arm64.exe": ["windows", "Windows · ARM64"],
}
const mb = (n: number) => `${(n / 1e6).toFixed(0)} MB`
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })

export function downloadPage(r: Release): string {
  const bins = r.assets.filter((a) => PLATFORM[a.name])
  const sums = r.assets.find((a) => a.name === "SHA256SUMS")
  return `
      <section class="hero slim">
        <p class="kicker">[ download ]</p>
        <h1>Download Selah ${esc(r.tag)}</h1>
        <p class="lede">Released ${date(r.date)}. One line installs the right build and checks it; or pick a file below. <a href="/changelog">What's new</a>.</p>
        <div class="os-cards" data-os-cards>
          <article class="os-card" data-os="unix">
            <h2>Linux and macOS</h2>
            <div class="code"><code>curl -fsSL https://selah.hallelx2.com/install | sh</code><button class="copy" data-copy="curl -fsSL https://selah.hallelx2.com/install | sh" aria-label="Copy the command">copy</button></div>
            <p>Installs to <code>~/.local/bin</code>. Set <code>SELAH_INSTALL_DIR</code> to put it elsewhere.</p>
          </article>
          <article class="os-card" data-os="windows">
            <h2>Windows</h2>
            <div class="code"><code>irm https://selah.hallelx2.com/install.ps1 | iex</code><button class="copy" data-copy="irm https://selah.hallelx2.com/install.ps1 | iex" aria-label="Copy the command">copy</button></div>
            <p>In PowerShell. Installs to <code>%LOCALAPPDATA%\\Programs\\selah</code> and adds it to your PATH.</p>
          </article>
        </div>
        <p class="note" data-os-note></p>
      </section>
      <section class="block">
        <h2 class="big">Every build</h2>
        <div class="table-wrap">
          <table class="builds">
            <thead><tr><th scope="col">System</th><th scope="col">File</th><th scope="col">Size</th><th scope="col">SHA-256</th></tr></thead>
            <tbody>
              ${bins
                .map(
                  (a) => `<tr data-platform="${PLATFORM[a.name]![0]}">
                <td data-label="System">${esc(PLATFORM[a.name]![1])}</td>
                <td data-label="File"><a href="${esc(a.url)}">${esc(a.name)}</a></td>
                <td data-label="Size">${mb(a.size)}</td>
                <td data-label="SHA-256"><code class="hash">${esc(a.sha256 ?? "see SHA256SUMS")}</code></td>
              </tr>`,
                )
                .join("\n              ")}
            </tbody>
          </table>
        </div>
        <p class="note">${sums ? `All checksums: <a href="${esc(sums.url)}">SHA256SUMS</a>. ` : ""}Source code and older releases: <a href="${esc(r.url)}">the release on GitHub</a>.</p>
      </section>
      <section class="block">
        <h2 class="big">Check a file yourself</h2>
        <p>The installers do this for you. To check a file you downloaded by hand, compare its SHA-256 with the one above:</p>
        <div class="code"><code>sha256sum selah-linux-x64</code></div>
        <div class="code"><code>shasum -a 256 selah-darwin-arm64</code></div>
        <div class="code"><code>Get-FileHash selah-windows-x64.exe -Algorithm SHA256</code></div>
        <p>On Linux and macOS, make it runnable with <code>chmod +x</code> and move it onto your PATH as <code>selah</code>.</p>
      </section>`
}

export function changelogPage(releases: Release[]): string {
  return `
      <section class="hero slim">
        <p class="kicker">[ changelog ]</p>
        <h1>What's new</h1>
        <p class="lede">Every release of Selah, newest first, from the notes on GitHub.</p>
      </section>
      ${releases
        .map(
          (r) => `<section class="block release" id="${esc(r.tag)}">
        <div class="release-head"><h2 class="big"><a href="#${esc(r.tag)}">${esc(r.name || r.tag)}</a>${r.prerelease ? ` <span class="pre">pre-release</span>` : ""}</h2><time datetime="${esc(r.date)}">${date(r.date)}</time></div>
        <div class="prose">${r.html}</div>
      </section>`,
        )
        .join("\n      ")}`
}

export function markdownPage(html: string, kicker: string): string {
  // headings get ids for linking, and the guide gets a table of contents from them
  const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const toc: [string, string][] = []
  const body = html.replace(/<h([23])>(.*?)<\/h\1>/g, (_, level: string, text: string) => {
    const id = slug(text)
    if (level === "2") toc.push([id, text.replace(/<[^>]+>/g, "")])
    return `<h${level} id="${id}"><a href="#${id}">${text}</a></h${level}>`
  })
  const [title, ...rest] = body.split(/(?<=<\/h1>)/)
  return `
      <section class="hero slim">
        <p class="kicker">[ ${esc(kicker)} ]</p>
        ${title}
      </section>
      <section class="block doc">
        ${toc.length > 4 ? `<nav class="toc" aria-label="On this page"><p>On this page</p><ol>${toc.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join("")}</ol></nav>` : ""}
        <div class="prose">${rest.join("")}</div>
      </section>`
}

export function notFoundPage(): string {
  return `
      <section class="hero slim notfound">
        <p class="kicker">[ 404 ]</p>
        <h1>Selah. Pause, and consider.</h1>
        <p class="lede">There is no page here. Perhaps it was moved, or the link has a typo.</p>
        <p><a class="button" href="/">Go home</a> <a class="button light" href="/docs">Getting started</a></p>
      </section>`
}
