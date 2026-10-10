import { describe, expect, it } from "vitest"

import { recommendWeight } from "@/lib/engine/progression"
import { FIXTURE_BY_ID } from "@/lib/engine/test-fixtures"
import type { WorkoutExercise } from "@/lib/engine/types"
import { requireExercise } from "@/lib/exercises"
import { loadKindOf } from "@/lib/engine/progression"
import { loadStep } from "@/lib/units"
import {
  asksForRir,
  buildDefaultSets,
  defaultRepsFor,
  formatPrescription,
  loadKindFor,
  perSideLabel,
  spokenPrescription,
  spokenSeconds,
} from "./prescription"

const bench = FIXTURE_BY_ID.get("barbell-bench-press")!
const squat = FIXTURE_BY_ID.get("barbell-back-squat")!
const plank = FIXTURE_BY_ID.get("plank")!

function slot(patch: Partial<WorkoutExercise> = {}): WorkoutExercise {
  return {
    slotId: "s1",
    exerciseId: bench.id,
    phase: "main",
    role: "primary_compound",
    sets: 3,
    reps: [6, 10],
    durationSeconds: null,
    restSeconds: 120,
    tempo: null,
    rir: 2,
    recommendedWeightKg: 60,
    weightSource: "history",
    note: null,
    replacedFromExerciseId: null,
    ...patch,
  }
}

describe("defaultRepsFor", () => {
  it("assumes the bottom of the rep range", () => {
    expect(defaultRepsFor(slot({ reps: [6, 10] }))).toBe(6)
    expect(defaultRepsFor(slot({ reps: [5, 5] }))).toBe(5)
  })

  it("is null for timed work and slots without a range", () => {
    expect(defaultRepsFor(slot({ reps: null, durationSeconds: 45 }))).toBeNull()
    expect(defaultRepsFor(slot({ reps: null, durationSeconds: null }))).toBeNull()
  })
})

describe("buildDefaultSets", () => {
  it("records each prescribed set at the recommended load and the bottom of the range", () => {
    const sets = buildDefaultSets(slot(), bench)
    expect(sets).toHaveLength(3)
    for (const [i, s] of sets.entries()) {
      expect(s).toEqual({ setNumber: i + 1, weightKg: 60, reps: 6, durationSeconds: null, completed: true })
    }
  })

  it("records timed work by duration", () => {
    const sets = buildDefaultSets(slot({ exerciseId: plank.id, reps: null, durationSeconds: 45, recommendedWeightKg: null }), plank)
    expect(sets.every((s) => s.reps === null && s.durationSeconds === 45 && s.weightKg === null)).toBe(true)
  })

  it("keeps explicit overrides", () => {
    const sets = buildDefaultSets(slot(), bench, { reps: 10, weightKg: 62.5 })
    expect(sets.every((s) => s.reps === 10 && s.weightKg === 62.5)).toBe(true)
  })

  it("holds the load when the user only swipes: no automatic +step every session", () => {
    // Regression: swipe-logged sets used to claim the top of the range, so progression added a
    // load step every session regardless of what was lifted.
    for (const exercise of [bench, squat]) {
      let weight = 60
      for (let session = 0; session < 6; session++) {
        const s = slot({ exerciseId: exercise.id, recommendedWeightKg: weight })
        const rec = recommendWeight(
          exercise,
          s.reps,
          { date: "2026-10-01", prescribedReps: s.reps, sets: buildDefaultSets(s, exercise) },
          "kg",
        )
        expect(rec.weightKg).toBe(weight)
        expect(rec.note ?? "").not.toMatch(/top of the range/)
        weight = rec.weightKg ?? weight
      }
    }
  })

  it("still progresses once the user logs the top of the range", () => {
    const s = slot()
    const rec = recommendWeight(
      bench,
      s.reps,
      { date: "2026-10-01", prescribedReps: s.reps, sets: buildDefaultSets(s, bench, { reps: 10 }) },
      "kg",
    )
    expect(rec.weightKg).toBeGreaterThan(60)
  })
})

describe("spoken formats", () => {
  it("reads a prescription without symbols", () => {
    expect(spokenPrescription(slot({ sets: 3, reps: [6, 10] }))).toBe("3 sets of 6 to 10 reps")
    expect(spokenPrescription(slot({ sets: 1, reps: [5, 5] }))).toBe("1 set of 5 reps")
    expect(spokenPrescription(slot({ sets: 2, reps: null, durationSeconds: 90 }))).toBe("2 sets of 1 minute 30 seconds")
    expect(spokenPrescription(slot({ sets: 4, reps: null, durationSeconds: null }))).toBe("4 sets")
  })

  it("reads seconds", () => {
    expect(spokenSeconds(1)).toBe("1 second")
    expect(spokenSeconds(45)).toBe("45 seconds")
    expect(spokenSeconds(120)).toBe("2 minutes")
    expect(spokenSeconds(61)).toBe("1 minute 1 second")
  })
})

describe("load steps follow the engine (F14)", () => {
  it("steps kettlebells to the next standard bell, like the engine", () => {
    for (const id of ["kettlebell-swing", "kettlebell-deadlift", "goblet-squat", "dumbbell-bench-press", "barbell-back-squat", "lat-pulldown"]) {
      const ex = requireExercise(id)
      expect(loadKindFor(ex), id).toBe(loadKindOf(ex))
    }
    expect(loadStep("kg", loadKindFor(requireExercise("kettlebell-swing")))).toBe(4)
    expect(loadStep("lb", loadKindFor(requireExercise("kettlebell-swing")))).toBe(5)
  })
})

describe("one-tap reps in reserve (F14)", () => {
  it("asks on a starting estimate, and on a set logged at the top of the range", () => {
    const estimate = slot({ weightSource: "estimate", reps: [8, 12] })
    expect(asksForRir(estimate, true, false, 8)).toBe(true)
    const history = slot({ weightSource: "history", reps: [8, 12] })
    expect(asksForRir(history, true, false, 10)).toBe(false)
    expect(asksForRir(history, true, false, 12)).toBe(true)
    // Not for bodyweight, timed or unranged work.
    expect(asksForRir(estimate, false, false, 12)).toBe(false)
    expect(asksForRir(estimate, true, true, null)).toBe(false)
    expect(asksForRir(slot({ reps: null, durationSeconds: 30 }), true, false, null)).toBe(false)
  })
})

describe("unilateral targets read per leg or per side (F29)", () => {
  it("labels lower-body unilateral work per leg and the rest per side", () => {
    expect(perSideLabel(requireExercise("bulgarian-split-squat"))).toBe("per leg")
    expect(perSideLabel(requireExercise("single-arm-dumbbell-row"))).toBe("per side")
    expect(perSideLabel(requireExercise("barbell-back-squat"))).toBeNull()
    expect(perSideLabel(undefined)).toBeNull()
    const split = requireExercise("bulgarian-split-squat")
    expect(formatPrescription(slot({ sets: 3, reps: [8, 12] }), split)).toBe("3 × 8–12 per leg")
    expect(formatPrescription(slot({ sets: 3, reps: [6, 6] }))).toBe("3 × 6")
    expect(spokenPrescription(slot({ sets: 3, reps: [10, 10] }), split)).toBe("3 sets of 10 reps per leg")
  })
})
