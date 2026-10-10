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

## Motion

Motion in Selah is light arriving, not things bouncing. Every effect borrows from that idea:
a beam crossing the logo, ink surfacing on a page, rings of light for a milestone.

| Effect | Where | Length | Why it exists |
|---|---|---|---|
| Beam | Logo, every 7s | 1.5s | Signals the app is alive without asking for attention |
| Surface | Verse of the day, each new chapter | 0.3 to 0.9s | Text arrives instead of snapping in; the eye lands on it |
| Meter | Hairline under the reader header | live | Shows the tracker is honest: it fills only with real reading time |
| Completion beam | Meter and book name, when a chapter counts | 1.1s | The one moment worth marking in every session |
| Count-up and fill | Progress screen | 0.9s | Numbers feel earned; the heatmap is drawn like a ledger |
| Glow | Streak in the status bar, when today is not yet kept | slow pulse | A nudge, never an alarm |
| Rings | Streak milestones (3, 7, 14, 30, 50, 100, 200, 365) | 2.2s, once each | Celebrates faithfulness; never replays |
| Rise and slide | Dialogs and toasts | 0.17 to 0.28s | Spatial continuity; where a thing came from |

Rules:

1. **Nothing animates while idle.** The motion clock only ticks while an animation is running.
2. **Input is never gated.** Keys reach a dialog from its first frame, mid-animation.
3. **Reduced motion is complete.** With `motion: "reduced"`, `SELAH_REDUCED_MOTION=1` or `NO_COLOR`, every value is final immediately and milestones become a toast.
4. **Every animation is a pure function of time.** Tests drive them on a manual clock and assert exact frames.
5. **Icons never shift layout.** Nerd Font glyphs and their Unicode fallbacks are both one column; `icons: "none"` removes the trailing space too.
