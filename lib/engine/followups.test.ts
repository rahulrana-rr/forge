/**
 * Rules added after the first browser walkthrough, checked against the real library.
 */
import { describe, expect, it } from "vitest"

import { getExercise, muscleGroupOf } from "@/lib/exercises"
import type { Goal } from "@/lib/exercises/types"
import type { CompletedWorkout, TrainingDays } from "@/lib/domain/types"
import { generateWorkout, replaceExercise, type Workout } from "./index"
import { recommendWeight } from "./progression"
import { isHeavyLowerBarbell } from "./selection"
import { completeAtTop, makeInput, makeProfile, progressFromHistory } from "./test-fixtures"

const LOWER = new Set(["quads", "hamstrings", "glutes", "calves"])

function main(w: Workout) {
  return w.exercises.filter((e) => e.phase === "main")
}

/** Simulate `days` consecutive training days for a profile, completing every set at the top. */
function simulate(goal: Goal, trainingDaysPerWeek: TrainingDays, days: number, id = "sim"): Workout[] {
  const profile = makeProfile({ id: `${id}-${goal}-${trainingDaysPerWeek}`, goal, trainingDaysPerWeek, gender: "male", weightKg: 82 })
  const history: CompletedWorkout[] = []
  const out: Workout[] = []
  for (let d = 0; d < days; d++) {
    const date = `2026-10-${String(1 + d * 2).padStart(2, "0")}`
    const w = generateWorkout(makeInput(profile, date, [...history].reverse(), progressFromHistory(history)))
    out.push(w)
    history.push(completeAtTop(w, getExercise, 60))
  }
  return out
}

describe("one heavy barbell squat or floor pull per session", () => {
  for (const goal of ["muscle_gain", "fat_loss", "general_fitness", "endurance"] as Goal[]) {
    it(`${goal}: never pairs two heavy lower barbell lifts`, () => {
      // Many profile ids: the pairing only shows up for some seeds (about 1 lower day in 40 before the rule).
      for (let i = 0; i < 25; i++) for (const days of [3, 4, 5] as TrainingDays[]) {
        for (const w of simulate(goal, days, 6, `p${i}`)) {
          const heavy = main(w).filter((e) => {
            const ex = getExercise(e.exerciseId)
            return ex ? isHeavyLowerBarbell(ex) : false
          })
          expect(heavy.length, `${w.title} ${w.date}: ${heavy.map((h) => h.exerciseId).join(", ")}`).toBeLessThanOrEqual(1)
        }
      }
    })
  }
})

describe("upper-day finishers", () => {
  it("do not load the legs when the day trained none", () => {
    for (const goal of ["fat_loss", "general_fitness", "endurance"] as Goal[]) {
      for (const w of simulate(goal, 4, 8)) {
        const m = main(w)
        const finishers = m.filter((e) => e.role === "finisher")
        const trainedLower = m.some((e) => e.role !== "finisher" && LOWER.has(muscleGroupOf(getExercise(e.exerciseId)!)))
        if (trainedLower) continue
        for (const f of finishers) {
          const ex = getExercise(f.exerciseId)!
          expect(ex.equipment.includes("sled"), `${w.title}: ${ex.id}`).toBe(false)
        }
      }
    }
  })
})

describe("swipe-left replacement", () => {
  it("swaps a barbell bench press for a dumbbell bench press when dumbbells are available", () => {
    const profile = makeProfile({ goal: "muscle_gain", trainingDaysPerWeek: 4 })
    for (let seed = 1; seed <= 6; seed++) {
      const input = makeInput(profile, "2026-10-07", [], {}, seed)
      const w = generateWorkout(input)
      const bench = w.exercises.find((e) => e.exerciseId === "barbell-bench-press")
      if (!bench) continue
      const swapped = replaceExercise(w, bench.slotId, input)
      const next = swapped?.exercises.find((e) => e.slotId === bench.slotId)
      expect(next?.exerciseId).toBe("dumbbell-bench-press")
      expect(next?.role).toBe(bench.role)
      return
    }
    throw new Error("no generated workout contained a barbell bench press")
  })
})

describe("starting loads", () => {
  it("label first-session loads as estimates and switch to history after a logged session", () => {
    const profile = makeProfile({ goal: "muscle_gain", trainingDaysPerWeek: 4, gender: "male", weightKg: 82 })
    const first = generateWorkout(makeInput(profile, "2026-10-01"))
    const estimated = main(first).filter((e) => e.weightSource === "estimate")
    expect(estimated.length).toBeGreaterThan(0)
    for (const e of estimated) expect(e.recommendedWeightKg).toBeGreaterThan(0)
    for (const e of main(first)) if (e.recommendedWeightKg === null) expect(e.weightSource ?? null).toBeNull()

    const history = [completeAtTop(first, getExercise, 50)]
    const again = generateWorkout(makeInput(profile, "2026-10-08", history, progressFromHistory(history)))
    const repeated = main(again).filter((e) => history[0].exercises.some((x) => x.exerciseId === e.exerciseId && x.phase === "main"))
    for (const e of repeated) {
      if (e.recommendedWeightKg !== null && getExercise(e.exerciseId)?.loadType === "external") expect(e.weightSource).toBe("history")
    }
  })
})

describe("progression notes", () => {
  it("speak the user's units", () => {
    const bench = getExercise("barbell-bench-press")!
    const last = { sets: [1, 2, 3].map((n) => ({ setNumber: n, weightKg: 61.235, reps: 12, completed: true })), prescribedReps: [8, 12] as [number, number], date: "2026-10-01" }
    const lb = recommendWeight(bench, [8, 12], last, "lb")
    expect(lb.note).toMatch(/lb/)
    expect(lb.note).not.toMatch(/kg/)
    const kg = recommendWeight(bench, [8, 12], last, "kg")
    expect(kg.note).toMatch(/kg/)
  })
})
