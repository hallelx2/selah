import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { bookById } from "../data/books"
import { installConcordance, STEP_ATTRIBUTION, textBase, type Word } from "../data/concordance"
import { displayHebrew } from "../data/hebrew"
import { describeMorphology } from "../data/morphology"
import { formatRef } from "../data/ref"
import { Bar, LeftBar, LineBar, TRANSPARENT } from "./components/primitives"
import { Inline } from "./components/inline"
import { plain } from "./components/verse"
import { mixColor } from "./motion"
import { useApp } from "./state"

/** How many verses a word study lists before asking the reader to narrow it to a book. */
export const OCCURRENCE_LIMIT = 300

interface Study {
  strongs: string
  /** the word the study was opened from, for its form and grammar */
  from?: Word & { book: number }
}

/**
 * The Words tab: the Hebrew or Greek behind the cursor verse, word by word, and a word study
 * for any of them (its lexicon entry and every verse that uses it, per book).
 */
export function WordsTab(props: { register: (fn: (name: string, sequence: string) => boolean) => void }) {
  const app = useApp()
  const t = () => app.theme()
  const conc = app.deps.concordance
  const [installed, setInstalled] = createSignal(!!conc?.installed)
  const [progress, setProgress] = createSignal<number | undefined>()
  const [error, setError] = createSignal<string | undefined>()
  const [selected, setSelected] = createSignal(0)
  const [study, setStudy] = createSignal<Study | undefined>()
  const [picked, setPicked] = createSignal(0)
  const [onlyBook, setOnlyBook] = createSignal(false)
  const [fullDefinition, setFullDefinition] = createSignal(false)
  let scroll: ScrollBoxRenderable | undefined

  const here = createMemo(
    () => ({ book: app.position().book, chapter: app.position().chapter, verse: app.position().verse }),
    undefined,
    { equals: (a, b) => a.book === b.book && a.chapter === b.chapter && a.verse === b.verse },
  )
  const words = createMemo(() => {
    app.rev()
    const h = here()
    return installed() && conc ? conc.verse(h.book, h.chapter, h.verse, app.translation()) : []
  })
  const hebrew = () => here().book <= 39
  const shown = (s: string) => (hebrew() || /[֐-׿]/.test(s) ? displayHebrew(s, app.config.hebrew) : s)

  // a new verse starts at its first word
  createEffect(
    on(here, () => {
      setSelected(0)
      if (!study()) setTimeout(() => scroll && !scroll.isDestroyed && scroll.scrollTo(0), 0)
    }),
  )
  // a study asked for elsewhere (search, the palette)
  createEffect(
    on(app.wordStudy, (s) => {
      if (!s) return
      openStudy({ strongs: s })
      app.setWordStudy(undefined)
    }),
  )

  const entry = createMemo(() => {
    const s = study()
    return s && conc ? (conc.entry(s.from?.dstrong ?? s.strongs) ?? null) : null
  })
  const counts = createMemo(() => {
    const s = study()
    return s && conc ? { ...conc.count(s.strongs), perBook: conc.perBook(s.strongs) } : undefined
  })
  const occurrences = createMemo(() => {
    const s = study()
    if (!s || !conc) return []
    return conc.occurrences(s.strongs, { book: onlyBook() ? here().book : undefined, limit: OCCURRENCE_LIMIT })
  })
  const listed = createMemo(() => {
    const s = study()
    const total = s && conc ? conc.count(s.strongs, onlyBook() ? here().book : undefined).verses : 0
    return { shown: occurrences().length, more: occurrences().length >= OCCURRENCE_LIMIT, total }
  })

  function openStudy(s: Study) {
    if (!conc) return
    // A word too common to list whole opens on the book being read, so the list starts near
    // the verse the reader came from; f widens it.
    const narrow = conc.count(s.strongs).verses > OCCURRENCE_LIMIT && conc.count(s.strongs, here().book).verses > 0
    setStudy(s)
    setOnlyBook(narrow)
    setFullDefinition(false)
    const list = conc.occurrences(s.strongs, { book: narrow ? here().book : undefined, limit: OCCURRENCE_LIMIT })
    const at = list.findIndex((o) => o.book === here().book && o.chapter === here().chapter && o.verse === here().verse)
    // The entry shows first; the selection already sits on the reader's verse, so j/k moves
    // on from there (and scrolls the list).
    setPicked(Math.max(0, at))
    setTimeout(() => scroll && !scroll.isDestroyed && scroll.scrollTo(0), 0)
  }

  async function install() {
    if (!conc || progress() !== undefined) return
    setError(undefined)
    setProgress(0)
    try {
      const stats = await installConcordance(conc.db, app.deps.cacheDir ?? "/tmp", (e) => setProgress(e.phase === "download" ? e.fraction * 0.85 : 0.85 + e.fraction * 0.15))
      setInstalled(true)
      app.bump()
      app.toast(`${app.ip("language")}Hebrew and Greek installed`, `${stats.words.toLocaleString()} words, ${stats.entries.toLocaleString()} lexicon entries, offline`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setProgress(undefined)
    }
  }

  const move = (n: number, d: number, get: () => number, set: (v: number) => void, id: string) => {
    if (!n) return
    const next = Math.max(0, Math.min(n - 1, get() + d))
    set(next)
    setTimeout(() => scroll && !scroll.isDestroyed && scroll.scrollChildIntoView(`${id}-${next}`), 0)
  }

  props.register((name, sequence) => {
    if (!installed()) {
      if (name === "i" || name === "return") return void install(), true
      return false
    }
    const s = study()
    if (s) {
      const n = occurrences().length
      if (name === "escape" || name === "backspace" || name === "h" || name === "left") return setStudy(undefined), true
      if (name === "j" || name === "down") return move(n, 1, picked, setPicked, "occ"), true
      if (name === "k" || name === "up") return move(n, -1, picked, setPicked, "occ"), true
      if (name === "pagedown" || name === "space") return move(n, 10, picked, setPicked, "occ"), true
      if (name === "pageup") return move(n, -10, picked, setPicked, "occ"), true
      if (name === "f") {
        setOnlyBook((v) => !v)
        const at = occurrences().findIndex((o) => o.book === here().book && o.chapter === here().chapter && o.verse === here().verse)
        setPicked(Math.max(0, at))
        setTimeout(() => scroll && !scroll.isDestroyed && scroll.scrollChildIntoView(`occ-${Math.max(0, at)}`), 0)
        return true
      }
      if (name === "d") return setFullDefinition((v) => !v), true
      if (name === "return") {
        const o = occurrences()[picked()]
        if (o) app.goTo({ book: o.book, chapter: o.chapter, verseStart: o.verse })
        return true
      }
      return false
    }
    const n = words().length
    if (name === "j" || name === "down") return move(n, 1, selected, setSelected, "w"), true
    if (name === "k" || name === "up") return move(n, -1, selected, setSelected, "w"), true
    if (name === "g" && sequence !== "G") return setSelected(0), scroll?.scrollTo(0), true
    if (name === "return" || name === "l" || name === "right") {
      const w = words()[selected()]
      if (w) openStudy({ strongs: w.strongs, from: { ...w, book: here().book } })
      return true
    }
    return false
  })

  const muted = () => mixColor(t().backgroundPanel, t().text, 0.55)
  const textName = () =>
    hebrew() ? "Hebrew · Leningrad codex" : `Greek · ${textBase(app.translation()) === "TR" ? `Textus Receptus, as ${app.translation()}` : `Nestle-Aland, as ${app.translation()}`}`

  return (
    <Show
      when={installed()}
      fallback={
        <box flexDirection="column" gap={1}>
          <text fg={t().text} attributes={TextAttributes.BOLD}>
            {app.ip("language")}Hebrew and Greek
          </text>
          <text fg={t().textMuted} wrapMode="word">
            Every word of the Hebrew Old Testament and the Greek New Testament, with transliteration, an English gloss, its grammar and a Strong's
            number, and a concordance of every verse that uses it. From STEPBible (Tyndale House, Cambridge). About 108 MB, downloaded once, then
            offline.
          </text>
          <Show
            when={progress() !== undefined}
            fallback={
              <text wrapMode="none">
                <span style={{ fg: t().textMuted }}>press </span>
                <span style={{ fg: t().text }}>i</span>
                <span style={{ fg: t().textMuted }}> to install{app.studyFocused() ? "" : " (tab to focus this pane)"}</span>
              </text>
            }
          >
            <Bar fraction={progress()!} width={36} />
          </Show>
          <Show when={error()}>
            <text fg={t().error} wrapMode="word">
              {error()}
            </text>
          </Show>
        </box>
      }
    >
      <Show
        when={study()}
        fallback={
          <>
            {/* wraps rather than letting the text's name paint over the reference in a narrow pane */}
            <box flexDirection="row" flexWrap="wrap" columnGap={2} justifyContent="space-between" flexShrink={0} paddingBottom={1}>
              <text wrapMode="none" fg={t().textMuted}>
                {formatRef({ book: here().book, chapter: here().chapter, verseStart: here().verse })}
              </text>
              <text wrapMode="none" fg={t().textMuted}>
                {textName()}
              </text>
            </box>
            <scrollbox ref={(r: ScrollBoxRenderable) => (scroll = r)} flexGrow={1} scrollbarOptions={{ visible: false }}>
              <Show when={!words().length}>
                <text fg={t().textMuted} wrapMode="word">
                  No original-language words for this verse.
                </text>
              </Show>
              <For each={words()}>
                {(w, i) => {
                  const active = () => i() === selected()
                  const firstOfVerse = () => i() === 0 || words()[i() - 1]!.verse !== w.verse
                  return (
                    <box flexDirection="column">
                      <Show when={w.verse === 0 && firstOfVerse()}>
                        <text fg={t().textMuted} wrapMode="none">
                          Title
                        </text>
                      </Show>
                      <Show when={w.verse !== 0 && i() > 0 && firstOfVerse()}>
                        <box paddingTop={1}>
                          <text fg={t().textMuted} wrapMode="none">
                            Verse {w.verse}
                          </text>
                        </box>
                      </Show>
                      <box
                        id={`w-${i()}`}
                        {...LeftBar}
                        borderColor={active() ? t().primary : TRANSPARENT}
                        backgroundColor={active() ? t().backgroundElement : TRANSPARENT}
                        paddingLeft={1}
                        flexDirection="column"
                        onMouseUp={() => (setSelected(i()), openStudy({ strongs: w.strongs, from: { ...w, book: here().book } }))}
                      >
                        <box flexDirection="row" justifyContent="space-between">
                          <text wrapMode="none">
                            <span style={{ fg: w.inText ? (active() ? t().primary : t().text) : muted(), attributes: TextAttributes.BOLD }}>{shown(w.original)}</span>
                            <span style={{ fg: t().textMuted }}>{`  ${w.translit}`}</span>
                          </text>
                          <text wrapMode="none" fg={t().textMuted}>
                            {w.strongs}
                          </text>
                        </box>
                        <text wrapMode="word" fg={w.inText ? t().text : muted()}>
                          {w.gloss}
                          <Show when={!w.inText}>
                            <span style={{ fg: muted() }}>{`  · not in the text ${app.translation()} follows`}</span>
                          </Show>
                        </text>
                        <Show when={active()}>
                          <text wrapMode="word" fg={t().textMuted}>
                            {describeMorphology(w.grammar, here().book)}
                          </text>
                        </Show>
                      </box>
                    </box>
                  )
                }}
              </For>
              <text fg={t().textMuted} wrapMode="word" paddingTop={1}>
                {STEP_ATTRIBUTION}
              </text>
            </scrollbox>
            <text fg={t().textMuted} wrapMode="none" flexShrink={0}>
              j/k word · enter study · tab reader
            </text>
          </>
        }
      >
        {(s: () => Study) => (
          <>
            <box flexDirection="column" flexShrink={0} paddingBottom={1}>
              <text wrapMode="none">
                <span style={{ fg: t().primary, attributes: TextAttributes.BOLD }}>{shown(entry()?.lemma ?? s().from?.original ?? s().strongs)}</span>
                <span style={{ fg: t().textMuted }}>{`  ${entry()?.translit ?? s().from?.translit ?? ""}  ${entry()?.dstrong ?? s().strongs}`}</span>
              </text>
              <text wrapMode="word" fg={t().text}>
                {entry()?.gloss ?? s().from?.gloss ?? ""}
                <Show when={entry()?.morph}>
                  <span style={{ fg: t().textMuted }}>{`  ·  ${entry()!.morph}`}</span>
                </Show>
              </text>
              <Show when={s().from}>
                <text wrapMode="word" fg={t().textMuted}>
                  Here: {shown(s().from!.original)} “{s().from!.gloss}”, {describeMorphology(s().from!.grammar, s().from!.book)}
                </text>
              </Show>
              <Show when={counts()}>
                {(c: () => { words: number; verses: number; perBook: { book: number; count: number }[] }) => (
                  <text wrapMode="word" fg={t().text} attributes={TextAttributes.BOLD} paddingTop={1}>
                    {c().words.toLocaleString()} {c().words === 1 ? "time" : "times"} in {c().verses.toLocaleString()} {c().verses === 1 ? "verse" : "verses"},{" "}
                    {c().perBook.length} {c().perBook.length === 1 ? "book" : "books"}
                  </text>
                )}
              </Show>
              <text wrapMode="word" fg={t().textMuted}>
                {onlyBook() ? `In ${bookById(here().book).name}: ` : ""}
                {listed().more ? `the first ${listed().shown} of ${listed().total.toLocaleString()} verses` : `${listed().shown} ${listed().shown === 1 ? "verse" : "verses"}`}
                {onlyBook() ? " · f all books" : ` · f only ${bookById(here().book).name}`}
              </text>
            </box>
            <scrollbox ref={(r: ScrollBoxRenderable) => (scroll = r)} flexGrow={1} scrollbarOptions={{ visible: false }}>
              <Show when={entry()?.definition}>
                <text wrapMode="word">
                  <Inline
                    text={fullDefinition() ? entry()!.definition : entry()!.definition.split("\n").slice(0, 6).join("\n")}
                    fg={mixColor(t().backgroundPanel, t().text, 0.85)}
                  />
                </text>
                <Show when={entry()!.definition.split("\n").length > 6}>
                  <text fg={t().textMuted} wrapMode="none">
                    {fullDefinition() ? "d less" : "d full entry"}
                  </text>
                </Show>
              </Show>
              <Show when={counts()}>
                {(c: () => { words: number; verses: number; perBook: { book: number; count: number }[] }) => {
                  const top = () => [...c().perBook].sort((a, b) => b.count - a.count).slice(0, 8)
                  const most = () => top()[0]?.count ?? 1
                  return (
                    <box flexDirection="column" paddingTop={1}>
                      <For each={top()}>
                        {(p) => (
                          <box flexDirection="row" gap={1}>
                            <text wrapMode="none" width={10} fg={p.book === here().book ? t().primary : t().textMuted}>
                              {bookById(p.book).short}
                            </text>
                            <LineBar fraction={p.count / most()} width={24} color={p.book === here().book ? t().primary : t().accent} />
                            <text wrapMode="none" fg={t().textMuted}>
                              {String(p.count)}
                            </text>
                          </box>
                        )}
                      </For>
                      <Show when={c().perBook.length > 8}>
                        <text wrapMode="word" fg={t().textMuted}>
                          also{" "}
                          {[...c().perBook]
                            .sort((a, b) => b.count - a.count)
                            .slice(8)
                            .sort((a, b) => a.book - b.book)
                            .map((p) => `${bookById(p.book).short} ${p.count}`)
                            .join(" · ")}
                        </text>
                      </Show>
                    </box>
                  )
                }}
              </Show>
              <box height={1} />
              <For each={occurrences()}>
                {(o, i) => {
                  const active = () => i() === picked()
                  const isHere = () => o.book === here().book && o.chapter === here().chapter && o.verse === here().verse
                  const text = () => {
                    const v = app.deps.bible.verses(app.translation(), { book: o.book, chapter: o.chapter, verseStart: o.verse })[0]
                    return v ? plain(v.text) : ""
                  }
                  return (
                    <box
                      id={`occ-${i()}`}
                      {...LeftBar}
                      borderColor={active() ? t().primary : isHere() ? t().accent : TRANSPARENT}
                      backgroundColor={active() ? t().backgroundElement : TRANSPARENT}
                      paddingLeft={1}
                      onMouseUp={() => (setPicked(i()), app.goTo({ book: o.book, chapter: o.chapter, verseStart: o.verse }))}
                    >
                      <text wrapMode="word">
                        <span style={{ fg: active() || isHere() ? t().primary : t().text, attributes: TextAttributes.BOLD }}>
                          {formatRef({ book: o.book, chapter: o.chapter, verseStart: o.verse }, { short: true })}
                        </span>
                        <span style={{ fg: t().textMuted }}>{`  ${o.forms.split(", ").map(shown).join(", ")}  `}</span>
                        <span style={{ fg: active() ? t().text : mixColor(t().backgroundPanel, t().text, 0.75) }}>{text()}</span>
                      </text>
                    </box>
                  )
                }}
              </For>
            </scrollbox>
            <text fg={t().textMuted} wrapMode="none" flexShrink={0}>
              j/k verse · enter open · f book · esc words
            </text>
          </>
        )}
      </Show>
    </Show>
  )
}
