import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { ease, createMotion, mixColor } from "../src/ui/motion"
import { RGBA } from "@opentui/core"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function rig(reduced = false) {
  let now = 1_000
  let frames = 0
  const m = createRoot(() =>
    createMotion({
      now: () => now,
      reduced: () => reduced,
      schedule: (cb) => {
        frames++
        const id = setTimeout(cb, 1)
        return () => clearTimeout(id)
      },
    }),
  )
  return { m, advance: (ms: number) => (now += ms), frames: () => frames }
}

describe("easing", () => {
  test("every curve starts at 0 and ends at 1", () => {
    for (const [name, f] of Object.entries(ease)) {
      expect([name, f(0)]).toEqual([name, 0])
      expect([name, Math.round(f(1) * 1e9) / 1e9]).toEqual([name, 1])
    }
  })
  test("outExpo is front-loaded, inOutSine symmetric", () => {
    expect(ease.outExpo(0.2)).toBeGreaterThan(0.7)
    expect(ease.inOutSine(0.5)).toBeCloseTo(0.5)
  })
})

describe("createMotion", () => {
  test("a tween follows its curve and lands exactly on its target", async () => {
    const r = rig()
    const a = r.m.start(400)
    expect(r.m.value(a, 10, 20)).toBe(10)
    r.advance(200)
    await wait(5)
    expect(r.m.value(a, 10, 20)).toBeCloseTo(15)
    expect(r.m.value(a, 10, 20, ease.outExpo)).toBeGreaterThan(19)
    r.advance(1_000)
    await wait(5)
    expect(r.m.value(a, 10, 20)).toBe(20)
    expect(r.m.done(a)).toBe(true)
  })

  test("reduced motion makes every value final immediately", () => {
    const r = rig(true)
    const a = r.m.start(10_000)
    expect(r.m.value(a, 0, 100)).toBe(100)
    expect(r.m.progress(a)).toBe(1)
    expect(r.m.done(a)).toBe(true)
  })

  test("the ticker stops once nothing is animating", async () => {
    const r = rig()
    const a = r.m.start(50)
    await wait(5)
    expect(r.m.running()).toBe(true)
    r.advance(100)
    await wait(10)
    expect(r.m.done(a)).toBe(true)
    expect(r.m.running()).toBe(false)
    const before = r.frames()
    await wait(20)
    expect(r.frames()).toBe(before)
  })

  test("no ticker at all under reduced motion", async () => {
    const r = rig(true)
    r.m.start(1_000)
    await wait(10)
    expect(r.frames()).toBe(0)
  })
})

test("mixColor interpolates channels", () => {
  const c = mixColor(RGBA.fromHex("#000000"), RGBA.fromHex("#ffffff"), 0.5)
  expect(Math.round(c.r * 255)).toBe(128)
})
