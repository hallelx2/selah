// Install tabs, copy buttons, and a still video for people who ask for reduced motion.
for (const box of document.querySelectorAll("[data-tabs]")) {
  const tabs = [...box.querySelectorAll('[role="tab"]')]
  const show = (name) => {
    for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.tab === name))
    for (const p of box.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== name
  }
  // Windows visitors see PowerShell first
  if (/Windows/i.test(navigator.userAgent)) show("powershell")
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

if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
  for (const v of document.querySelectorAll("video")) {
    v.removeAttribute("autoplay")
    v.pause()
    v.controls = true
  }
}
