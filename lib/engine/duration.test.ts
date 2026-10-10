import { describe, expect, it } from "vitest"
import { requireExercise } from "@/lib/exercises"
import type { WorkoutExercise } from "./types"
import {
  estimateSlotSeconds,
  estimateWorkoutSeconds,
  estimateWorkSeconds,
  FEEDER_SET_SECONDS,
  FIT_CEILING,
  HEAVY_BUILD_UP_SECONDS,
  fitToDuration,
  needsRampUp,
  RAMP_UP_SECONDS,
  rampUpSeconds,
  SECONDS_PER_REP,
  secondsPerRep,
  tempoSecondsPerRep,
  TRANSITION_SECONDS,
  type FittableSlot,
} from "./duration"
import { restCeiling } from "./prescriptions"
import { libraryFrom } from "./library"
import { FIXTURE_BY_ID, FIXTURE_LIBRARY } from "./test-fixtures"

const lib = libraryFrom(FIXTURE_LIBRARY)

function slot(overrides: Partial<WorkoutExercise>): WorkoutExercise {
  return {
    slotId: "s",
    exerciseId: "dumbbell-bench-press",
    phase: "main",
    role: "accessory",
    sets: 3,
    reps: [8, 12],
    durationSeconds: null,
    restSeconds: 60,
    tempo: null,
    rir: 2,
    // A planned load: a card with no load (null) also budgets the lifter's build-up sets (R04/R10).
    recommendedWeightKg: 60,
    note: null,
    replacedFromExerciseId: null,
    ...overrides,
  }
}

describe("duration", () => {
  it("estimates reps × 3s plus rest between sets and a transition", () => {
    const s = slot({})
    // 3 sets × 10 reps × 3s = 90, rest 2 × 60 = 120, transition 45
    expect(estimateSlotSeconds(s, FIXTURE_BY_ID.get("dumbbell-bench-press"))).toBe(90 + 120 + TRANSITION_SECONDS)
    const timed = slot({ exerciseId: "plank", reps: null, durationSeconds: 45, sets: 2, restSeconds: 30 })
    expect(estimateSlotSeconds(timed, FIXTURE_BY_ID.get("plank"))).toBe(90 + 30 + TRANSITION_SECONDS)
    const uni = slot({ exerciseId: "bulgarian-split-squat" })
    expect(estimateSlotSeconds(uni, FIXTURE_BY_ID.get("bulgarian-split-squat"))).toBe(180 + 120 + TRANSITION_SECONDS)
    const ramp = slot({ exerciseId: "barbell-bench-press", role: "primary_compound" })
    expect(estimateSlotSeconds(ramp, FIXTURE_BY_ID.get("barbell-bench-press"))).toBe(90 + 120 + TRANSITION_SECONDS + 120)
    // A heavy lift in the secondary slot gets its ramp-up sets too.
    const secondary = slot({ exerciseId: "barbell-bench-press", role: "secondary_compound" })
    expect(estimateSlotSeconds(secondary, FIXTURE_BY_ID.get("barbell-bench-press"))).toBe(90 + 120 + TRANSITION_SECONDS + RAMP_UP_SECONDS)
    // Coach review F16: ramp time is budgeted for every heavy (warmupRequired) lift, not only the
    // compound slots; outside them it is one lighter feeder set.
    const accessory = slot({ exerciseId: "barbell-bench-press", role: "accessory" })
    expect(estimateSlotSeconds(accessory, FIXTURE_BY_ID.get("barbell-bench-press"))).toBe(90 + 120 + TRANSITION_SECONDS + FEEDER_SET_SECONDS)
    expect(estimateWorkoutSeconds([s, timed], lib)).toBe(255 + 165)
  })

  it("charges the prescribed tempo per rep (coach review F16)", () => {
    // 3 × 10 at 3-0-1-1 is 150 s of work, not 90.
    const s = slot({ tempo: "3-0-1-1", reps: [10, 10] })
    expect(estimateSlotSeconds(s, FIXTURE_BY_ID.get("dumbbell-bench-press"))).toBe(150 + 120 + TRANSITION_SECONDS)
    expect(tempoSecondsPerRep("3-0-1-1")).toBe(5)
    expect(tempoSecondsPerRep("2-1-X-0")).toBe(4)
    expect(tempoSecondsPerRep("1-0-1-0")).toBe(SECONDS_PER_REP)
    expect(tempoSecondsPerRep("slow")).toBeNull()
    expect(tempoSecondsPerRep(null)).toBeNull()
    // Unilateral work still counts both sides; an exercise's own seconds per rep wins over tempo.
    const uni = slot({ exerciseId: "bulgarian-split-squat", tempo: "2-0-1-1" })
    expect(estimateSlotSeconds(uni, FIXTURE_BY_ID.get("bulgarian-split-squat"))).toBe(3 * 10 * 4 * 2 + 120 + TRANSITION_SECONDS)
    const tgu = requireExercise("turkish-get-up")
    expect(secondsPerRep(tgu, "1-0-1-0")).toBe(tgu.secondsPerRep)
    // Work without a tempo field (a bare prescription) falls back to the exercise's own tempo.
    const rdl = requireExercise("romanian-deadlift") // 3-0-1-0
    const work = { sets: 3, reps: [8, 8] as [number, number], durationSeconds: null, restSeconds: 90 }
    expect(estimateWorkSeconds(work, "main", "accessory", { ...rdl, warmupRequired: false })).toBe(3 * 8 * 4 + 180 + TRANSITION_SECONDS)
  })

  it("budgets ramp-up only when the working load leaves room for lighter sets", () => {
    const benchEx = requireExercise("barbell-bench-press")
    expect(needsRampUp("primary_compound", benchEx, 20)).toBe(false) // the empty bar
    expect(needsRampUp("primary_compound", benchEx, 60)).toBe(true)
    expect(needsRampUp("primary_compound", benchEx)).toBe(true) // load unknown: budget it
    const incline = requireExercise("incline-dumbbell-press")
    expect(rampUpSeconds("secondary_compound", incline, 4)).toBe(0)
    expect(rampUpSeconds("secondary_compound", incline, 8)).toBe(RAMP_UP_SECONDS)
    expect(rampUpSeconds("accessory", incline, 8)).toBe(FEEDER_SET_SECONDS)
    // A machine's lightest load is unknown, so its ramp stays.
    expect(rampUpSeconds("primary_compound", requireExercise("leg-press"), 20)).toBe(RAMP_UP_SECONDS)
    expect(rampUpSeconds("finisher", benchEx, 60)).toBe(0)
    const light = slot({ exerciseId: "barbell-bench-press", role: "primary_compound", recommendedWeightKg: 20 })
    expect(estimateSlotSeconds(light, FIXTURE_BY_ID.get("barbell-bench-press"))).toBe(90 + 120 + TRANSITION_SECONDS)
  })

  it("uses the exercise's own seconds per rep for complexes and skill lifts", () => {
    const manMaker = requireExercise("man-maker")
    // 3 sets × 7.5 reps × 8 s = 180, rest 2 × 60 = 120, transition 45
    const s = slot({ exerciseId: manMaker.id, role: "finisher", reps: [5, 10] })
    expect(estimateSlotSeconds(s, manMaker)).toBe(180 + 120 + TRANSITION_SECONDS)
    // Unilateral: per side. 2 sets × 4 reps × 20 s × 2 sides = 320, rest 60, transition 45
    const tgu = requireExercise("turkish-get-up")
    expect(estimateSlotSeconds(slot({ exerciseId: tgu.id, sets: 2, reps: [3, 5] }), tgu)).toBe(320 + 60 + TRANSITION_SECONDS)
  })

  it("trims sets (never below 2) then rests when the plan is too long", () => {
    const make = (role: WorkoutExercise["role"], sets: number, priority: number): FittableSlot => ({
      slot: slot({ slotId: role, role, sets, restSeconds: 180, reps: [4, 6] }),
      exercise: FIXTURE_BY_ID.get("dumbbell-bench-press")!,
      minSets: 2,
      maxSets: 6,
      minRest: 150,
      priority,
    })
    const plan = [make("primary_compound", 5, 1), make("secondary_compound", 4, 2), make("accessory", 4, 3), make("isolation", 4, 4)]
    const kept = fitToDuration(plan, 600, 30, "strength")
    expect(kept.length).toBeGreaterThanOrEqual(3)
    for (const f of kept) expect(f.slot.sets).toBeGreaterThanOrEqual(2)
    expect(kept.find((f) => f.slot.role === "isolation")!.slot.sets).toBe(2)
    expect(kept.find((f) => f.slot.role === "primary_compound")!.slot.restSeconds).toBeGreaterThanOrEqual(150)
    const total = 600 + kept.reduce((s, f) => s + estimateSlotSeconds(f.slot, f.exercise), 0)
    expect(total).toBeLessThanOrEqual(30 * 60 * 1.3 + 1)
  })

  it("adds sets to the big lifts when the plan is too short", () => {
    const make = (role: WorkoutExercise["role"]): FittableSlot => ({
      slot: slot({ slotId: role, role, sets: 2, restSeconds: 60 }),
      exercise: FIXTURE_BY_ID.get("dumbbell-bench-press")!,
      minSets: 2,
      maxSets: 5,
      minRest: 60,
      priority: 1,
    })
    const plan = [make("primary_compound"), make("secondary_compound"), make("isolation")]
    const before = 300 + plan.reduce((s, f) => s + estimateSlotSeconds(f.slot, f.exercise), 0)
    const kept = fitToDuration(plan, 300, 60, "muscle_gain")
    expect(kept.find((f) => f.slot.role === "primary_compound")!.slot.sets).toBe(5)
    expect(kept.every((f) => f.slot.sets <= 5)).toBe(true)
    expect(kept.every((f) => f.slot.restSeconds <= 120)).toBe(true)
    const total = 300 + kept.reduce((s, f) => s + estimateSlotSeconds(f.slot, f.exercise), 0)
    expect(total).toBeGreaterThan(before)
  })
})

describe("fitting to the time budget (coach review F16, F27, F28)", () => {
  const fittable = (role: WorkoutExercise["role"], sets: number, overrides: Partial<WorkoutExercise> = {}, exerciseId = "dumbbell-bench-press"): FittableSlot => ({
    slot: slot({ slotId: `${role}-${exerciseId}`, exerciseId, role, sets, ...overrides }),
    exercise: FIXTURE_BY_ID.get(exerciseId) ?? requireExercise(exerciseId),
    minSets: 2,
    maxSets: 5,
    minRest: 60,
    priority: 1,
  })
  const totalOf = (fixed: number, kept: FittableSlot[]) => fixed + kept.reduce((s, f) => s + estimateSlotSeconds(f.slot, f.exercise), 0)

  it("trims as soon as the estimate passes 1.05 × the preference", () => {
    // 4 slots × (4 × 10 × 3 + 3 × 90 + 45) = 1740 s + 600 fixed = 2340 s, 1.3 × a 30-minute budget.
    const plan = ["primary_compound", "secondary_compound", "accessory", "isolation"].map((r) =>
      fittable(r as WorkoutExercise["role"], 4, { restSeconds: 90 }),
    )
    const kept = fitToDuration(plan, 600, 30, "muscle_gain")
    expect(totalOf(600, kept)).toBeLessThanOrEqual(30 * 60 * FIT_CEILING)
    // The card shows whole minutes: never "32 min" on a 30-minute plan.
    expect(Math.round(totalOf(600, kept) / 60)).toBeLessThanOrEqual(30 * FIT_CEILING)
    expect(kept.length).toBeGreaterThanOrEqual(3)
  })

  it("counts the rounded minutes the card shows, not only the seconds", () => {
    // Exactly 1.05 × 30 min = 1890 s reads as 32 min, so one more set comes off.
    const one = fittable("isolation", 3, { restSeconds: 60, reps: [10, 10] }) // 90 + 120 + 45 = 255 s
    const kept = fitToDuration([one], 1890 - 255, 30, "muscle_gain")
    expect(Math.round(totalOf(1890 - 255, kept) / 60)).toBeLessThanOrEqual(31)
  })

  it("leaves room for a finisher the caller still has to add", () => {
    const make = () => ["primary_compound", "secondary_compound", "isolation"].map((r) => fittable(r as WorkoutExercise["role"], 2))
    const grown = fitToDuration(make(), 300, 30, "fat_loss")
    const reserved = fitToDuration(make(), 300, 30, "fat_loss", undefined, { reserveSeconds: 360 })
    expect(totalOf(300, grown)).toBeGreaterThanOrEqual(30 * 60 * 0.85)
    expect(totalOf(300, reserved)).toBeLessThan(totalOf(300, grown))
    expect(totalOf(300, reserved)).toBeLessThan(30 * 60 * 0.85)
  })

  it("never grows non-compound rest past the exercise's own range + 15 s", () => {
    const curlEx = FIXTURE_BY_ID.get("dumbbell-curl")! // own rest 45–75
    const plan = [fittable("isolation", 5, { restSeconds: 60 }, "dumbbell-curl")]
    plan[0]!.maxSets = 5
    fitToDuration(plan, 300, 75, "muscle_gain")
    expect(plan[0]!.slot.restSeconds).toBeLessThanOrEqual(curlEx.restRange[1] + 15)
    expect(plan[0]!.slot.restSeconds).toBeLessThanOrEqual(restCeiling(curlEx, "muscle_gain", "isolation"))
  })

  it("never trims a jump primer's rest below 90 s", () => {
    const jump = fittable("accessory", 3, { exerciseId: "broad-jump", reps: [3, 5], restSeconds: 100 }, "broad-jump")
    jump.minRest = 45
    jump.priority = 0
    const heavy = ["primary_compound", "secondary_compound", "isolation"].map((r) => ({
      ...fittable(r as WorkoutExercise["role"], 5, { restSeconds: 150 }),
      priority: 5,
    }))
    const kept = fitToDuration([jump, ...heavy], 1200, 30, "strength")
    const keptJump = kept.find((f) => f.exercise.id === "broad-jump")!
    expect(keptJump.slot.restSeconds).toBeGreaterThanOrEqual(90)
    // The other slots were trimmed towards their own floor meanwhile.
    expect(kept.some((f) => f.exercise.id !== "broad-jump" && f.slot.restSeconds < 150)).toBe(true)
  })

  it("never trims a heavy hypertrophy compound's rest below 90 s", () => {
    const squat = { ...fittable("primary_compound", 4, { restSeconds: 165, reps: [6, 8] }, "barbell-back-squat"), priority: 0 }
    const others = ["secondary_compound", "accessory", "isolation"].map((r) => ({ ...fittable(r as WorkoutExercise["role"], 4, { restSeconds: 90 }), priority: 5 }))
    const kept = fitToDuration([squat, ...others], 1200, 30, "muscle_gain")
    expect(kept.find((f) => f.exercise.id === "barbell-back-squat")!.slot.restSeconds).toBeGreaterThanOrEqual(90)
  })
})

describe("compound rest order and heavy rests while fitting (coach round 2, R20)", () => {
  const fittable = (role: WorkoutExercise["role"], exerciseId: string, overrides: Partial<WorkoutExercise> = {}, minRest = 60): FittableSlot => ({
    slot: slot({ slotId: `${role}-${exerciseId}`, exerciseId, role, sets: 3, ...overrides }),
    exercise: requireExercise(exerciseId),
    minSets: 2,
    maxSets: 4,
    minRest,
    priority: { primary_compound: 1, secondary_compound: 2, accessory: 3, isolation: 4 }[role as string] ?? 5,
  })
  const restOf = (kept: FittableSlot[], role: WorkoutExercise["role"]) => kept.find((f) => f.slot.role === role)!.slot.restSeconds

  it("the primary compound rests at least as long as the secondary, whatever the time budget", () => {
    // Hypertrophy beginner, dumbbells: goblet squat primary at 85 s, a 4 kg incline press secondary at 105 s.
    for (const minutes of [20, 30, 45, 75]) {
      const plan = [
        fittable("primary_compound", "goblet-squat", { reps: [6, 10], restSeconds: 85, recommendedWeightKg: 10 }),
        fittable("secondary_compound", "incline-dumbbell-press", { reps: [7, 11], restSeconds: 105, recommendedWeightKg: 4 }),
        fittable("isolation", "dumbbell-curl", { reps: [10, 14], restSeconds: 60, recommendedWeightKg: 6 }),
      ]
      const kept = fitToDuration(plan, 600, minutes, "muscle_gain")
      expect(restOf(kept, "primary_compound"), `${minutes} min`).toBeGreaterThanOrEqual(restOf(kept, "secondary_compound"))
    }
  })

  it("lengthens a heavy dumbbell primary to keep pace with a barbell secondary instead of cutting the barbell's rest", () => {
    // Hypertrophy, advanced: incline dumbbell press primary (own range 90–120 s) at 115 s and the
    // barbell overhead press secondary at 150 s.
    for (const minutes of [30, 45, 60]) {
      const primary = fittable("primary_compound", "incline-dumbbell-press", { reps: [6, 10], restSeconds: 115, recommendedWeightKg: 24 })
      primary.maxRest = restCeiling(primary.exercise, "muscle_gain", "primary_compound")
      const secondary = fittable("secondary_compound", "overhead-press", { reps: [6, 8], restSeconds: 150, recommendedWeightKg: 40 })
      const kept = fitToDuration([primary, secondary, fittable("isolation", "dumbbell-curl", { reps: [10, 14], restSeconds: 60 })], 600, minutes, "muscle_gain")
      expect(restOf(kept, "secondary_compound"), `${minutes} min`).toBeGreaterThanOrEqual(150)
      expect(restOf(kept, "primary_compound"), `${minutes} min`).toBeGreaterThanOrEqual(restOf(kept, "secondary_compound"))
      expect(restOf(kept, "primary_compound")).toBeLessThanOrEqual(180)
    }
  })

  it("brings the secondary down to the primary when the primary may not grow (a rest-day session)", () => {
    const primary = { ...fittable("primary_compound", "goblet-squat", { reps: [6, 10], restSeconds: 85 }), maxRest: 85 }
    const secondary = fittable("secondary_compound", "incline-dumbbell-press", { reps: [7, 11], restSeconds: 105, recommendedWeightKg: 4 })
    const kept = fitToDuration([primary, secondary], 600, 30, "muscle_gain")
    expect(restOf(kept, "primary_compound")).toBe(85)
    expect(restOf(kept, "secondary_compound")).toBeLessThanOrEqual(85)
    expect(restOf(kept, "secondary_compound")).toBeGreaterThanOrEqual(60)
  })

  it("never trims a heavy strength compound's rest below 180 s, unless its load is too light to ramp from", () => {
    const make = (weightKg: number | null) => [
      fittable("primary_compound", "barbell-back-squat", { reps: [4, 6], restSeconds: 225, recommendedWeightKg: weightKg }, 150),
      fittable("secondary_compound", "barbell-bench-press", { reps: [4, 6], restSeconds: 210, recommendedWeightKg: weightKg }, 150),
      fittable("accessory", "single-arm-dumbbell-row", { reps: [8, 10], restSeconds: 100 }, 90),
      fittable("isolation", "dumbbell-curl", { reps: [8, 10], restSeconds: 75 }, 60),
    ]
    const heavy = fitToDuration(make(80), 900, 25, "strength")
    for (const role of ["primary_compound", "secondary_compound"] as const) expect(restOf(heavy, role)).toBeGreaterThanOrEqual(180)
    expect(restOf(heavy, "primary_compound")).toBeGreaterThanOrEqual(restOf(heavy, "secondary_compound"))
    // An empty bar has no lighter ramp-up set below it: its rest may be trimmed like any other.
    const light = fitToDuration(make(20), 900, 25, "strength")
    expect(restOf(light, "secondary_compound")).toBeLessThan(180)
  })
})

describe("build-up sets on cards with no load, and the trim tie-break (coach round 2, R04, R10, R22)", () => {
  it("budgets one build-up set for an external lift with no load shown, none for one with a load", () => {
    const cable = requireExercise("seated-cable-row")
    const noLoad = slot({ exerciseId: cable.id, role: "accessory", recommendedWeightKg: null, note: "Find your working weight: start light and add weight over 1–2 build-up sets until 8–12 reps leave about 3 in reserve, then do your working sets at that load and log it." })
    const loaded = slot({ exerciseId: cable.id, role: "accessory", recommendedWeightKg: 40 })
    expect(estimateSlotSeconds(noLoad, cable) - estimateSlotSeconds(loaded, cable)).toBe(FEEDER_SET_SECONDS)
    // Not planned yet (a bare prescription): nothing extra.
    const work = { sets: 3, reps: [8, 12] as [number, number], durationSeconds: null, restSeconds: 60, tempo: null }
    expect(estimateWorkSeconds(work, "main", "accessory", cable)).toBe(estimateSlotSeconds(loaded, cable))
  })

  it("budgets a trained lifter's 3–4 build-up sets on a heavy compound with no load", () => {
    const bench = requireExercise("barbell-bench-press")
    const note = "Find your working weight: start with the empty bar and add weight over 3–4 build-up sets until 4–6 reps leave about 3 in reserve, then do your working sets at that load and log it."
    const trained = slot({ exerciseId: bench.id, role: "primary_compound", recommendedWeightKg: null, note })
    const known = slot({ exerciseId: bench.id, role: "primary_compound", recommendedWeightKg: 80 })
    expect(estimateSlotSeconds(trained, bench) - estimateSlotSeconds(known, bench)).toBe(HEAVY_BUILD_UP_SECONDS - RAMP_UP_SECONDS)
  })

  it("within a tier, isolation or unloaded work gives up a set before a loaded compound", () => {
    // strength-b-d7: the day's only loaded row lost a set while the bodyweight prone T-raise kept 3.
    const row: FittableSlot = {
      slot: slot({ slotId: "row", exerciseId: "single-arm-dumbbell-row", role: "accessory", sets: 3, restSeconds: 90, recommendedWeightKg: 20 }),
      exercise: requireExercise("single-arm-dumbbell-row"),
      minSets: 2,
      maxSets: 3,
      minRest: 90,
      priority: 3,
    }
    const raise: FittableSlot = {
      slot: slot({ slotId: "raise", exerciseId: "prone-t-raise", role: "accessory", sets: 3, restSeconds: 90, recommendedWeightKg: null }),
      exercise: requireExercise("prone-t-raise"),
      minSets: 2,
      maxSets: 3,
      minRest: 90,
      priority: 3,
    }
    const fixed = 600
    const both = fixed + estimateSlotSeconds(row.slot, row.exercise) + estimateSlotSeconds(raise.slot, raise.exercise)
    // A budget one set short: exactly one set must go.
    const minutes = Math.floor((both - 60) / 60 / FIT_CEILING)
    const kept = fitToDuration([row, raise], fixed, minutes, "strength")
    expect(kept.find((f) => f.slot.slotId === "raise")!.slot.sets).toBeLessThan(3)
    expect(kept.find((f) => f.slot.slotId === "row")!.slot.sets).toBe(3)
  })
})

describe("trunk work has no build-up time (core spec C15)", () => {
  it("a cable Pallof press with no load shown gets no feeder set", () => {
    const pallof = requireExercise("pallof-press")
    const work = { sets: 2, reps: [8, 10] as [number, number], durationSeconds: null, restSeconds: 45, tempo: null, recommendedWeightKg: null, note: "Find your working weight: the first set sets the weight." }
    const bare = { ...work, recommendedWeightKg: 20 }
    expect(estimateWorkSeconds(work, "main", "accessory", pallof)).toBe(estimateWorkSeconds(bare, "main", "accessory", pallof))
    // A non-trunk cable lift with no load still budgets its feeder set.
    const row = requireExercise("seated-cable-row")
    expect(estimateWorkSeconds(work, "main", "accessory", row) - estimateWorkSeconds({ ...work, recommendedWeightKg: 40 }, "main", "accessory", row)).toBe(FEEDER_SET_SECONDS)
  })
})
