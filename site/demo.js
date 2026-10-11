// /demo: the chapter list seeks the film, and the chapter playing is marked as it plays.
const film = document.querySelector("[data-film]")
if (film) {
  const buttons = [...document.querySelectorAll("[data-seek]")]
  const starts = buttons.map((b) => Number(b.dataset.seek))
  for (const b of buttons)
    b.addEventListener("click", () => {
      film.currentTime = Number(b.dataset.seek) + 0.05
      film.play().catch(() => {})
      film.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" })
    })
  film.addEventListener("timeupdate", () => {
    let current = 0
    for (let i = 0; i < starts.length; i++) if (film.currentTime >= starts[i]) current = i
    buttons.forEach((b, i) => b.toggleAttribute("aria-current", i === current))
  })
  // a link to /demo#t=95 starts there
  const t = /#t=(\d+)/.exec(location.hash)
  if (t) {
    const seek = () => (film.currentTime = Number(t[1]))
    // the metadata may already be here (cached) before this deferred script runs
    if (film.readyState >= 1) seek()
    else film.addEventListener("loadedmetadata", seek, { once: true })
  }
}
