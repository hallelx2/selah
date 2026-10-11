// The home page's body. Every number on it is measured in build.ts and passed in; every key
// comes from the app's own KEYS; every picture is a frame Selah drew (site/media, recorded by
// scripts/site-media.tsx).
import { esc } from "./layout"

export interface HomeData {
  version: string
  stats: { books: number; chapters: number; verses: number; translations: number; words: number; plates: number; themes: number }
  streak: { idleMinutes: number; short: { name: string; words: number; seconds: number }; long: { name: string; words: number; seconds: number } }
  themes: { id: string; name: string }[]
  keyboard: string
  tools: { name: string; summary: string }[]
  figures: { heatmap: string; words: string; plates: string }
}

const n = (x: number) => x.toLocaleString("en-US")

export function clip(name: string, label: string, extra = "") {
  return `<video class="clip" muted loop playsinline preload="none" poster="/media/${name}.webp" data-lazy aria-label="${esc(label)}"${extra}>
              <source src="/media/${name}.webm" type="video/webm" />
              <source src="/media/${name}.mp4" type="video/mp4" />
            </video>`
}

const window = (title: string, inner: string) => `<div class="window"><div class="bar"><i></i><i></i><i></i><span>${title}</span></div>${inner}</div>`
const keys = (...k: string[]) => `<p class="keys">${k.map((x) => `<kbd>${esc(x)}</kbd>`).join(" ")}</p>`

const STORIES: { id: string; title: string; body: string; keys: string[]; label: string; note?: string }[] = [
  {
    id: "read",
    title: "Reads like a book, moves like an editor",
    body: "A centred column with a verse cursor. The King James's supplied words are in italics, and there are four highlight colours. A prose layout puts verse numbers in superscript, and focus mode dims everything but the verse you are on.",
    keys: ["j", "k", "h", "w", "z"],
    label: "Moving through John 3 verse by verse, highlighting two verses, then switching to the prose layout and back",
  },
  {
    id: "notes",
    title: "A note on every verse, a journal for every chapter",
    body: "Press tab and start typing. Notes follow the verse you are on and save as you write. Each chapter has a journal for what stood out and what to pray. When you want them elsewhere, selah notes export writes them all as Markdown.",
    keys: ["tab", "a", "1"],
    label: "Opening the study desk on John 3:16 and typing a note into it",
  },
  {
    id: "henry",
    title: "Matthew Henry, open at your verse",
    body: "The Complete Commentary, written from 1706 to 1721. It opens at the verse you are reading and follows you as you move. Selah installs it once with selah install commentary, about 14 MB, and it works offline after that.",
    keys: ["2"],
    label: "Matthew Henry's commentary on Psalm 23, scrolling through it",
  },
  {
    id: "words",
    title: "The Hebrew and Greek behind every verse",
    body: "Each original word comes with its transliteration, an English gloss, its Strong's number and its grammar in plain English. Press enter for a full study: the lexicon entry, how often the word occurs and in which books, and every verse that uses it. Hebrew is drawn right to left.",
    keys: ["3", "enter", "f"],
    label: "The Greek words of John 3:16, then a word study of agapao and the verses that use it",
  },
  {
    id: "ask",
    title: "Ask your own Claude Code or Codex",
    body: "Questions about what you are reading get answers grounded in the text, and every reference can be opened. Ask runs the agent you already have, under your own login, and Selah holds no keys. It works through Selah's tools: Claude may not run commands or edit files, and Codex runs in its read-only sandbox.",
    keys: ["4", "ctrl+r", "ctrl+s"],
    label: "Asking Claude Code what the living water is in John 4, and its answer arriving",
    note: "Claude Code answering live. This clip is shown at three times speed.",
  },
  {
    id: "scene",
    title: "Doré's engravings, at the passage they show",
    body: "All 100 of Gustave Doré's Bible engravings from 1866, each mapped to its passage. When a chapter has one, the header says so. The plate surfaces like ink, row by row, then drifts in a slow pan. It draws with kitty graphics in kitty and Ghostty, sixel in foot, and half-blocks everywhere else, tmux included.",
    keys: ["i", "←", "→", "g"],
    label: "Doré's engraving of Jesus and the woman of Samaria surfacing like ink, then drifting",
  },
]

const BENTO: { id: string; title: string; body: string; keys: string[]; label: string }[] = [
  {
    id: "palette",
    title: "Commands in plain words",
    body: "Type what you want: dark, pictures, bigger text, commentary. Passages work too: jn 3:16, 1 cor 13:4-7.",
    keys: ["ctrl+p"],
    label: "The command palette: typing dark and switching Selah to light",
  },
  {
    id: "search",
    title: "Every verse, ranked",
    body: 'Phrases in quotes, filters like in:psalms and in:nt, and Strong\'s numbers such as G26.',
    keys: ["/"],
    label: "Searching for living water and opening a result",
  },
  {
    id: "parallel",
    title: "Two translations, side by side",
    body: "Five public-domain translations. Verses stay aligned as you move.",
    keys: ["T", "t"],
    label: "Psalm 23 in the King James and the Berean Standard side by side",
  },
  {
    id: "progress",
    title: "Progress you can trust",
    body: "Your streak, today, consistency over 7, 30 and 365 days, and a year's heatmap.",
    keys: ["s"],
    label: "The progress screen: streak, consistency and the heatmap",
  },
]

export function home(d: HomeData): string {
  const s = d.stats
  return `
      <section class="hero" id="install">
        <a class="eyebrow" href="/changelog"><span>v${d.version}</span> Now on Windows <span aria-hidden="true">→</span></a>
        <h1>A Bible for the terminal</h1>
        <p class="lede">
          Read in a quiet, fast terminal app. Keep notes, open Matthew Henry, see the Hebrew and Greek behind every verse, and ask your own Claude or
          Codex about what you are reading.
        </p>

        <div class="install" data-tabs>
          <div class="tabs" role="tablist" aria-label="Install with">
            <button role="tab" aria-selected="true" data-tab="curl">curl</button>
            <button role="tab" aria-selected="false" data-tab="powershell">PowerShell</button>
            <button role="tab" aria-selected="false" data-tab="source">from source</button>
          </div>
          <div class="panel" role="tabpanel" data-panel="curl">
            <code><span class="dim">curl -fsSL https://</span><span class="strong">selah.hallelx2.com/install</span><span class="dim"> | sh</span></code>
            <button class="copy" data-copy="curl -fsSL https://selah.hallelx2.com/install | sh" aria-label="Copy the command">copy</button>
          </div>
          <div class="panel" role="tabpanel" data-panel="powershell" hidden>
            <code><span class="dim">irm https://</span><span class="strong">selah.hallelx2.com/install.ps1</span><span class="dim"> | iex</span></code>
            <button class="copy" data-copy="irm https://selah.hallelx2.com/install.ps1 | iex" aria-label="Copy the command">copy</button>
          </div>
          <div class="panel" role="tabpanel" data-panel="source" hidden>
            <code><span class="dim">git clone https://github.com/hallelx2/selah && cd selah && </span><span class="strong">bun install && bun run build</span><span class="dim"> && mkdir -p ~/.local/bin && cp dist/selah ~/.local/bin/</span></code>
            <button class="copy" data-copy="git clone https://github.com/hallelx2/selah && cd selah && bun install && bun run build && mkdir -p ~/.local/bin && cp dist/selah ~/.local/bin/" aria-label="Copy the command">copy</button>
          </div>
        </div>
        <p class="note">
          Linux, macOS and Windows. The installer checks every download against its SHA-256, then the first launch fetches the King James and the
          Berean Standard (16 MB). After that, Selah works offline. <a href="/download">Every build</a> · <a href="#tour">Try it here first</a>
        </p>
      </section>

      <section class="screen" aria-label="Selah being used">
        ${window(
          "selah",
          `<video autoplay muted loop playsinline preload="metadata" poster="/selah-demo-poster.png" aria-label="A recording of Selah: opening John 3:16, writing a note, Matthew Henry, the Greek word study of agapao, asking Claude, a Doré engraving, and the progress screen">
            <source src="/selah-demo.webm" type="video/webm" />
            <source src="/selah-demo.mp4" type="video/mp4" />
          </video>`,
        )}
        <p class="caption">A real session, recorded frame by frame from the app. The answer in Ask is Claude Code answering live, shown at three times speed.</p>
      </section>

      <section class="numbers" aria-label="Selah in numbers">
        <div><b>${n(s.books)}</b><span>books</span></div>
        <div><b>${n(s.verses)}</b><span>verses</span></div>
        <div><b>${n(s.translations)}</b><span>translations</span></div>
        <div><b>${n(s.words)}</b><span>Hebrew and Greek words</span></div>
        <div><b>${n(s.plates)}</b><span>engravings</span></div>
        <div><b>${n(s.themes)}</b><span>themes</span></div>
      </section>

      <section class="block tour-block" id="tour">
        <p class="kicker">[ try it here ]</p>
        <h2 class="big">Drive it with your own keys</h2>
        <p>
          Click the screen and press the key it asks for, or tap the key below it. Each screen is a frame Selah drew when that key was pressed, kept as
          text, so it stays sharp at any zoom. It is a guided path, not the app running in your browser. For that, install it, which takes one line.
        </p>
        <div class="tour" data-tour>
          ${window(
            "selah · tour",
            `<div class="term" tabindex="0" role="application" aria-roledescription="terminal" aria-label="Selah tour screen. Press the key shown below.">
              <pre aria-hidden="true"></pre>
              <p class="term-hint" data-hint>Click here, then press the keys</p>
            </div>`,
          )}
          <div class="tour-controls">
            <p class="tour-caption" aria-live="polite" data-caption>Loading the tour…</p>
            <div class="tour-row">
              <span class="tour-press" data-press-label>Press</span>
              <button class="keycap" data-press type="button">…</button>
              <span class="tour-count" data-count></span>
              <span class="spacer"></span>
              <button class="ghost" data-back type="button">← back</button>
              <button class="ghost" data-restart type="button">restart</button>
            </div>
            <div class="tour-progress" aria-hidden="true"><i data-bar></i></div>
          </div>
        </div>
      </section>

      <section class="block" id="features">
        <p class="kicker">[ what it does ]</p>
        <h2 class="big">Everything you need to read closely, one key away</h2>
        <div class="stories">
          ${STORIES.map(
            (st, i) => `<article class="story${i % 2 ? " flip" : ""}" id="${st.id}">
            <div class="story-text">
              <p class="index">${String(i + 1).padStart(2, "0")}</p>
              <h3>${esc(st.title)}</h3>
              <p>${esc(st.body)}</p>
              ${keys(...st.keys)}
              ${st.note ? `<p class="clip-note">${esc(st.note)}</p>` : ""}
            </div>
            <div class="story-media">${window(st.id, clip(st.id, st.label))}</div>
          </article>`,
          ).join("\n          ")}
        </div>
        <div class="bento">
          ${BENTO.map(
            (b) => `<article class="cell" id="${b.id}">
            ${window(b.id, clip(b.id, b.label))}
            <div class="cell-text">
              <h3>${esc(b.title)}</h3>
              <p>${esc(b.body)}</p>
              ${keys(...b.keys)}
            </div>
          </article>`,
          ).join("\n          ")}
        </div>
        <p class="caption left">Every clip on this page is the real app, recorded frame by frame. The zooms are camera moves on its vector frames, not enlarged pixels.</p>
      </section>

      <section class="block" id="honest">
        <p class="kicker">[ an honest streak ]</p>
        <h2 class="big">It only counts what you actually read</h2>
        <p>
          Most streaks reward opening the app. Selah's tracker counts a chapter only when you have read it. These are the rules, and they are in the code,
          not the marketing.
        </p>
        <div class="rules">
          <div class="rule">
            <svg viewBox="0 0 220 70" aria-hidden="true" class="rule-art gap">
              <line x1="6" y1="40" x2="214" y2="40" />
              ${[10, 22, 30, 41, 55, 63, 74].map((x) => `<rect class="tick" x="${x}" y="28" width="3" height="24" />`).join("")}
              <rect class="idle" x="82" y="24" width="76" height="32" rx="3" />
              <text x="120" y="20">away</text>
              ${[164, 175, 188, 197, 208].map((x) => `<rect class="tick" x="${x}" y="28" width="3" height="24" />`).join("")}
            </svg>
            <h3>Time away is not reading</h3>
            <p>Gaps between key presses count up to ${d.streak.idleMinutes} minutes. A longer gap counts as nothing at all, so leaving Selah open is not reading.</p>
          </div>
          <div class="rule">
            <svg viewBox="0 0 220 70" aria-hidden="true" class="rule-art meter">
              <rect class="track" x="6" y="32" width="208" height="8" rx="4" />
              <rect class="fill" x="6" y="32" width="208" height="8" rx="4" />
              <line class="mark" x1="150" y1="22" x2="150" y2="50" />
              <text x="150" y="16">counts</text>
            </svg>
            <h3>Reaching the end is not enough</h3>
            <p>
              A chapter counts when you reach its end and have spent real time on it: 30% of the time it takes to read at 250 words a minute, never more than
              30 seconds. ${esc(d.streak.short.name)} (${n(d.streak.short.words)} words) counts after ${d.streak.short.seconds}s. ${esc(d.streak.long.name)} (${n(d.streak.long.words)} words) needs the full ${d.streak.long.seconds}s.
            </p>
          </div>
          <div class="rule">
            <svg viewBox="0 0 220 70" aria-hidden="true" class="rule-art days">
              ${Array.from({ length: 7 }, (_, i) => `<rect x="${8 + i * 30}" y="20" width="22" height="22" rx="3" class="${i === 3 ? "off" : "on"}" />`).join("")}
              <text x="110" y="62">one record a chapter a day</text>
            </svg>
            <h3>One read a day, credited to the day you started</h3>
            <p>Reading a chapter twice in a day counts once. A session that runs past midnight counts for the day it began. Or press m to mark a chapter read yourself.</p>
          </div>
        </div>
      </section>

      <section class="block" id="themes">
        <p class="kicker">[ make it yours ]</p>
        <h2 class="big">${d.stats.themes} themes, or your terminal's own</h2>
        <p>
          opencode's themes with live preview, light and dark, plus <code>system</code>, which uses your terminal's palette. Nerd Font icons when your font has them,
          and simple symbols when it does not.
        </p>
        <div class="themes" data-themes>
          <div class="chips" role="group" aria-label="Theme">
            ${d.themes.map((t, i) => `<button type="button" class="chip" data-theme="${t.id}" aria-pressed="${i === 0}">${esc(t.name)}</button>`).join("\n            ")}
          </div>
          ${window(
            "selah · John 1",
            `<div class="stage">${d.themes
              .map(
                (t, i) =>
                  `<img src="/media/theme-${t.id}.webp" alt="John 1 in the ${esc(t.name)} theme, in the prose layout" width="1440" height="850" loading="lazy" data-theme-img="${t.id}"${i ? " hidden" : ""} />`,
              )
              .join("")}</div>`,
          )}
        </div>
      </section>

      <section class="block" id="keyboard">
        <p class="kicker">[ the keys ]</p>
        <h2 class="big">One key for each thing you do</h2>
        <p>Point at a key, or tap it, to see what it does. The same words are in Selah's help, which is always one <kbd>?</kbd> away. <a href="/keys">Every key, listed</a>.</p>
        ${d.keyboard}
      </section>

      <section class="block" id="agents">
        <p class="kicker">[ bring your own agent ]</p>
        <h2 class="big">Selah's tools, in the agent you already use</h2>
        <div class="split">
          <div>
            <p>
              The same tools Ask uses are served over MCP by <code>selah mcp</code>. Claude Code, Codex or any MCP client can then read passages, search,
              consult Henry, study the original words and see what you are studying. One line adds it:
            </p>
            <div class="code"><code>claude mcp add selah -- selah mcp</code><button class="copy" data-copy="claude mcp add selah -- selah mcp" aria-label="Copy the command">copy</button></div>
            <div class="code"><code>codex mcp add selah -- selah mcp</code><button class="copy" data-copy="codex mcp add selah -- selah mcp" aria-label="Copy the command">copy</button></div>
          </div>
          <ul class="tools">
            ${d.tools.map((t) => `<li><code>${esc(t.name)}</code><span>${esc(t.summary)}</span></li>`).join("\n            ")}
          </ul>
        </div>
      </section>

      <section class="block">
        <p class="kicker">[ the library ]</p>
        <h2 class="big">Made for reading slowly</h2>
        <p class="indent"><span>[*]</span><span>Selah means a pause. The app stays out of the way: no ads, no account, nothing to sign in to.</span></p>
        <div class="figures">
          <figure>
            ${d.figures.heatmap}
            <figcaption><span>Fig 1.</span> A year of reading (an example)</figcaption>
          </figure>
          <figure>
            ${d.figures.words}
            <figcaption><span>Fig 2.</span> <b>${n(s.words)}</b> Hebrew and Greek words, by book</figcaption>
          </figure>
          <figure>
            <a href="/engravings" class="fig-link">${d.figures.plates}</a>
            <figcaption><span>Fig 3.</span> <b>${n(s.plates)}</b> engravings by Doré · <a href="/engravings">see them all</a></figcaption>
          </figure>
        </div>
      </section>

      <section class="block">
        <h2 class="big">Yours, on your machine</h2>
        <p class="indent">
          <span>[*]</span><span>Your notes, highlights and reading history live in a file on your computer and nowhere else. Selah has no telemetry and reports
          nothing about you. It downloads only what you ask it to install, and <a href="/privacy">the privacy page</a> lists every one of those requests.
          Ask uses the Claude Code or Codex you already have, with your own login, and Selah holds no keys.</span></p>
      </section>

      <section class="block faq">
        <h2 class="big">FAQ</h2>
        <details>
          <summary>Is it free?</summary>
          <p>Yes. Selah is open source under the MIT license, and the Bible texts are in the public domain.</p>
        </details>
        <details>
          <summary>How do I use it if I have never used a terminal app?</summary>
          <p>
            Run <code>selah</code>, type a passage like <code>john 3</code> and press enter. The arrow keys move through the text, <code>tab</code> opens
            the study tools, and <code>?</code> shows every key in plain words. The first time you open the reader, it shows you the ones that matter. The
            <a href="/docs">getting started guide</a> walks through all of it with pictures.
          </p>
        </details>
        <details>
          <summary>Which translations are there?</summary>
          <p>
            The King James Version and the Berean Standard Bible come with it. The American Standard Version, Young's Literal Translation and the New
            Heart English Bible are one command away: <code>selah install ASV YLT NHEB</code>.
          </p>
        </details>
        <details>
          <summary>Does it need the internet?</summary>
          <p>
            Only to download things once: the translations, and if you want them, the commentary (14 MB), the Hebrew and Greek (108 MB) and the
            engravings (17 MB). Ask uses your agent's own connection.
          </p>
        </details>
        <details>
          <summary>Does Ask cost anything?</summary>
          <p>
            Selah charges nothing. Ask runs the Claude Code or Codex you already have, under your own plan, so it costs whatever that does. Without
            either, everything else works and Ask says how to get one.
          </p>
        </details>
        <details>
          <summary>Does it work on Windows?</summary>
          <p>Yes, from version 0.3.1, on x64 and ARM64. Install it from PowerShell with the command above, and use Windows Terminal for the best colours.</p>
        </details>
        <details>
          <summary>How do I remove it?</summary>
          <p>
            Delete the <code>selah</code> binary (in <code>~/.local/bin</code>, or <code>%LOCALAPPDATA%\\Programs\\selah</code> on Windows). Your notes stay in
            Selah's data folder until you delete that too; <code>selah --help</code> prints where it is.
          </p>
        </details>
      </section>

      <section class="cta">
        <h2>Open John 3 tonight.</h2>
        <p>One line to install. Your first chapter is a minute away.</p>
        <div class="code big-code"><code>curl -fsSL https://selah.hallelx2.com/install | sh</code><button class="copy" data-copy="curl -fsSL https://selah.hallelx2.com/install | sh" aria-label="Copy the command">copy</button></div>
        <p class="small">On Windows: <code>irm https://selah.hallelx2.com/install.ps1 | iex</code> · <a href="/download">all downloads</a></p>
      </section>
`
}
