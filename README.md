# Selah

A Bible for the terminal, built on the same TUI stack as [opencode](https://github.com/anomalyco/opencode)
(OpenTUI and Solid on Bun), with a reading tracker that tells you honestly whether you are consistent.

![A beam of light crossing the logo](docs/screenshots/beam.gif)

## What it does

- **Reads well.** A centred reading column, a verse cursor, KJV's supplied words in italics, four
  highlight colours, bookmarks, notes, and parallel translations side by side.
- **Finds anything.** `ctrl+p` opens a command palette that also understands references
  (`jn 3:16`, `1 cor 13:4-7`, `song of songs 2`). `/` searches every verse with ranked,
  highlighted results, phrases in quotes, and filters such as `in:psalms`, `in:ot` and `in:nt`.
- **Tracks reading you actually did.** A chapter counts once you reach its end *and* have spent
  real time on it (30% of the time it takes to read at 250 words a minute, capped at 30 seconds),
  or when you press `m`. Time away from the keyboard for more than three minutes is not counted.
- **Shows whether you are consistent.** Current and longest streak, a daily goal in chapters or
  minutes, consistency over 7, 30 and 365 days, a 53-week heatmap, a 30-day chart, which weekdays
  you read on, and progress through every book.
- **Keeps you on a plan.** Bible in a Year, in Two Years, New Testament in 90 Days, the Gospels in
  30 Days, Psalms and Proverbs in a Month. Portions are balanced by word count, and Selah tells you
  how far ahead or behind you are and when you will finish at your current pace.
- **Matches your rice.** opencode's 33 themes with live preview, plus `system`, which uses your
  terminal's own palette. Nerd Font icons when your font has them, simple symbols when it does not.
- **Moves like light, not like a slot machine.** A beam crosses the logo, each chapter surfaces
  onto the page, a hairline meter fills with real reading time and flashes when the chapter
  counts, and streak milestones bloom in rings of light, once each. Nothing animates while idle,
  and `motion: "reduced"` turns it all off.
- **Reads like a book.** Drop-cap chapter numbers, a prose layout with superscript verse numbers
  (`w`), and a focus mode (`z`) that dims everything but the verse you are on.
- **Works offline.** Translations download once into a local SQLite database with full-text search.

![Reading Psalm 23 to the end: the meter fills, the read counts, a 7-day milestone](docs/screenshots/milestone.gif)

![Progress](docs/screenshots/progress.gif)

![Focus mode](docs/screenshots/focus.png)

![Prose layout](docs/screenshots/prose.png)

![Reader](docs/screenshots/reader.png)

![Parallel translations in Catppuccin](docs/screenshots/parallel.png)

## Study desk

Press `tab` in the reader to open the study desk beside the text: your notes and a chapter
journal (autosaved), Matthew Henry's Complete Commentary opened at the verse you are on
(`selah install commentary`, about 14 MB once), and Ask.

![Study desk](docs/screenshots/desk.png)

### Ask

Ask questions about what you are reading and get answers grounded in the text, with every
reference openable. Ask uses **your own Claude Code or Codex**, with your existing login.
Selah installs nothing and holds no API keys.

- The agent reads passages, searches the Bible and Matthew Henry, and sees your notes, through
  Selah's tools. None of your coding setup is loaded: no Claude Code settings or CLAUDE.md,
  and no Codex skills or other MCP servers.
  - **Claude:** Bash, file reads and edits are disallowed. It may use Selah's tools and the web.
  - **Codex:** runs in its read-only sandbox (it can write nothing) with its shell, browser,
    image and plugin tools turned off. That sandbox does not stop reads, so do not count on
    Codex being unable to see your files.
- It can suggest a note; nothing is saved unless you press `ctrl+k`. `ctrl+s` saves an answer
  as a note on the current verse, and `ctrl+r` opens the references it cites.
- Each chapter keeps its own conversation, and follow-ups continue the same session.

Set `agent` in config.json to `claude` or `codex` to choose; `auto` uses the first one found.

### Selah's tools in your own agent

`selah mcp` serves the same tools over MCP, so Claude Code, Codex or any MCP client can read
passages, search, consult Henry and see what you are studying:

```sh
claude mcp add selah -- selah mcp
codex mcp add selah -- selah mcp
```

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/hallelx2/selah/main/install.sh | sh
```

The installer picks the build for your system (Linux x64 or arm64, glibc or musl; macOS Apple
silicon or Intel), checks its SHA-256 against the release, and puts `selah` in `~/.local/bin`.
Set `SELAH_INSTALL_DIR` to install elsewhere, or `SELAH_VERSION=v0.1.0` to pin a release.
Binaries are also on the [releases page](https://github.com/hallelx2/selah/releases).

The first launch downloads the King James Version and the Berean Standard Bible (about 8 MB each).
After that, Selah needs no network.

### From source

Requires [Bun](https://bun.sh) 1.4 or later.

```sh
git clone https://github.com/hallelx2/selah && cd selah
bun install
bun src/index.tsx              # run it
bun run build                  # or compile dist/selah for this machine
```

## Use

```sh
selah                         # open the app
selah john 3:16               # open at a passage
selah ps 23 -p                # print a passage and exit
selah search "living water"   # print search results
selah stats                   # streak, today, consistency
selah install ASV YLT NHEB    # more translations
```

### Keys

| Reading | | Study | | Tracking | |
|---|---|---|---|---|---|
| `j` `k` | next / previous verse | `h` | highlight | `m` | mark chapter read |
| `n` `p` | next / previous chapter | `b` `B` | bookmark / list | `s` | progress |
| `space` | page down | `a` | note on verse | `ctrl+o` | today's reading |
| `16 enter` | jump to verse 16 | `v` `y` | select / copy | `ctrl+p` | commands |
| `o` | go to book | `t` `T` | translation / parallel | `?` | all keys |
| `z` | focus mode | `w` | prose / verse layout | | |
| `/` | search | `ctrl+b` | sidebar | `q` | quit |

### Your streak in waybar

`selah stats --json` prints waybar's custom-module format (`text`, `tooltip`, `class`), where
`class` is `met`, `pending` or `none`:

```jsonc
"custom/selah": {
  "exec": "selah stats --json",
  "return-type": "json",
  "interval": 300,
  "on-click": "foot -e selah"
}
```

## Translations

All are public domain, taken from [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases)
(MIT) at a pinned commit.

| ID | Translation | Year |
|---|---|---|
| KJV | King James Version | 1769 |
| BSB | Berean Standard Bible | 2022 |
| ASV | American Standard Version | 1901 |
| YLT | Young's Literal Translation | 1898 |
| NHEB | New Heart English Bible | 2010 |

## Files

- `$XDG_DATA_HOME/selah/bible.db`: the texts and their search index.
- `$XDG_DATA_HOME/selah/user.db`: your reading sessions, reads, highlights, bookmarks and notes.
  It is separate from the texts, so adding or removing a translation never touches it.
- `$XDG_CONFIG_HOME/selah/config.json`: theme, mode, translation, daily goal, `icons`
  (`nerd`, `unicode` or `none`), `motion` (`full` or `reduced`) and `prose`. Safe to edit by hand.

`SELAH_HOME` puts all three under one directory. `SELAH_NO_PALETTE=1` skips the terminal palette
query for terminals that mishandle it. `SELAH_DEBUG_LOG=<file>` writes errors to a file.

## Development

```sh
bun test               # data, tracker, stats, plans, themes and rendered UI frames
bun run typecheck
bun scripts/screenshots.tsx   # regenerate docs/screenshots from real frames
bun scripts/gifs.tsx          # record the GIFs frame by frame on a manual clock
```

`bun scripts/build.ts --release` cross-compiles every release target and writes `SHA256SUMS`;
it needs every platform's OpenTUI core installed first (`bun install --os='*' --cpu='*'`).

The design rules every screen follows are in [docs/DESIGN.md](docs/DESIGN.md).

## License

MIT. Themes in `src/theme/assets` are opencode's, used under its MIT license
([LICENSE.opencode](src/theme/assets/LICENSE.opencode)). The Bible texts are in the public domain.
