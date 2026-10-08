# Selah

A terminal Bible reader with an opencode-grade UI and an honest reading tracker.

## Linear

- Initiative: Selah (`I-20`, b05545f8-c954-4142-ae01-bedd8ab5a760)
- Project: Selah TUI (`P-HAL-107`, de477b6f-f4e5-48ec-80a5-1c39d5f84cc7)
- Team: Hallelx2
- Repo: this directory (`~/dev/selah`)

## Stack

- Bun runtime, `bun:sqlite`, `bun test`. Use bun for everything; never node or npx.
- UI: `@opentui/core` + `@opentui/solid` (the stack opencode is built on), Solid signals and stores.
- Bible text: public-domain translations from scrollmapper/bible_databases, pinned to a commit in
  `src/data/translations.ts`, imported into `$XDG_DATA_HOME/selah/bible.db` with FTS5.
- Personal data (sessions, reads, bookmarks, highlights, notes, settings) lives in `user.db`, never in
  `bible.db`.

## Layout

- `src/data/` pure data and logic: books, reference parser, importer, queries, tracker, stats, plans.
- `src/theme/` theme resolution; `assets/` holds opencode's MIT themes verbatim.
- `src/ui/` the OpenTUI app: `app.tsx`, `routes/`, `dialogs/`, `components/`, `context/`.
- `docs/DESIGN.md` the design rules every screen follows.

## Checks

- `bun test` runs everything. Tests share one imported KJV + BSB database in `.selah-test-home/`,
  built from `.selah-test-sources/` (both gitignored; the sources download on first run).
- `bunx tsc --noEmit` type-checks.
- UI tests render with `testRender` and assert on `captureCharFrame()`.

## Tracking rules (do not loosen without a reason in the commit)

- Active time: gaps between input of up to 3 minutes count; longer gaps count as zero.
- A chapter is read when its end was reached and active time on it is at least
  `minimumReadMs(words)`, or when marked read with `m`. One record per chapter per day.
- A read is credited to the day its session started.
