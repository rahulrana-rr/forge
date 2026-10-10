import { describe, expect, it } from "vitest"
import { EXERCISES, muscleGroupOf, requireExercise } from "@/lib/exercises"
import type { Exercise, MovementPattern } from "@/lib/exercises/types"
import { generateWorkout } from "./generate"
import { intendedSlotOf, replaceExercise, replacementCandidates, type IntendedSlot } from "./replace"
import { libraryFrom } from "./library"
import { familyRoot, fitsFinisher, isMainCategory, lookupFor, matchesSlot } from "./selection"
import { RAMP_UP_NOTE } from "./duration"
import type { Workout, WorkoutExercise } from "./types"
import {
  completeAtTop,
  FIXTURE_BY_ID,
  FIXTURE_LIBRARY,
  makeInput,
  makeProfile,
  progressFromHistory,
  setupNoteViolation,
} from "./test-fixtures"

const lib = libraryFrom(FIXTURE_LIBRARY)

describe("replace", () => {
  const profile = makeProfile()
  const input = makeInput(profile)
  const workout = generateWorkout(input, lib)
  const primary = workout.exercises.find((e) => e.role === "primary_compound")!

  it("ranks candidates that share the muscle group or pattern, excluding what is in the workout", () => {
    const candidates = replacementCandidates(workout, primary.slotId, input, 5, lib)
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.length).toBeLessThanOrEqual(5)
    expect(candidates[0]!.score).toBeGreaterThanOrEqual(candidates[candidates.length - 1]!.score)
    for (const c of candidates) {
      expect(workout.exercises.some((e) => e.exerciseId === c.exerciseId)).toBe(false)
      expect(c.reason.length).toBeGreaterThan(0)
      const ex = FIXTURE_BY_ID.get(c.exerciseId)!
      expect(ex.category).not.toBe("warmup")
    }
    expect(candidates[0]!.exerciseId).toMatch(/press|push-up/)
    expect(replacementCandidates(workout, "missing", input, 5, lib)).toEqual([])
  })

  it("swaps the slot keeping slotId and set count and recomputes the estimate", () => {
    const next = replaceExercise(workout, primary.slotId, input, {}, lib)
    expect(next).not.toBeNull()
    const swapped = next!.exercises.find((e) => e.slotId === primary.slotId)!
    expect(swapped.exerciseId).not.toBe(primary.exerciseId)
    expect(swapped.sets).toBe(primary.sets)
    expect(swapped.role).toBe(primary.role)
    expect(swapped.replacedFromExerciseId).toBe(primary.exerciseId)
    expect(next!.exercises.length).toBe(workout.exercises.length)
    expect(typeof next!.estimatedMinutes).toBe("number")
    // Original is untouched.
    expect(workout.exercises.find((e) => e.slotId === primary.slotId)!.exerciseId).toBe(primary.exerciseId)
    // A second swap remembers the original.
    const again = replaceExercise(next!, primary.slotId, input, {}, lib)!
    expect(again.exercises.find((e) => e.slotId === primary.slotId)!.replacedFromExerciseId).toBe(primary.exerciseId)
  })

  it("manual picks must pass the profile filter and not duplicate the workout", () => {
    const ok = replaceExercise(workout, primary.slotId, input, { withExerciseId: "machine-chest-press" }, lib)
    expect(ok?.exercises.find((e) => e.slotId === primary.slotId)?.exerciseId).toBe("machine-chest-press")
    const dup = workout.exercises.find((e) => e.phase === "main" && e.slotId !== primary.slotId)!.exerciseId
    expect(replaceExercise(workout, primary.slotId, input, { withExerciseId: dup }, lib)).toBeNull()
    expect(replaceExercise(workout, primary.slotId, input, { withExerciseId: "warmup-bike" }, lib)).toBeNull()
    const limited = makeInput(makeProfile({ limitations: ["shoulder"] }))
    expect(replaceExercise(workout, primary.slotId, limited, { withExerciseId: "dumbbell-bench-press" }, lib)).toBeNull()
    expect(replaceExercise(workout, primary.slotId, input, { withExerciseId: "nope" }, lib)).toBeNull()
  })

  it("honours the exclude list and returns null when nothing remains", () => {
    const all = replacementCandidates(workout, primary.slotId, input, 50, lib).map((c) => c.exerciseId)
    expect(replaceExercise(workout, primary.slotId, input, { exclude: all }, lib)).toBeNull()
    const partial = replaceExercise(workout, primary.slotId, input, { exclude: [all[0]!] }, lib)
    expect(partial?.exercises.find((e) => e.slotId === primary.slotId)?.exerciseId).not.toBe(all[0])
  })

  it("replaces warm-up and cool-down items within their own class", () => {
    const cardio = workout.exercises.find((e) => e.phase === "warmup")!
    const swapped = replaceExercise(workout, cardio.slotId, input, {}, lib)
    expect(swapped?.exercises.find((e) => e.slotId === cardio.slotId)?.exerciseId.startsWith("warmup-")).toBe(true)
    const stretch = workout.exercises.find((e) => e.phase === "cooldown")!
    const stretched = replaceExercise(workout, stretch.slotId, input, {}, lib)
    const id = stretched?.exercises.find((e) => e.slotId === stretch.slotId)?.exerciseId
    expect(["stretching", "cooldown"]).toContain(FIXTURE_BY_ID.get(id!)?.category)
  })

  it("recomputes the recommended weight for the new exercise from history", () => {
    const lookup = (id: string) => FIXTURE_BY_ID.get(id)
    const first = generateWorkout(makeInput(profile, "2026-10-01"), lib) // Upper A
    const h1 = [completeAtTop(first, lookup, 50)]
    const second = generateWorkout(makeInput(profile, "2026-10-02", h1, progressFromHistory(h1)), lib) // Lower A
    const history = [completeAtTop(second, lookup, 50), ...h1]
    const withHistory = makeInput(profile, "2026-10-04", history, progressFromHistory(history))
    const w = generateWorkout(withHistory, lib) // Upper B
    // Coach round 1 (F11): a swap keeps the slot's job, so the machine press replaces a chest press.
    // This test used to swap the first main slot of a lower day (a squat) for the machine press,
    // which is the cross-body swap the coach rejected; that swap is now refused.
    const squat = second.exercises.find((e) => e.phase === "main" && FIXTURE_BY_ID.get(e.exerciseId)!.movementPattern === "squat")!
    expect(replaceExercise(second, squat.slotId, withHistory, { withExerciseId: "machine-chest-press" }, lib)).toBeNull()
    const slot = w.exercises.find((e) => {
      const x = FIXTURE_BY_ID.get(e.exerciseId)!
      return e.phase === "main" && e.role !== "finisher" && x.movementPattern === "horizontal_push" && x.id !== "machine-chest-press"
    })!
    const swapped = replaceExercise(w, slot.slotId, withHistory, { withExerciseId: "machine-chest-press" }, lib)
    expect(swapped).not.toBeNull()
    const machine = swapped?.exercises.find((e) => e.slotId === slot.slotId)
    const performedBefore = history.some((h) => h.exercises.some((e) => e.exerciseId === "machine-chest-press"))
    if (performedBefore) expect(machine?.recommendedWeightKg).not.toBeNull()
    else expect(machine?.recommendedWeightKg).toBeNull()
  })

  it("is deterministic", () => {
    const a = replaceExercise(workout, primary.slotId, input, {}, lib)
    const b = replaceExercise(workout, primary.slotId, input, {}, lib)
    expect(a).toEqual(b)
  })
})

describe("replace (library)", () => {
  it("swaps a finisher only for conditioning work, never a heavy lift or a steady-state block", () => {
    const heavy = ["power-clean", "hang-power-clean", "barbell-snatch", "barbell-clean-and-jerk", "turkish-get-up", "barbell-thruster", "dumbbell-thruster"]
    let checked = 0
    for (const experience of ["beginner", "advanced"] as const) {
      for (const date of ["2026-10-05", "2026-10-06", "2026-10-07"]) {
        const fatLoss = makeInput(makeProfile({ goal: "fat_loss", experience, trainingDaysPerWeek: 3 }), date)
        const w = generateWorkout(fatLoss)
        const finisher = w.exercises.find((e) => e.role === "finisher")
        if (!finisher) continue
        checked++
        const candidates = replacementCandidates(w, finisher.slotId, fatLoss, 500)
        expect(candidates.length).toBeGreaterThan(0)
        for (const c of candidates) {
          expect(fitsFinisher(requireExercise(c.exerciseId)), c.exerciseId).toBe(true)
          expect(heavy).not.toContain(c.exerciseId)
        }
        for (const id of [...heavy, "outdoor-walk"]) {
          expect(replaceExercise(w, finisher.slotId, fatLoss, { withExerciseId: id }), id).toBeNull()
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it("never offers a steady-state block for a bodyweight beginner's finisher, listed or picked by hand (R16)", () => {
    const steady = ["march-in-place", "jump-rope", "outdoor-walk", "outdoor-run"]
    const input = makeInput(makeProfile({ goal: "fat_loss", experience: "beginner", equipmentPreset: "bodyweight", trainingDaysPerWeek: 3 }), "2026-10-07")
    const w = generateWorkout(input)
    const finisher = w.exercises.find((e) => e.role === "finisher")!
    expect(steady).not.toContain(finisher.exerciseId)
    const candidates = replacementCandidates(w, finisher.slotId, input, 500)
    expect(candidates.length).toBeGreaterThan(0)
    for (const c of candidates) {
      expect(steady, c.exerciseId).not.toContain(c.exerciseId)
      expect(requireExercise(c.exerciseId).tags ?? [], c.exerciseId).not.toContain("steady_state")
    }
    for (const id of steady) expect(replaceExercise(w, finisher.slotId, input, { withExerciseId: id }), id).toBeNull()
  })

  it("adds the ramp-up note when a heavy lift lands in either compound slot", () => {
    const strength = makeInput(makeProfile({ goal: "strength", trainingDaysPerWeek: 3 }), "2026-10-07")
    const w = generateWorkout(strength)
    const secondary = w.exercises.find((e) => e.role === "secondary_compound")!
    const pick = replacementCandidates(w, secondary.slotId, strength, 500).find((c) => requireExercise(c.exerciseId).warmupRequired)
    expect(pick).toBeDefined()
    const swapped = replaceExercise(w, secondary.slotId, strength, { withExerciseId: pick!.exerciseId })!
    // Coach review F16/F02: the ramp-up sentence follows the swapped lift's load; a "find your
    // working weight" note builds up from light sets and replaces it.
    const rebuilt = swapped.exercises.find((e) => e.slotId === secondary.slotId)!
    expect(setupNoteViolation(rebuilt, requireExercise(rebuilt.exerciseId))).toBeNull()
    if (rebuilt.recommendedWeightKg === null || rebuilt.weightSource === "history") {
      expect(rebuilt.note?.includes(RAMP_UP_NOTE) || /^Find your working weight/.test(rebuilt.note ?? "")).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Coach round 1 (F11): a swap keeps the slot's job, checked against the real library.
// ---------------------------------------------------------------------------------------------

const PUSH: ReadonlySet<MovementPattern> = new Set<MovementPattern>(["horizontal_push", "vertical_push", "elbow_extension"])
const PULL: ReadonlySet<MovementPattern> = new Set<MovementPattern>(["horizontal_pull", "vertical_pull", "elbow_flexion"])

function mainSlot(id: string, slotId: string, role: WorkoutExercise["role"] = "accessory", extra: Partial<WorkoutExercise> = {}): WorkoutExercise {
  return {
    slotId, exerciseId: id, phase: "main", role, sets: 3, reps: [8, 12], durationSeconds: null, restSeconds: 90,
    tempo: null, rir: 2, recommendedWeightKg: null, weightSource: null, note: null, replacedFromExerciseId: null, ...extra,
  }
}

function workoutOf(slots: WorkoutExercise[]): Workout {
  return {
    id: "w", date: "2026-10-07", title: "Test", split: "upper", focus: ["chest"], goal: "muscle_gain", estimatedMinutes: 45,
    exercises: slots, generatedAt: "2026-10-07T07:00:00.000Z", seed: 1, engineVersion: 1,
  }
}

const real = (id: string): Exercise => requireExercise(id)
const advancedInput = makeInput(makeProfile({ experience: "advanced" }))

function candidatesFor(id: string, role: WorkoutExercise["role"] = "accessory"): Exercise[] {
  const w = workoutOf([mainSlot(id, "s", role)])
  return replacementCandidates(w, "s", advancedInput, 500).map((c) => real(c.exerciseId))
}

describe("replacements keep the slot's job (F11)", () => {
  const mains = EXERCISES.filter((e) => isMainCategory(e) && e.category !== "cardio" && e.movementPattern !== "conditioning" && e.movementPattern !== "locomotion")

  it("never crosses the push/pull line, never offers core or conditioning for a lift, never pads with shared secondaries", () => {
    let checked = 0
    for (const current of mains) {
      const push = PUSH.has(current.movementPattern)
      const pull = PULL.has(current.movementPattern)
      for (const c of candidatesFor(current.id)) {
        if (push) expect(PULL.has(c.movementPattern) || c.force === "pull", `${current.id} -> ${c.id}`).toBe(false)
        if (pull) expect(PUSH.has(c.movementPattern) || c.force === "push", `${current.id} -> ${c.id}`).toBe(false)
        if (current.category !== "core") expect(c.category, `${current.id} -> ${c.id}`).not.toBe("core")
        else expect(c.category, `${current.id} -> ${c.id}`).toBe("core")
        expect(["conditioning", "locomotion"], `${current.id} -> ${c.id}`).not.toContain(c.movementPattern)
        const related = muscleGroupOf(c) === muscleGroupOf(current) || c.movementPattern === current.movementPattern || current.alternativeExercises.includes(c.id)
        expect(related, `${current.id} -> ${c.id}`).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })

  it("a plank or a Copenhagen plank is never offered a deadlift or a kettlebell clean", () => {
    for (const id of ["plank", "copenhagen-plank"]) {
      const ids = candidatesFor(id).map((e) => e.id)
      expect(ids.length).toBeGreaterThan(0)
      for (const banned of ["conventional-deadlift", "kettlebell-clean", "dumbbell-snatch", "barbell-hip-thrust"]) expect(ids, id).not.toContain(banned)
    }
  })

  it("an isometric hold is not swapped for ballistic or heavy barbell work", () => {
    const options = candidatesFor("wall-sit")
    expect(options.length).toBeGreaterThan(0)
    for (const c of options) {
      expect(c.warmupRequired, c.id).toBe(false)
      expect(c.tags ?? [], c.id).not.toContain("explosive")
    }
  })

  it("lists same-movement swaps first and keeps abduction drills behind every hip-extension option", () => {
    const w = workoutOf([mainSlot("dumbbell-hip-thrust", "s", "isolation")])
    const ranked = replacementCandidates(w, "s", advancedInput, 500)
    const abduction = (id: string) => (real(id).tags ?? []).some((t) => t === "abduction" || t === "adduction")
    const firstDrill = ranked.findIndex((c) => abduction(c.exerciseId))
    const lastThrust = ranked.map((c) => !abduction(c.exerciseId) && real(c.exerciseId).movementPattern === "hip_extension").lastIndexOf(true)
    expect(lastThrust).toBeGreaterThanOrEqual(0)
    if (firstDrill >= 0) expect(firstDrill).toBeGreaterThan(lastThrust)
    for (const c of ranked) if (abduction(c.exerciseId)) expect(c.reason).not.toContain("Same movement pattern")
    // The equipment bonus only counts for a swap that still trains the same group.
    for (const c of ranked) if (c.reason.includes("Different equipment")) expect(c.reason).toContain("Same muscle group")
  })

  it("a swap never adds a second member of a family already in the session", () => {
    const w = workoutOf([mainSlot("barbell-bench-press", "a", "primary_compound"), mainSlot("incline-dumbbell-press", "b")])
    const ids = replacementCandidates(w, "b", advancedInput, 500).map((c) => c.exerciseId)
    expect(ids.length).toBeGreaterThan(0)
    const lookup = lookupFor(EXERCISES)
    for (const id of ids) expect(familyRoot(real(id), lookup), id).not.toBe("barbell-bench-press")
    expect(ids).not.toContain("dumbbell-bench-press") // lists the bench press as an alternative and vice versa
  })

  describe("a stand-in can be swapped back to the lift the slot was planned for", () => {
    const intended: IntendedSlot = { patterns: ["horizontal_pull"], groups: ["back"], mechanics: "compound", role: "secondary_compound" }
    const standIn = { ...mainSlot("face-pull", "s"), intendedSlot: intended } as WorkoutExercise
    const w = workoutOf([mainSlot("lat-pulldown", "p", "primary_compound"), standIn])
    const input = makeInput(makeProfile())
    const spec = { key: "intended", role: "secondary_compound" as const, patterns: intended.patterns, groups: intended.groups, mechanics: intended.mechanics, priority: 0, kind: "upper_pull" as const }

    it("lists the best planned-slot lifts first, then the stand-in's own swaps", () => {
      const ranked = replacementCandidates(w, "s", input, 6)
      expect(ranked.length).toBe(6)
      const planned = ranked.filter((c) => [0, 1, 2].some((level) => matchesSlot(real(c.exerciseId), spec, level as 0 | 1 | 2)))
      expect(planned.length).toBeGreaterThanOrEqual(1)
      expect(planned.length).toBeLessThanOrEqual(3)
      expect(ranked[0]!.reason).toContain("Planned horizontal pull for this slot")
      expect(muscleGroupOf(real(ranked[0]!.exerciseId))).toBe("back")
      expect(ranked.some((c) => muscleGroupOf(real(c.exerciseId)) === "shoulders")).toBe(true)
      // Empty history: the back has its whole weekly budget, so bringing the row back is not over it.
      // (Since F06 a stand-in comes from equipment, limitations or exclusions, never from the cap.)
      for (const c of ranked) {
        expect(c.reason).not.toContain("over this week's volume target")
        expect(c.overCap).toBeUndefined()
      }
    })

    it("flags planned-slot lifts as over the weekly target only when the group's week is spent", () => {
      const backDay = workoutOf([
        mainSlot("seated-cable-row", "h1", "primary_compound", { sets: 10 }),
        mainSlot("lat-pulldown", "h2", "secondary_compound", { sets: 10 }),
      ])
      const done = completeAtTop({ ...backDay, id: "back-day", date: "2026-10-05" }, (id) => real(id), 40)
      const history = [done]
      const capped = makeInput(makeProfile(), "2026-10-07", history, progressFromHistory(history))
      const ranked = replacementCandidates(w, "s", capped, 6)
      expect(ranked[0]!.reason).toContain("over this week's volume target")
      expect(ranked[0]!.overCap).toBe(true)
      expect(muscleGroupOf(real(ranked[0]!.exerciseId))).toBe("back")
      // The automatic swap never takes an over-cap planned lift.
      const auto = replaceExercise(w, "s", capped)!
      expect(muscleGroupOf(real(auto.exercises.find((e) => e.slotId === "s")!.exerciseId))).toBe("shoulders")
    })

    it("the automatic swap stays within the cap; a manual pick restores the slot's role and clears the stand-in", () => {
      const auto = replaceExercise(w, "s", input)!
      const autoSlot = auto.exercises.find((e) => e.slotId === "s")!
      expect(muscleGroupOf(real(autoSlot.exerciseId))).toBe("shoulders")
      expect(intendedSlotOf(autoSlot)).toEqual(intended)
      const manual = replaceExercise(w, "s", input, { withExerciseId: "seated-cable-row" })!
      const restored = manual.exercises.find((e) => e.slotId === "s")!
      expect(restored.role).toBe("secondary_compound")
      expect(intendedSlotOf(restored)).toBeNull()
      // Without a planned slot nothing changes: the face pull's own list has no planned flag.
      const plain = workoutOf([mainSlot("lat-pulldown", "p", "primary_compound"), mainSlot("face-pull", "s")])
      for (const c of replacementCandidates(plain, "s", input, 50)) expect(c.reason).not.toContain("over this week's volume target")
    })
  })
})
