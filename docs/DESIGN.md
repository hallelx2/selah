# Selah design language

Selah should feel like an app, not a script with colours. These rules come from the TUIs
that already feel like apps, read from their source where it was available
(opencode's `packages/tui`, studied 2026-10-08), and from using them daily.

## What we took, and from where

| Source | Pattern | How Selah uses it |
|---|---|---|
| opencode | Layered surfaces: `background`, `backgroundPanel`, `backgroundElement` instead of borders everywhere | The reader is on `background`; dialogs, cards and the header strip are on `backgroundPanel`; the selected row is on `backgroundElement` |
| opencode | `SplitBorder`: a single heavy `┃` on the left edge as the only border | The cursor verse, focused cards and toasts carry a `┃` in the primary colour |
| opencode | Modal dialogs over a dimmed backdrop (`RGBA(0,0,0,150)`), 60/88/116 columns wide, placed at a quarter of the height, with `esc` in the top right corner | Every dialog: palette, search, books, themes, plans, bookmarks, note, help |
| opencode | A block-letter logo with a two-tone muted/bold split and a shadow tint | The home screen's `SELAH` mark |
| opencode | Themes as JSON with `defs` and dark/light variants; 33 ship with it (MIT) | Copied verbatim into `src/theme/assets` with attribution; any of them can be selected |
| opencode | Select lists: accent-coloured category headers, the selected row filled with `primary` and drawn in the background colour | Palette, books and theme picker |
| btop | Dense stat panels with titles inset into the border, and small charts made from block characters | The Progress screen: stat cards, a weekly bar chart, ▁▂▃▅▇ sparklines |
| GitHub / gh-dash | A contribution heatmap: 53 weeks × 7 days, five intensity steps | The consistency heatmap, coloured from `background` through to `success` |
| lazygit | Every key is discoverable; the status bar shows the keys for the current context | A context-aware footer plus `?` for full help |
| Posting / Harlequin | A command palette as the universal entry point, with fuzzy filtering | ctrl+p; it also parses Bible references ("jn 3:16") |
| Crush | Generous whitespace and a centred column of content; the UI recedes and the content leads | The reading column is capped at 76 columns and centred; chrome is muted |

## Rules

1. **Content leads.** Scripture is drawn in `text`. Chrome (labels, hints, numbers) is drawn in `textMuted`. Colour is reserved for state: the cursor, highlights, streak status, progress.
2. **Surfaces, not boxes.** Use background steps to separate regions. A full box border appears only when a region must read as a separate card (the stat cards on the Progress screen).
3. **One accent at a time.** `primary` marks where you are; `accent` labels categories; `success`, `warning` and `error` only carry meaning (on track, slipping, broken streak).
4. **Every screen has three bands:** a one-line header (where am I), the content, and a one-line footer (what can I press, how am I doing).
5. **Keyboard-complete, mouse-friendly.** Every action has a key; lists and verses also respond to the mouse.
6. **Never show a dead end.** An empty state says what to do next ("No bookmarks yet. Press b on any verse.").
7. **Numbers you can trust.** Progress figures come only from recorded reading (see `src/data/tracker.ts`), never estimates.
8. **No emoji.** Width varies across terminals. Use box-drawing and block characters only: `┃ ━ ● ○ ◆ ▲ ▼ ▁▂▃▄▅▆▇█ ░▒▓`.
