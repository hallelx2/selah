// The engravings: filter by testament and words, and a lightbox with zoom and pan. Each plate has
// its own address (/engravings#031), so a link opens it.
const gallery = document.querySelector("[data-gallery]")
if (gallery) start()

function start() {
  const plates = JSON.parse(document.querySelector("[data-plates]").textContent)
  const items = [...gallery.children]
  const q = document.querySelector("[data-q]")
  const segs = [...document.querySelectorAll("[data-t]")]
  const countEl = document.querySelector("[data-count]")
  let testament = "all"

  const filter = () => {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
    let shown = 0
    for (const li of items) {
      const ok = (testament === "all" || li.dataset.testament === testament) && words.every((w) => li.dataset.text.includes(w))
      li.hidden = !ok
      if (ok) shown++
    }
    countEl.textContent = shown === items.length ? "" : shown ? `${shown} of ${items.length}` : "None match. Try fewer words."
  }
  q.addEventListener("input", filter)
  for (const s of segs)
    s.addEventListener("click", () => {
      testament = s.dataset.t
      for (const x of segs) x.setAttribute("aria-pressed", String(x === s))
      filter()
    })

  // --- the lightbox ---
  const dialog = document.querySelector("[data-lightbox]")
  const stage = dialog.querySelector("[data-stage]")
  const img = dialog.querySelector("[data-lb-img]")
  const field = (k) => dialog.querySelector(`[data-lb-${k}]`)
  let current = -1
  let zoomed = false
  let pan = { x: 0, y: 0 }
  let drag = null

  const visible = () => items.filter((li) => !li.hidden).map((li) => li.dataset.id)
  const place = () => {
    img.style.transform = zoomed ? `translate(${pan.x}px, ${pan.y}px) scale(2.2)` : ""
    stage.classList.toggle("zoomed", zoomed)
  }
  const open = (id, push = true) => {
    const index = plates.findIndex((p) => p.id === id)
    if (index < 0) return
    const p = plates[index]
    current = index
    zoomed = false
    pan = { x: 0, y: 0 }
    place()
    img.src = `/engravings/full/${p.id}.webp`
    img.alt = p.title
    img.width = p.width
    img.height = p.height
    field("no").textContent = `Plate ${p.id}`
    field("title").textContent = p.title
    field("ref").textContent = p.ref
    field("caption").textContent = p.caption
    if (!dialog.open) dialog.showModal()
    if (push) history.replaceState(null, "", `#${p.id}`)
  }
  const close = () => {
    dialog.close()
  }
  dialog.addEventListener("close", () => {
    history.replaceState(null, "", location.pathname + location.search)
    const li = items.find((x) => x.dataset.id === plates[current]?.id)
    li?.querySelector("a").focus()
  })
  const step = (d) => {
    const ids = visible()
    if (!ids.length) return
    const at = ids.indexOf(plates[current].id)
    // the open plate may be one the filter hides (opened from a link): start from an end
    if (at < 0) return open(d > 0 ? ids[0] : ids[ids.length - 1])
    open(ids[(at + d + ids.length) % ids.length])
  }
  for (const li of items)
    li.querySelector("a").addEventListener("click", (e) => {
      e.preventDefault()
      open(li.dataset.id)
    })
  dialog.querySelector("[data-prev]").addEventListener("click", () => step(-1))
  dialog.querySelector("[data-next]").addEventListener("click", () => step(1))
  dialog.querySelector("[data-close]").addEventListener("click", close)
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close()
  })
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") step(1)
    else if (e.key === "ArrowLeft") step(-1)
  })

  // zoom where you click, then drag to look around
  stage.addEventListener("pointerdown", (e) => {
    if (!zoomed) return
    drag = { x: e.clientX - pan.x, y: e.clientY - pan.y, moved: false }
    stage.setPointerCapture(e.pointerId)
  })
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return
    pan = { x: e.clientX - drag.x, y: e.clientY - drag.y }
    drag.moved = true
    place()
  })
  stage.addEventListener("pointerup", (e) => {
    const moved = drag?.moved
    drag = null
    if (moved) return
    if (zoomed) {
      zoomed = false
      pan = { x: 0, y: 0 }
    } else {
      const r = img.getBoundingClientRect()
      zoomed = true
      // keep the point you clicked under the pointer
      pan = { x: (r.left + r.width / 2 - e.clientX) * 1.2, y: (r.top + r.height / 2 - e.clientY) * 1.2 }
    }
    place()
  })

  const fromHash = () => {
    const id = location.hash.slice(1)
    if (/^\d{3}$/.test(id)) open(id, false)
  }
  addEventListener("hashchange", fromHash)
  fromHash()
}
