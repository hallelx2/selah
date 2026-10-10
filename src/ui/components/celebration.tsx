import { FrameBufferRenderable, RGBA, TextAttributes, type OptimizedBuffer, type RenderContext } from "@opentui/core"
import { extend, useTerminalDimensions } from "@opentui/solid"
import { Show } from "solid-js"
import { ease, mixColor } from "../motion"
import { useApp } from "../state"

interface RingsOptions {
  width: number
  height: number
  progress?: number
  color?: RGBA
  spark?: RGBA
}

/**
 * Rings of light expanding from the centre (TerminalTextEffects' "rings", reworked): three
 * soft wavefronts, blended over whatever is beneath, with sparks riding the leading edge.
 * Pure function of `progress`, so it renders identically in tests and in a terminal.
 */
class RingsRenderable extends FrameBufferRenderable {
  private _progress = 0
  private _color = RGBA.fromHex("#e5c07b")
  private _spark = RGBA.fromHex("#ffffff")

  constructor(ctx: RenderContext, options: Partial<RingsOptions> = {}) {
    // Solid sets props after construction, so start at 1×1 and let width/height resize it.
    super(ctx, { ...options, width: options.width ?? 1, height: options.height ?? 1, respectAlpha: true })
    if (options.progress !== undefined) this._progress = options.progress
    if (options.color) this._color = options.color
    if (options.spark) this._spark = options.spark
  }

  set progress(v: number) {
    this._progress = v
    this.requestRender()
  }
  set color(v: RGBA) {
    this._color = v
    this.requestRender()
  }
  set spark(v: RGBA) {
    this._spark = v
    this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const fb = this.frameBuffer
    const w = fb.width
    const h = fb.height
    fb.clear(RGBA.fromInts(0, 0, 0, 0))
    const p = this._progress
    const cx = w / 2
    const cy = h / 2
    const max = Math.hypot(cx, cy * 2)
    for (let ring = 0; ring < 3; ring++) {
      const local = Math.max(0, Math.min(1, (p - ring * 0.14) / 0.72))
      if (local <= 0 || local >= 1) continue
      const radius = ease.outCubic(local) * max
      const fadeOut = 1 - local
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          // Cells are about twice as tall as wide; scale y so the rings look round.
          const d = Math.hypot(x - cx, (y - cy) * 2)
          const band = Math.exp(-((d - radius) ** 2) / (2 * 2.2 ** 2))
          const a = band * fadeOut * 0.55
          if (a < 0.03) continue
          // A few sparks ride the crest, kept sparse so they glint rather than scramble text.
          const spark = band > 0.97 && (x * 7 + y * 13 + ring * 5) % 53 === 0
          const bg = RGBA.fromValues(this._color.r, this._color.g, this._color.b, a)
          fb.setCellWithAlphaBlending(x, y, spark ? "✦" : " ", spark ? this._spark : bg, bg, 0)
        }
      }
    }
    super.renderSelf(buffer)
  }
}

extend({ rings_fx: RingsRenderable })

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    rings_fx: typeof RingsRenderable
  }
}

/** A streak milestone: rings of light and the number, once, over everything. */
export function CelebrationLayer() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const t = () => app.theme()
  const active = () => {
    const c = app.celebration()
    return c && !app.motion.done(c.anim) ? c : undefined
  }
  const p = () => app.motion.progress(active()?.anim)
  // The card rises in, holds, then fades with the rings.
  const cardIn = () => ease.outBack(Math.min(1, p() / 0.25))
  const cardOut = () => (p() > 0.75 ? (p() - 0.75) / 0.25 : 0)
  const fade = (c: RGBA) => mixColor(c, t().background.a === 0 ? t().backgroundPanel : t().background, cardOut())
  return (
    <Show when={active()}>
      {(c: () => { streak: number }) => (
        <box position="absolute" left={0} top={0} width={dims().width} height={dims().height} zIndex={5000}>
          <rings_fx width={dims().width} height={dims().height} progress={p()} color={t().warning} spark={t().text} />
          <box
            position="absolute"
            top={Math.floor(dims().height / 2) - 4 + Math.round((1 - cardIn()) * 3)}
            left={Math.floor(dims().width / 2) - 22}
            width={44}
            backgroundColor={fade(t().backgroundPanel)}
            alignItems="center"
            flexDirection="column"
            paddingTop={1}
            paddingBottom={1}
          >
            <ascii_font text={String(c().streak)} font="block" color={[fade(t().warning), fade(t().borderSubtle)]} selectable={false} />
            <text fg={fade(t().text)} attributes={TextAttributes.BOLD} wrapMode="none">
              {app.ip("streak")}
              {c().streak} day streak
            </text>
            <text fg={fade(t().textMuted)} wrapMode="none">
              faithful in little, faithful in much
            </text>
          </box>
        </box>
      )}
    </Show>
  )
}
