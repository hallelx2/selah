import { RGBA, TextAttributes } from "@opentui/core"
import { createSignal, For, onCleanup, onMount } from "solid-js"
import { tint } from "../../theme"
import { mixColor } from "../motion"
import { useApp } from "../state"

/**
 * Block letters in opencode's logo style: `_` is a shadowed space, `^` a shadowed upper half,
 * `~` a shadow-only upper half.
 */
export const LOGO = ["█▀▀▀ █▀▀▀ █    █▀▀█ █  █", "^^^█ █^^^ █___ █^^█ █^^█", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀  ▀"]
const WIDTH = LOGO[0]!.length

const BEAM_EVERY = 7_000
const BEAM_MS = 1_500
const BEAM_SIGMA = 2.6

/**
 * The logo, coloured along a primary → accent gradient. Every few seconds a soft beam of
 * light crosses it ("let there be light"); between beams nothing animates and nothing renders.
 */
export function Logo(props: { beam?: boolean }) {
  const app = useApp()
  const t = () => app.theme()
  const [beam, setBeam] = createSignal(app.motion.start(0))

  onMount(() => {
    if (props.beam === false || app.motion.reduced()) return
    const first = setTimeout(() => setBeam(app.motion.start(BEAM_MS)), 700)
    const every = setInterval(() => setBeam(app.motion.start(BEAM_MS)), BEAM_EVERY)
    onCleanup(() => {
      clearTimeout(first)
      clearInterval(every)
    })
  })

  const solid = () => (t().background.a === 0 ? RGBA.fromHex("#000000") : t().background)
  const base = (x: number) => mixColor(t().primary, t().accent, x / (WIDTH - 1))
  /** 0..1: how much of the beam falls on column x right now. */
  const light = (x: number) => {
    if (app.motion.done(beam())) return 0
    const center = -8 + app.motion.progress(beam()) * (WIDTH + 16)
    return Math.exp(-((x - center) ** 2) / (2 * BEAM_SIGMA ** 2))
  }
  const colorAt = (x: number) => {
    const l = light(x)
    return l > 0.01 ? mixColor(base(x), t().text, l * 0.85) : base(x)
  }

  return (
    <box flexShrink={0}>
      <For each={LOGO}>
        {(line) => (
          <text selectable={false} wrapMode="none">
            <For each={Array.from(line)}>
              {(ch, x) => {
                const fg = () => colorAt(x())
                const shadow = () => tint(solid(), fg(), 0.28)
                const attributes = TextAttributes.BOLD
                if (ch === "_") return <span style={{ fg: fg(), bg: shadow(), attributes }}> </span>
                if (ch === "^") return <span style={{ fg: fg(), bg: shadow(), attributes }}>▀</span>
                if (ch === "~") return <span style={{ fg: shadow(), attributes }}>▀</span>
                return <span style={{ fg: fg(), attributes }}>{ch}</span>
              }}
            </For>
          </text>
        )}
      </For>
    </box>
  )
}
