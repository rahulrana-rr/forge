import { describe, expect, it } from "vitest"
import { createRng, defaultSeed, hashString, mulberry32 } from "./random"

describe("random", () => {
  it("hashString is stable and 32-bit", () => {
    expect(hashString("abc")).toBe(hashString("abc"))
    expect(hashString("abc")).not.toBe(hashString("abd"))
    expect(hashString("")).toBeGreaterThanOrEqual(0)
    expect(hashString("x".repeat(100))).toBeLessThan(2 ** 32)
  })

  it("mulberry32 yields the same sequence for the same seed in [0,1)", () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 50; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })

  it("rng helpers are deterministic and well-formed", () => {
    const a = createRng(7)
    const b = createRng(7)
    expect(a.int(10)).toBe(b.int(10))
    expect(a.int(1)).toBe(0)
    expect(a.pick(["x", "y", "z"])).toBe(b.pick(["x", "y", "z"]))
    expect(a.shuffle([1, 2, 3, 4, 5])).toEqual(b.shuffle([1, 2, 3, 4, 5]))
    expect(a.shuffle([1, 2, 3]).sort()).toEqual(b.shuffle([1, 2, 3]).sort())
    const id = a.uuid()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(id).toBe(b.uuid())
    expect(() => a.pick([])).toThrow()
  })

  it("defaultSeed depends on profile and date", () => {
    expect(defaultSeed("p1", "2026-10-07")).toBe(defaultSeed("p1", "2026-10-07"))
    expect(defaultSeed("p1", "2026-10-07")).not.toBe(defaultSeed("p1", "2026-10-08"))
    expect(defaultSeed("p1", "2026-10-07")).not.toBe(defaultSeed("p2", "2026-10-07"))
  })
})
