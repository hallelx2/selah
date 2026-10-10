import { ImageRenderable, RGBA, TextAttributes, type ImageRenderableOptions, type OptimizedBuffer, type RenderContext } from "@opentui/core"
import { extend, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { bookById } from "../data/books"
import { formatRef } from "../data/ref"
import { installScenes, PLATES, sceneFile, scenesInstalled, SCENES_BYTES, type Plate } from "../data/scenes"
import { SelectDialog } from "./components/dialog"
import { Bar } from "./components/primitives"
import { ease, mixColor, type Anim } from "./motion"
import { useApp, type App } from "./state"

/** How long an engraving takes to surface, row by row, top to bottom. */
export const REVEAL_MS = 1200
/** One slow Ken Burns drift (there and back is two). */
export const DRIFT_MS = 24_000
/**
 * The drift moves a few cells a second, so it redraws at 12 frames a second on its own timer
 * rather than keeping the 60 fps motion clock running: a full-screen half-block image costs
 * about 8 ms a frame (measured at 200×55), which at 60 fps is half a core.
 */
export const DRIFT_FPS = 12

// a stable pseudo-random number per (seed, i), for the ragged wet-ink edge
const hash = (seed: number, i: number) => {
  let h = (seed * 374761393 + i * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

interface SceneImageOptions extends ImageRenderableOptions {
  reveal?: number
  zoom?: number
  panX?: number
  panY?: number
  ink?: RGBA
  paper?: RGBA
  seed?: number
}

/**
 * An engraving drawn through OpenTUI's image path (kitty, sixel or half-blocks, chosen for the
 * terminal), with two effects that only move the source rectangle, so a graphics terminal never
 * re-uploads the picture: the ink reveal draws the top `reveal` of the picture with a ragged wet
 * edge below it, and the Ken Burns drift crops a slowly moving, slowly zooming window.
 */
export class SceneImageRenderable extends ImageRenderable {
  private _reveal = 1
  private _zoom = 1
  private _panX = 0.5
  private _panY = 0.5
  private _ink = RGBA.fromHex("#e6e6e6")
  private _paper = RGBA.fromHex("#141414")
  private _seed = 1

  constructor(ctx: RenderContext, options: SceneImageOptions = {}) {
    super(ctx, { ...options, width: options.width ?? 1, height: options.height ?? 1, fit: "fit" })
    if (options.reveal !== undefined) this._reveal = options.reveal
  }

  set reveal(v: number) {
    this._reveal = Math.max(0, Math.min(1, v))
    this.requestRender()
  }
  set zoom(v: number) {
    this._zoom = Math.max(1, v)
    this.requestRender()
  }
  set panX(v: number) {
    this._panX = Math.max(0, Math.min(1, v))
    this.requestRender()
  }
  set panY(v: number) {
    this._panY = Math.max(0, Math.min(1, v))
    this.requestRender()
  }
  set ink(v: RGBA) {
    this._ink = v
    this.requestRender()
  }
  set paper(v: RGBA) {
    this._paper = v
    this.requestRender()
  }
  set seed(v: number) {
    this._seed = v
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const image = this.image
    if (!image || this.width <= 0 || this.height <= 0) return
    const fitted = this.getFittedSize(this.width, this.height)
    if (fitted.width <= 0 || fitted.height <= 0) return
    const x = this.screenX + Math.floor((this.width - fitted.width) / 2)
    const y = this.screenY + Math.floor((this.height - fitted.height) / 2)
    const ctx = this.ctx as RenderContext & { resolution?: { width: number; height: number }; terminalWidth?: number; terminalHeight?: number }
    const res = ctx.resolution && ctx.terminalWidth && ctx.terminalHeight ? ctx.resolution : undefined
    const pixelWidth = res ? Math.max(1, Math.round((fitted.width * res.width) / ctx.terminalWidth!)) : 0
    const pixelHeight = res ? Math.max(1, Math.round((fitted.height * res.height) / ctx.terminalHeight!)) : 0

    // Ken Burns: a window of 1/zoom of the picture, placed by pan
    const sw = image.width / this._zoom
    const sh = image.height / this._zoom
    const sx = Math.round((image.width - sw) * this._panX)
    const sy = Math.round((image.height - sh) * this._panY)

    const rows = this._reveal >= 1 ? fitted.height : Math.floor(fitted.height * this._reveal)
    if (rows > 0) {
      const part = rows / fitted.height
      buffer.drawImage(
        image,
        x,
        y,
        fitted.width,
        rows,
        pixelWidth,
        Math.max(1, Math.round(pixelHeight * part)),
        sx,
        sy,
        Math.max(1, Math.round(sw)),
        Math.max(1, Math.round(sh * part)),
        this.protocol,
      )
    }
    // the wet edge: ink still soaking into the paper just below what has surfaced
    if (this._reveal < 1) {
      const shades = ["▓", "▒", "░"]
      for (let e = 0; e < 3; e++) {
        const row = y + rows + e
        if (row >= y + fitted.height) break
        for (let c = 0; c < fitted.width; c++) {
          const n = hash(this._seed + rows, c * 3 + e)
          if (n < 0.18 + e * 0.22) continue
          const strength = (1 - e / 3) * (0.35 + 0.4 * n)
          buffer.setCell(x + c, row, shades[e]!, mixColor(this._paper, this._ink, strength), this._paper)
        }
      }
    }
  }
}

extend({ scene_image: SceneImageRenderable })

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    scene_image: typeof SceneImageRenderable
  }
}

/** The gallery: every plate, by book, opening the scene. */
export function openGallery(app: App) {
  app.openDialog(
    () => (
      <SelectDialog
        title="Doré Bible Gallery"
        placeholder="Search the engravings"
        initial={app.scene()?.id}
        items={PLATES.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.ref ? formatRef({ book: p.ref.book, chapter: p.ref.chapter, verseStart: p.ref.verseStart, verseEnd: p.ref.verseEnd ?? undefined }) : "Apocrypha",
          category: p.ref ? `${bookById(p.ref.book).testament === "OT" ? "Old" : "New"} Testament` : "Apocrypha",
          search: `${p.title} ${p.ref ? bookById(p.ref.book).name : "apocrypha"}`,
          value: p,
        }))}
        onSelect={(item) => {
          app.closeAllDialogs()
          app.openScene(item.value)
        }}
      />
    ),
    "large",
  )
}

/**
 * The scene, full screen: the engraving surfacing like ink, then drifting, with its title, the
 * passage it shows and the gallery's caption. ←/→ walk the gallery, enter reads the passage.
 */
export function SceneLayer() {
  const app = useApp()
  return (
    <Show when={app.scene()}>
      {(plate: () => Plate) => <Scene plate={plate()} />}
    </Show>
  )
}

function Scene(props: { plate: Plate }) {
  const app = useApp()
  const dims = useTerminalDimensions()
  const t = () => app.theme()
  const dir = () => app.deps.scenesDir ?? ""
  const [installed, setInstalled] = createSignal(!!app.deps.scenesDir && scenesInstalled(dir()))
  const [progress, setProgress] = createSignal<number | undefined>()
  const [error, setError] = createSignal<string | undefined>()
  const [loaded, setLoaded] = createSignal(false)
  const [reveal, setReveal] = createSignal<Anim | undefined>()
  const [driftFrom, setDriftFrom] = createSignal<number | undefined>()
  const [clock, setClock] = createSignal(0)

  const plate = () => props.plate
  const seed = createMemo(() => Number(plate().id))
  const index = () => PLATES.findIndex((p) => p.id === plate().id)

  // each plate surfaces anew; the drift starts once it has
  createEffect(
    on(plate, () => {
      setLoaded(false)
      setReveal(undefined)
      setDriftFrom(undefined)
    }),
  )
  const surfaced = () => app.motion.progress(reveal(), ease.outCubic)
  createEffect(() => {
    const r = reveal()
    if (!r || app.motion.reduced()) return
    if (app.motion.progress(r) >= 1 && driftFrom() === undefined) setDriftFrom(app.now())
  })
  createEffect(() => {
    if (driftFrom() === undefined) return
    const timer = setInterval(() => setClock(app.now()), 1000 / DRIFT_FPS)
    onCleanup(() => clearInterval(timer))
  })
  // the drift: zoom in to 1.12 and pan along a per-plate diagonal, then back, forever
  const kb = createMemo(() => {
    const from = driftFrom()
    if (from === undefined || app.motion.reduced()) return { zoom: 1, panX: 0.5, panY: 0.5 }
    clock()
    const legs = Math.max(0, app.now() - from) / DRIFT_MS
    const leg = Math.floor(legs)
    const p = ease.inOutSine(legs - leg)
    const k = leg % 2 === 0 ? p : 1 - p
    const ax = hash(seed(), 1) < 0.5 ? 0.3 : 0.7
    const ay = hash(seed(), 2) < 0.5 ? 0.25 : 0.65
    return { zoom: 1 + 0.12 * k, panX: 0.5 + (ax - 0.5) * k, panY: 0.5 + (ay - 0.5) * k }
  })

  let attempt = 0
  async function install() {
    if (progress() !== undefined || !app.deps.scenesDir) return
    const mine = ++attempt
    setError(undefined)
    setProgress(0)
    try {
      // progress from an attempt that has ended (failed, or this view closed) is ignored
      await installScenes(dir(), (e) => mine === attempt && setProgress(e.bytes / SCENES_BYTES), app.deps.fetch)
      setInstalled(true)
      app.toast(`${app.ip("star")}Doré's engravings installed`, `${PLATES.length} plates, offline`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mine === attempt) attempt++
      setProgress(undefined)
    }
  }
  onCleanup(() => attempt++)

  const go = (d: number) => app.openScene(PLATES[(index() + d + PLATES.length) % PLATES.length]!)
  const read = () => {
    const r = plate().ref
    if (!r) return app.toast("This plate is from the Apocrypha, which Selah does not include")
    app.closeScene()
    app.openChapter({ book: r.book, chapter: r.chapter }, r.verseStart)
  }

  app.useKeys(
    (key) => {
      const k = key.name
      if (k === "escape" || k === "q" || (k === "i" && installed())) return app.closeScene(), true
      if (!installed()) {
        if (k === "i" || k === "return") return void install(), true
        return true
      }
      if (k === "right" || k === "l" || k === "n") return go(1), true
      if (k === "left" || k === "h" || k === "p") return go(-1), true
      if (k === "return") return read(), true
      if (k === "g") return openGallery(app), true
      return true
    },
    { modal: true },
  )

  const ref = () => {
    const r = plate().ref
    return r ? formatRef({ book: r.book, chapter: r.chapter, verseStart: r.verseStart, verseEnd: r.verseEnd ?? undefined }) : "Apocrypha"
  }
  const captionLines = () => Math.max(2, Math.min(5, Math.floor(dims().height / 9)))
  const clipped = (s: string, lines: number, width: number) => {
    const max = lines * Math.max(20, width - 2)
    return s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : s
  }
  const textWidth = () => Math.min(100, dims().width - 8)


  return (
    <box position="absolute" left={0} top={0} width={dims().width} height={dims().height} zIndex={2500} backgroundColor={t().background} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between" height={1} flexShrink={0} paddingLeft={2} paddingRight={2} backgroundColor={t().backgroundPanel}>
        <text wrapMode="none" fg={t().textMuted}>
          {app.ip("star")}Gustave Doré · The Bible Gallery
        </text>
        <text wrapMode="none" fg={t().textMuted}>
          plate {index() + 1} of {PLATES.length}
        </text>
      </box>
      <Show
        when={installed()}
        fallback={
          <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column" gap={1}>
            <text fg={t().text} attributes={TextAttributes.BOLD}>
              {plate().title}
            </text>
            <text fg={t().textMuted} wrapMode="word" width={Math.min(70, dims().width - 8)}>
              Doré's {PLATES.length} Bible engravings, each opening at the passage it shows. About {Math.round(SCENES_BYTES / 1e6)} MB, downloaded once from
              Project Gutenberg, then offline.
            </text>
            <Show
              when={progress() !== undefined}
              fallback={
                <text wrapMode="none">
                  <span style={{ fg: t().textMuted }}>press </span>
                  <span style={{ fg: t().text }}>i</span>
                  <span style={{ fg: t().textMuted }}> to install · esc close</span>
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
        <box flexGrow={1} paddingTop={1} paddingLeft={2} paddingRight={2}>
          <scene_image
            source={sceneFile(dir(), plate())}
            width={dims().width - 4}
            height={Math.max(4, dims().height - captionLines() - 8)}
            reveal={loaded() ? (app.motion.reduced() ? 1 : surfaced()) : 0}
            zoom={kb().zoom}
            panX={kb().panX}
            panY={kb().panY}
            ink={t().text}
            paper={t().background}
            seed={seed()}
            onLoad={() => {
              setLoaded(true)
              setReveal(app.motion.start(REVEAL_MS))
            }}
            onError={(e: unknown) => setError(e instanceof Error ? e.message : String(e))}
          />
        </box>
        <box flexDirection="column" flexShrink={0} alignItems="center" paddingTop={1}>
          <text wrapMode="none">
            <span style={{ fg: t().text, attributes: TextAttributes.BOLD }}>{plate().title}</span>
            <span style={{ fg: t().textMuted }}>{"  ·  "}</span>
            <span style={{ fg: t().accent }}>{ref()}</span>
          </text>
          <text wrapMode="word" width={textWidth()} fg={mixColor(t().background, t().text, 0.7)}>
            {clipped(plate().caption, captionLines(), textWidth())}
          </text>
          <Show when={error()}>
            <text fg={t().error} wrapMode="word">
              {error()}
            </text>
          </Show>
        </box>
      </Show>
      <box flexDirection="row" justifyContent="space-between" height={1} flexShrink={0} paddingLeft={2} paddingRight={2} marginTop={1}>
        <text wrapMode="none" fg={t().textMuted}>
          {dims().width >= 116 ? "Gustave Doré, 1866 · Project Gutenberg #8710 · public domain" : "Doré, 1866 · public domain"}
        </text>
        <text wrapMode="none" fg={t().textMuted}>
          ←/→ plates · enter read · g gallery · esc close
        </text>
      </box>
    </box>
  )
}
