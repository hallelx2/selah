# Privacy

Selah keeps what you do on your own computer. It has no accounts, no telemetry, no analytics, no crash reporting and no update checks. This page lists everything it stores and every request it makes. Each request is traced to the line of code that makes it, and a test fails if the code gains a request this page does not list.

## What Selah stores, and where

Everything is in files on your computer:

| File | What is in it |
|---|---|
| `user.db` | Your reading sessions and reads, highlights, bookmarks, notes and journals |
| `config.json` | Your settings: theme, translation, daily goal and the like |
| `bible.db` | The Bible texts and their search index |
| `study.db` | Matthew Henry and the Hebrew and Greek, if you installed them |
| `scenes/` | Doré's engravings, if you installed them |

On Linux and macOS they are under `~/.local/share/selah` and `~/.config/selah`. On Windows they are under `%LOCALAPPDATA%\selah` and `%APPDATA%\selah`. `selah --help` prints the exact folders. Delete them and Selah forgets everything.

## Every request Selah makes

Selah only goes online to download something you asked for. Each download is a plain file from a public source. The texts are pinned to a fixed commit of their source, and every one of Doré's plates is checked against a pinned SHA-256. Nothing about you is sent with a download. As with any download, the server sees your IP address.

### The Bible texts

- **When:** the first launch, and `selah install KJV` and the like
- **From:** `raw.githubusercontent.com`, scrollmapper/bible_databases
- **In the code:** `src/data/importer.ts`, `src/data/translations.ts`

### Matthew Henry's commentary

- **When:** `selah install commentary`
- **From:** `codeload.github.com`, lyteword/mhenry-complete
- **In the code:** `src/data/commentary.ts`

### The Hebrew and Greek

- **When:** `selah install concordance`
- **From:** `raw.githubusercontent.com`, STEPBible/STEPBible-Data
- **In the code:** `src/data/concordance.ts`

### Doré's engravings

- **When:** `selah install scenes`, or the first time you open an engraving
- **From:** `www.gutenberg.org`, Project Gutenberg #8710
- **In the code:** `src/data/scenes.ts`

That is all of them.

## Ask, and your own agent

Ask runs **your** Claude Code or Codex, on your computer, under your own login. Selah sends nothing to Anthropic or OpenAI itself, but your agent does, under that company's terms:

- your question
- what the agent reads through Selah's tools to answer it, which can include the passages, Henry, the original words and **your notes**

If you do not use Ask, none of this happens. The same goes for `selah mcp` when another agent calls it.

## The installer

The install scripts download the program from this repository's [GitHub releases](https://github.com/hallelx2/selah/releases) and check it against the release's `SHA256SUMS`. Nothing else is sent.

## This website

selah.hallelx2.com is a static site on Cloudflare Pages. It sets no cookies and runs no analytics. Like any website, Cloudflare logs requests. The fonts come from Google Fonts, so Google sees your IP address when the page loads them. The videos and images are served from this site.

## Questions

Open an issue on [GitHub](https://github.com/hallelx2/selah/issues).
