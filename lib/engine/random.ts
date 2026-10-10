/**
 * Deterministic pseudo-randomness for the engine.
 *
 * The engine never touches Math.random(); every choice is driven by a seeded
 * mulberry32 stream so that the same (input, seed) yields the same workout.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform integer in [0, maxExclusive). Returns 0 when maxExclusive <= 1. */
  int(maxExclusive: number): number
  /** Deterministic pick from a non-empty array. */
  pick<T>(items: readonly T[]): T
  /** Fisher–Yates shuffle into a new array. */
  shuffle<T>(items: readonly T[]): T[]
  /** RFC 4122 shaped id built from the stream (deterministic, not cryptographic). */
  uuid(): string
}

/** 32-bit FNV-1a hash of a string. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32: small, fast, good-enough PRNG for programming decisions. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed)
  const rng: Rng = {
    next,
    int(maxExclusive) {
      if (maxExclusive <= 1) return 0
      return Math.floor(next() * maxExclusive)
    },
    pick(items) {
      if (items.length === 0) throw new Error("Rng.pick on empty array")
      return items[rng.int(items.length)] as (typeof items)[number]
    },
    shuffle(items) {
      const out = items.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = rng.int(i + 1)
        const tmp = out[i] as (typeof out)[number]
        out[i] = out[j] as (typeof out)[number]
        out[j] = tmp
      }
      return out
    },
    uuid() {
      const bytes: number[] = []
      for (let i = 0; i < 16; i++) bytes.push(Math.floor(next() * 256))
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
      const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("")
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    },
  }
  return rng
}

/** Default seed: stable per profile and calendar day. */
export function defaultSeed(profileId: string, date: string): number {
  return hashString(`${profileId}|${date}`)
}
