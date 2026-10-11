// The frame every page of selah.hallelx2.com shares: head, nav and footer. Pages pass their
// own title, description and body; the wordmark comes in from build.ts, drawn from the app's logo.

export const ORIGIN = "https://selah.hallelx2.com"

export interface Page {
  /** The page's path on the site, e.g. "/" or "/docs". */
  path: string
  title: string
  description: string
  body: string
  /** Extra scripts this page needs, by path. */
  scripts?: string[]
  /** The Open Graph image, by path; the page's own one when build.ts renders it. */
  og?: string
}

const NAV = [
  ["/demo", "Watch"],
  ["/#tour", "Try it"],
  ["/engravings", "Engravings"],
  ["/docs", "Docs"],
  ["/changelog", "Changelog"],
  ["https://github.com/hallelx2/selah", "GitHub"],
] as const

const FOOTER: [string, [string, string][]][] = [
  [
    "Selah",
    [
      ["/download", "Download"],
      ["/changelog", "Changelog"],
      ["/demo", "Watch the tour"],
      ["/#tour", "Try it on the page"],
    ],
  ],
  [
    "Learn",
    [
      ["/docs", "Getting started"],
      ["/keys", "Every key"],
      ["/engravings", "Doré's engravings"],
    ],
  ],
  [
    "Project",
    [
      ["https://github.com/hallelx2/selah", "GitHub"],
      ["https://github.com/hallelx2/selah/releases", "Releases"],
      ["/privacy", "Privacy"],
      ["https://github.com/hallelx2/selah/blob/main/LICENSE", "MIT license"],
    ],
  ],
]

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export function layout(page: Page, logo: string): string {
  const url = `${ORIGIN}${page.path === "/" ? "/" : page.path}`
  const og = `${ORIGIN}${page.og ?? "/og/home.png"}`
  const current = (href: string) => (href === page.path || (page.path !== "/" && href.startsWith(page.path)) ? ` aria-current="page"` : "")
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(page.title)}</title>
    <meta name="description" content="${esc(page.description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="theme-color" content="#0a0a0a" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Selah" />
    <meta property="og:title" content="${esc(page.title)}" />
    <meta property="og:description" content="${esc(page.description)}" />
    <meta property="og:image" content="${og}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:url" content="${url}" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=JetBrains+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <a class="skip" href="#main">Skip to the content</a>
    <div class="frame">
      <header class="nav">
        <a class="brand" href="/" aria-label="Selah home">${logo}</a>
        <nav aria-label="Site">
          ${NAV.map(([href, label]) => `<a href="${href}"${current(href)}>${label}</a>`).join("\n          ")}
          <a class="button" href="/download"${current("/download")}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M3 13h10" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
            Download
          </a>
        </nav>
      </header>
      <main id="main">
${page.body}
      </main>
      <footer class="footer">
        <div class="columns">
          ${FOOTER.map(
            ([heading, links]) =>
              `<div><h2>${heading}</h2><ul>${links.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join("")}</ul></div>`,
          ).join("\n          ")}
        </div>
        <p class="credits">
          Commentary: Matthew Henry (1706–1721), via lyteword/mhenry-complete, CC0. Hebrew and Greek: STEPBible.org, Tyndale House, Cambridge, CC BY 4.0.
          Engravings: Gustave Doré (1866), Project Gutenberg #8710, public domain. Themes: opencode's, MIT. Interface built on OpenTUI.
        </p>
      </footer>
    </div>
    <script src="/site.js" defer></script>
    ${(page.scripts ?? []).map((s) => `<script src="${s}" defer></script>`).join("\n    ")}
  </body>
</html>
`
}
