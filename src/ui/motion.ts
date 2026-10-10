import { RGBA } from "@opentui/core"
import { createSignal, onCleanup } from "solid-js"

/** Easing curves, each mapping 0 → 0 and 1 → 1. */
export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutSine: (t: number) => 0.5 - Math.cos(Math.PI * t) / 2,
  outBack: (t: number) => {
    const c = 1.4
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2
  },
}

export type Ease = (t: number) => number

export interface Anim {
  start: number
  end: number
}

export interface MotionOptions {
  now: () => number
  reduced: () => boolean
  /** Schedules the next frame; returns a cancel function. Defaults to ~60 fps timers. */
  schedule?: (cb: () => void) => () => void
}

/**
 * One clock for every animation. `time` only advances while an animation is running, so an
 * idle Selah renders nothing and costs nothing. Under reduced motion no frame is ever
 * scheduled and every value reads as its final value.
 */
export function createMotion(opts: MotionOptions) {
  const schedule = opts.schedule ?? ((cb: () => void) => {
    const id = setTimeout(cb, 16)
    return () => clearTimeout(id)
  })
  const [time, setTime] = createSignal(opts.now())
  const [running, setRunning] = createSignal(false)
  const active = new Set<Anim>()
  let cancel: (() => void) | undefined

  const tick = () => {
    cancel = undefined
    const t = opts.now()
    setTime(t)
    for (const a of active) if (t >= a.end) active.delete(a)
    if (active.size) cancel = schedule(tick)
    else setRunning(false)
  }

  onCleanup(() => cancel?.())

  function start(duration: number, delay = 0): Anim {
    const s = opts.now() + delay
    const a = { start: s, end: s + duration }
    if (opts.reduced()) return a
    active.add(a)
    setTime(opts.now())
    setRunning(true)
    if (!cancel) cancel = schedule(tick)
    return a
  }

  function progress(a: Anim | undefined, curve: Ease = ease.linear): number {
    if (!a || opts.reduced()) return 1
    const t = time()
    if (t <= a.start) return curve(0)
    if (t >= a.end) return 1
    return curve((t - a.start) / (a.end - a.start))
  }

  return {
    time,
    running,
    start,
    progress,
    value: (a: Anim | undefined, from: number, to: number, curve: Ease = ease.linear) => from + (to - from) * progress(a, curve),
    done: (a: Anim | undefined) => !a || opts.reduced() || time() >= a.end,
    reduced: opts.reduced,
  }
}

export type Motion = ReturnType<typeof createMotion>

export function mixColor(a: RGBA, b: RGBA, t: number): RGBA {
  const k = Math.max(0, Math.min(1, t))
  const m = (x: number, y: number) => Math.round((x + (y - x) * k) * 255)
  return RGBA.fromInts(m(a.r, b.r), m(a.g, b.g), m(a.b, b.b), Math.round((a.a + (b.a - a.a) * k) * 255))
}

/** Reduced motion: asked for in config, by SELAH_REDUCED_MOTION, or implied by NO_COLOR. */
export function prefersReducedMotion(config: { motion?: string }): boolean {
  if (config.motion === "reduced") return true
  if (process.env.SELAH_REDUCED_MOTION === "1" || "NO_COLOR" in process.env) return true
  return false
}
