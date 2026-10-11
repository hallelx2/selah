// The keyboard tour: real screens Selah drew (site/media/tour.json, captured by
// scripts/site-media.tsx), drawn here as text and colours. The visitor presses the key each step
// asks for, or taps it, and sees the screen the app drew when that key was pressed.
const box = document.querySelector("[data-tour]")
if (box) start(box)

async function start(box) {
  const term = box.querySelector(".term")
  const pre = term.querySelector("pre")
  const hint = box.querySelector("[data-hint]")
  const caption = box.querySelector("[data-caption]")
  const press = box.querySelector("[data-press]")
  const pressLabel = box.querySelector("[data-press-label]")
  const count = box.querySelector("[data-count]")
  const bar = box.querySelector("[data-bar]")
  // a phone gets the tour recorded in a 64-column terminal: the app as it lays itself out narrow,
  // legible at that width, rather than a wide screen shrunk to a blur
  const narrow = term.clientWidth < 560
  let tour
  try {
    tour = await (await fetch(narrow ? "/media/tour-narrow.json" : "/media/tour.json")).json()
  } catch {
    caption.textContent = "The tour could not load. The video above shows the same app."
    return
  }
  const { palette, frames, steps, cols, rows } = tour
  term.style.setProperty("--cols", cols)
  term.style.setProperty("--rows", rows)

  // the terminal's own background: the colour most of the first screen is painted with
  const weight = new Map()
  for (const line of frames[0]) for (const [text, , bg] of line) weight.set(bg, (weight.get(bg) ?? 0) + text.length)
  const ground = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (palette[ground]) term.style.background = palette[ground]

  const seg = new Intl.Segmenter("en", { granularity: "grapheme" })
  const width = (s) => [...seg.segment(s)].length
  const escape = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])
  const html = new Map()
  const draw = (index) => {
    if (!html.has(index))
      html.set(
        index,
        frames[index]
          .map(
            (line) =>
              `<span class="ln">${line
                .map(([text, fg, bg, attr]) => {
                  const style = [`width:${width(text)}ch`]
                  if (palette[fg]) style.push(`color:${palette[fg]}`)
                  if (palette[bg] && bg !== ground) style.push(`background:${palette[bg]}`)
                  const cls = (attr & 1 ? " b" : "") + (attr & 4 ? " i" : "")
                  return `<span class="r${cls}" style="${style.join(";")}">${escape(text)}</span>`
                })
                .join("")}</span>`,
          )
          // rows are blocks; a newline between them inside <pre> would add an empty line each
          .join(""),
      )
    pre.innerHTML = html.get(index)
  }

  let i = 0
  const show = () => {
    const step = steps[i]
    draw(step.frame)
    caption.textContent = step.caption
    count.textContent = `${i + 1} / ${steps.length}`
    bar.style.width = `${((i + 1) / steps.length) * 100}%`
    const last = !step.key
    press.hidden = last
    pressLabel.textContent = last ? "" : "Press"
    if (!last) {
      press.textContent = step.label
      press.setAttribute("aria-label", `Press ${step.label}`)
    }
    box.classList.toggle("done", last)
  }
  const advance = () => {
    if (i < steps.length - 1) i++
    show()
  }
  const wrong = (got) => {
    press.classList.remove("nudge")
    void press.offsetWidth
    press.classList.add("nudge")
    caption.textContent = `That was ${got}. ${steps[i].caption}`
  }

  const name = (e) => {
    if (e.ctrlKey && e.key.length === 1) return `ctrl+${e.key.toLowerCase()}`
    if (e.metaKey || e.altKey) return null
    return { Enter: "enter", Tab: "tab", Escape: "esc", " ": "space" }[e.key] ?? (e.key.length === 1 ? e.key : null)
  }
  term.addEventListener("keydown", (e) => {
    const key = name(e)
    if (!key) return
    const step = steps[i]
    if (!step.key) return
    if (key === step.key) {
      // the step's own key is taken here, so tab, ctrl+p and / act on the tour, not the page
      e.preventDefault()
      return advance()
    }
    // tab and esc keep their usual jobs, so a keyboard user can always leave the tour
    if (key === "tab") return
    if (key === "esc") return term.blur()
    e.preventDefault()
    wrong(key)
  })
  term.addEventListener("focus", () => (hint.hidden = true))
  term.addEventListener("blur", () => (hint.hidden = i > 0))
  term.addEventListener("click", () => term.focus())
  press.addEventListener("click", () => {
    // once someone has found the key, the hint has done its job and would only hide the screen
    hint.remove()
    advance()
    // on a phone the keyboard would cover the screen, so the focus stays on the tap target
    if (matchMedia("(pointer: fine)").matches) term.focus()
  })
  box.querySelector("[data-back]").addEventListener("click", () => {
    i = Math.max(0, i - 1)
    show()
  })
  box.querySelector("[data-restart]").addEventListener("click", () => {
    i = 0
    show()
  })
  if (matchMedia("(pointer: coarse)").matches) hint.textContent = "Tap the key below the screen"
  show()
}
