// Shared behaviour for every page: install tabs, copy buttons, clips that play only while seen,
// the theme switcher, the keyboard map, and the download page's guess at your system.
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
const isWindows = /Windows/i.test(navigator.userAgent)

for (const box of document.querySelectorAll("[data-tabs]")) {
  const tabs = [...box.querySelectorAll('[role="tab"]')]
  const show = (name) => {
    for (const t of tabs) {
      t.setAttribute("aria-selected", String(t.dataset.tab === name))
      t.tabIndex = t.dataset.tab === name ? 0 : -1
    }
    for (const p of box.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== name
  }
  // Windows visitors see PowerShell first
  show(isWindows ? "powershell" : tabs[0].dataset.tab)
  for (const t of tabs) {
    t.addEventListener("click", () => show(t.dataset.tab))
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
      const i = tabs.indexOf(t) + (e.key === "ArrowRight" ? 1 : -1)
      const next = tabs[(i + tabs.length) % tabs.length]
      show(next.dataset.tab)
      next.focus()
    })
  }
}

for (const b of document.querySelectorAll("[data-copy]")) {
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy)
      b.textContent = "copied"
      b.setAttribute("data-copied", "")
    } catch {
      b.textContent = "select it"
    }
    setTimeout(() => {
      b.textContent = "copy"
      b.removeAttribute("data-copied")
    }, 1600)
  })
}

// Clips load when they come near the screen and play only while most of one is visible, so a
// page of them costs what you watch. With reduced motion they stay on their poster, with controls.
const clips = [...document.querySelectorAll("video")]
if (reduced) {
  for (const v of clips) {
    v.removeAttribute("autoplay")
    v.pause()
    v.controls = true
  }
} else if ("IntersectionObserver" in window) {
  const near = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting && e.target.preload === "none") {
          e.target.preload = "auto"
          e.target.load()
        }
    },
    { rootMargin: "600px 0px" },
  )
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target
        if (e.intersectionRatio >= 0.45) v.play().catch(() => {})
        else v.pause()
      }
    },
    { threshold: [0, 0.45, 1] },
  )
  for (const v of document.querySelectorAll("video[data-lazy]")) {
    near.observe(v)
    seen.observe(v)
  }
} else {
  for (const v of document.querySelectorAll("video[data-lazy]")) {
    v.preload = "auto"
    v.autoplay = true
  }
}

// Themes: the same screen, drawn by Selah in each theme
for (const box of document.querySelectorAll("[data-themes]")) {
  const chips = [...box.querySelectorAll("[data-theme]")]
  const imgs = [...box.querySelectorAll("[data-theme-img]")]
  for (const c of chips)
    c.addEventListener("click", () => {
      for (const x of chips) x.setAttribute("aria-pressed", String(x === c))
      for (const i of imgs) i.hidden = i.dataset.themeImg !== c.dataset.theme
    })
}

// The keyboard map: what each lit key does, in the help's own words
for (const kb of document.querySelectorAll("[data-kb]")) {
  const map = JSON.parse(kb.querySelector("[data-kb-map]").textContent)
  const outBox = kb.querySelector("[data-kb-out]")
  const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
  const show = (key) => {
    for (const k of kb.querySelectorAll(".key.on")) k.classList.remove("on")
    key.classList.add("on")
    const list = map[key.dataset.k] ?? []
    outBox.innerHTML = list
      .map((e) => `<div class="kb-line"><span class="kb-group">${escape(e.group)}</span><kbd>${escape(e.keys)}</kbd><span>${escape(e.what)}</span></div>`)
      .join("")
  }
  for (const key of kb.querySelectorAll(".key.lit")) {
    key.addEventListener("mouseenter", () => show(key))
    key.addEventListener("focus", () => show(key))
    key.addEventListener("click", () => show(key))
  }
  const first = kb.querySelector('.key.lit[data-k="tab"]') ?? kb.querySelector(".key.lit")
  if (first) show(first)
}

// Download: lead with this visitor's system, and mark the builds that fit it
const cards = document.querySelector("[data-os-cards]")
if (cards) {
  const os = isWindows ? "windows" : /Mac/i.test(navigator.userAgent) ? "mac" : /Linux|X11/i.test(navigator.userAgent) ? "linux" : ""
  const card = cards.querySelector(`[data-os="${os === "windows" ? "windows" : "unix"}"]`)
  if (os && card) {
    card.classList.add("yours")
    cards.prepend(card)
    for (const row of document.querySelectorAll(`tr[data-platform="${os}"]`)) row.classList.add("yours")
    const note = document.querySelector("[data-os-note]")
    const name = { windows: "Windows", mac: "macOS", linux: "Linux" }[os]
    if (note) note.textContent = `This looks like ${name}, so its builds are marked below.`
  }
}
