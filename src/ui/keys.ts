// Every key, in the words help shows them. One source for the help dialog and the website's
// keyboard map and /keys page, so neither can drift from the app.
export const KEYS: [string, [string, string][]][] = [
  [
    "Getting around",
    [
      ["↑ ↓  j k", "previous / next verse"],
      ["← →  n p", "previous / next chapter"],
      ["space", "next page (ctrl+d / ctrl+u half a page)"],
      ["g  G", "first / last verse"],
      ["16 enter", "jump to verse 16"],
      ["o", "go to a book and chapter (type: romans 8)"],
      ["/", "search the Bible for words"],
      ["esc", "back, and home from the reader"],
    ],
  ],
  [
    "Study tools",
    [
      ["tab", "open the study pane beside the text, and move between it and the text"],
      ["1", "Notes: your note on this verse, and a journal for the chapter"],
      ["2", "Commentary: Matthew Henry on this verse"],
      ["3", "Words: the Hebrew or Greek behind this verse, with meanings"],
      ["4", "Ask: questions answered by Claude Code or Codex, if you have one"],
      ["i", "Doré's engraving of this passage, when there is one"],
      ["ctrl+l", "show or hide the study pane"],
    ],
  ],
  [
    "Marking the text",
    [
      ["h", "highlight the verse (press again for another colour)"],
      ["b  B", "bookmark the verse / list your bookmarks"],
      ["a", "write a note on the verse"],
      ["v  y", "select several verses / copy them"],
    ],
  ],
  [
    "Your reading",
    [
      ["m", "mark the chapter read (again to unmark)"],
      ["s", "progress and streaks"],
      ["ctrl+o", "today's reading from your plan"],
    ],
  ],
  [
    "How it looks",
    [
      ["t  T", "change translation / two side by side"],
      ["-  =", "narrower / wider text"],
      ["w", "flowing paragraphs or one verse per line"],
      ["z", "focus mode: only the text"],
      ["ctrl+b", "books sidebar (j/k, enter, esc)"],
    ],
  ],
  [
    "Anywhere",
    [
      ["ctrl+p", "commands: type what you want, like 'commentary' or 'dark'"],
      ["?", "this help"],
      ["q  ctrl+c", "quit (ctrl+c on the home screen)"],
    ],
  ],
]
