/**
 * Coaching rules added while auditing generated workouts across the profile space
 * (see scripts/engine-report.test.ts). One block per rule.
 */
import { describe, expect, it } from "vitest"
import { EXERCISES, muscleGroupOf } from "@/lib/exercises"
import { EQUIPMENT_PRESETS } from "@/lib/domain/types"
import type { MuscleGroup } from "@/lib/exercises/types"
import { generateWorkout, orderPlans, sessionBudgets, type SlotPlan } from "./generate"
import { libraryFrom } from "./library"
import { prescribe, prescribeReps, prescribeRest, repRangeFitsGoal } from "./prescriptions"
import { createRng } from "./random"
import { replacementCandidates } from "./replace"
import { directionAllows, matchesSlot, passesProfileFilter, regionAllows, scoreCandidate } from "./selection"
import { rotationFor, slotsForCount, TEMPLATES } from "./splits"
import { buildWarmup } from "./warmup"
import { buildCooldown } from "./cooldown"
import { estimateSlotSeconds, fitToDuration, type FittableSlot } from "./duration"
import type { WorkoutExercise } from "./types"
import { FIXTURE_BY_ID, FIXTURE_LIBRARY, makeExercise, makeInput, makeProfile } from "./test-fixtures"

const lib = libraryFrom(FIXTURE_LIBRARY)
const fx = (id: string) => FIXTURE_BY_ID.get(id)!

describe("prescriptions follow the goal table", () => {
  it("heavy-lift rest never leaves the goal range, except heavy hypertrophy compounds, which rest up to 180 s", () => {
    const deadlift = fx("conventional-deadlift") // own rest 180–240
    expect(prescribeRest(deadlift, "fat_loss", "primary_compound")).toBe(75)
    // Coach review F27: a heavy hypertrophy compound (warmupRequired) rests in the 90–180 s band,
    // intersected with its own range (180–240), so 180 s rather than the 60–120 s goal default.
    expect(prescribeRest(deadlift, "muscle_gain", "primary_compound")).toBe(180)
    const rest = prescribeRest(deadlift, "strength", "primary_compound")
    expect(rest).toBeGreaterThanOrEqual(180)
    expect(rest).toBeLessThanOrEqual(240)
  })

  it("support work in a strength block rests like support work, trunk work like isolation", () => {
    const row = fx("seated-cable-row") // own rest 60–90
    const accessoryRest = prescribeRest(row, "strength", "accessory")
    expect(accessoryRest).toBeGreaterThanOrEqual(90)
    expect(accessoryRest).toBeLessThanOrEqual(120)
    const curl = prescribeRest(fx("dumbbell-curl"), "strength", "isolation")
    expect(curl).toBeGreaterThanOrEqual(60)
    expect(curl).toBeLessThanOrEqual(90)
    const deadBug = prescribeRest(fx("dead-bug"), "strength", "accessory")
    expect(deadBug).toBeGreaterThanOrEqual(60)
    expect(deadBug).toBeLessThanOrEqual(90)
  })

  it("short-rest drills in a hypertrophy block rest close to the goal floor", () => {
    const drill = makeExercise({ id: "drill", category: "glutes", primary: "glutes", pattern: "hip_extension", mechanics: "isolation", equipment: ["bodyweight"], rest: [30, 45] })
    expect(prescribeRest(drill, "muscle_gain", "isolation")).toBeGreaterThanOrEqual(45)
  })

  it("uses the end of the lift's range nearest the goal when the ranges do not overlap", () => {
    // Calf raise 12–25 in a strength block: the heavy end, not 23–25.
    expect(prescribeReps(fx("standing-calf-raise"), "strength", "isolation")).toEqual([12, 14])
    // Heavy barbell lift that needs ramp-up sets keeps its own range in an endurance block.
    expect(prescribeReps(fx("romanian-deadlift"), "endurance", "secondary_compound")).toEqual([7, 12])
    expect(repRangeFitsGoal(fx("romanian-deadlift"), "endurance")).toBe(false)
  })

  it("programs the goal's reps when the load can simply be lightened", () => {
    const split = fx("bulgarian-split-squat") // external, 8–12, no ramp-up sets
    expect(prescribeReps(split, "endurance", "accessory")).toEqual([15, 20])
    expect(repRangeFitsGoal(split, "endurance")).toBe(true)
    // Bodyweight moves cannot be lightened: they keep their own range.
    expect(repRangeFitsGoal(fx("pull-up"), "endurance")).toBe(false)
  })
})

describe("slot matching never crosses the body or the push/pull line", () => {
  const pushAccessory = TEMPLATES.push_a!.slots[2]!
  const pullAccessory = TEMPLATES.pull_a!.slots[2]!
  const pushDelts = TEMPLATES.push_a!.slots.find((s) => s.key === "iso_delts")!
  const core = TEMPLATES.push_a!.slots.find((s) => s.kind === "core")!

  it("a lower-body lift never stands in for an upper-body slot and vice versa", () => {
    expect(regionAllows(fx("barbell-back-squat"), pushAccessory)).toBe(false)
    expect(regionAllows(fx("barbell-bench-press"), TEMPLATES.legs_a!.slots[2]!)).toBe(false)
    for (const level of [0, 1, 2, 3, 4] as const) expect(matchesSlot(fx("barbell-back-squat"), pushAccessory, level)).toBe(false)
    // Whole-body work only fills the general rescue slot.
    expect(regionAllows(fx("kettlebell-swing"), TEMPLATES.legs_b!.slots[0]!)).toBe(true) // glutes primary
    expect(matchesSlot(fx("farmers-carry"), pushAccessory, 4)).toBe(false)
  })

  it("a press never fills a pull slot and a pull never fills a press slot", () => {
    expect(directionAllows(fx("overhead-press"), pullAccessory)).toBe(false)
    expect(directionAllows(fx("pull-up"), pushAccessory)).toBe(false)
    expect(matchesSlot(fx("overhead-press"), pullAccessory, 4)).toBe(false)
  })

  it("isolation and core slots never take secondary-muscle stand-ins", () => {
    expect(matchesSlot(fx("pull-up"), pushDelts, 4)).toBe(false)
    expect(matchesSlot(fx("push-up"), core, 4)).toBe(false) // abs are a push-up secondary
  })

  it("a compound slot's secondary-muscle stand-in is still a compound", () => {
    // Face pull: horizontal pull, upper back secondary, but an isolation drill.
    expect(matchesSlot(fx("face-pull"), TEMPLATES.pull_b!.slots[0]!, 3)).toBe(false)
  })

  it("scores lifts that cannot be programmed in the goal's reps lower", () => {
    const slot = TEMPLATES.legs_b!.slots[0]!
    const ctx = (goal: "fat_loss" | "strength") => ({
      profile: makeProfile({ goal, experience: "advanced" }),
      slot,
      chosen: [],
      lastSameSplitIds: new Set<string>(),
      recentIds: new Map<string, number>(),
      rng: createRng(7),
    })
    const deadlift = fx("conventional-deadlift") // 1–6 reps
    expect(scoreCandidate(deadlift, ctx("fat_loss"))).toBeLessThan(scoreCandidate(deadlift, ctx("strength")) - 7)
  })
})

describe("session structure", () => {
  it("spreads each group's weekly cap over the days that load it, never above the cap", () => {
    const rotation = rotationFor(6, "beginner")
    const budgets = sessionBudgets(rotation, 10)
    expect(budgets.get("back")).toBe(5)
    expect(budgets.get("chest")).toBe(5)
    // Every rotation day has a core slot: 6 days share 10 sets, never below the 2-set minimum.
    expect(budgets.get("core")).toBe(2)
    for (const [g, b] of budgets) {
      const days = rotation.filter((t) => t.slots.some((s) => (s.mechanics === "compound" || s.kind === "core") && s.groups.includes(g))).length
      if (b > 2) expect(b * days, g).toBeLessThanOrEqual(10)
    }
  })

  it("a stand-in found through secondary muscles is recorded as an accessory, not a heavy lift", () => {
    const backIds = FIXTURE_LIBRARY.filter((e) => muscleGroupOf(e) === "back").map((e) => e.id)
    const profile = makeProfile({ trainingDaysPerWeek: 3, excludedExerciseIds: backIds })
    const pushYesterday = generateWorkout(makeInput(profile, "2026-10-06"), lib)
    expect(pushYesterday.split).toBe("push")
    const history = [{ ...pushYesterday, exercises: [], startedAt: "", completedAt: "", durationSeconds: 0, totals: { exercisesCompleted: 0, exercisesSkipped: 0, sets: 0, reps: 0, volumeKg: 0, caloriesEstimate: null }, personalRecords: [], synced: false }]
    const pull = generateWorkout(makeInput(profile, "2026-10-07", history), lib)
    expect(pull.split).toBe("pull")
    for (const e of pull.exercises.filter((x) => x.role === "primary_compound" || x.role === "secondary_compound")) {
      expect(muscleGroupOf(fx(e.exerciseId))).toBe("back")
    }
  })

  it("orders compounds first, then isolation, then trunk work, then the finisher", () => {
    const plan = (id: string, role: SlotPlan["role"], kind: SlotPlan["slot"]["kind"] = "upper_push"): SlotPlan => ({
      slot: { key: id, role, patterns: [], groups: [], priority: 1, kind },
      role,
      exercise: fx(id),
      prescription: prescribe(fx(id), "muscle_gain", "intermediate", role),
      note: null,
      capped: false,
      matchLevel: 0,
    })
    const plans = [
      plan("cable-fly", "primary_compound"), // an isolation stand-in in the primary slot
      plan("plank", "accessory", "core"),
      plan("dumbbell-bench-press", "secondary_compound"),
      plan("burpee", "finisher", "conditioning"),
      plan("cable-triceps-pushdown", "isolation"),
      plan("overhead-press", "accessory"),
    ]
    orderPlans(plans)
    expect(plans.map((p) => p.exercise.id)).toEqual(["dumbbell-bench-press", "overhead-press", "cable-fly", "cable-triceps-pushdown", "plank", "burpee"])
  })

  it("hypertrophy days of five or more exercises always include isolation work", () => {
    const full = TEMPLATES.full_a!
    expect(slotsForCount(full, 5, false).some((s) => s.role === "isolation")).toBe(false)
    const hyper = slotsForCount(full, 5, false, true)
    expect(hyper.some((s) => s.role === "isolation")).toBe(true)
    expect(hyper.some((s) => s.kind === "core")).toBe(true)
    expect(hyper.filter((s) => s.role === "primary_compound" || s.role === "secondary_compound")).toHaveLength(2)
  })

  it("leg days keep trunk work ahead of calves when trimmed", () => {
    for (const t of [TEMPLATES.legs_a!, TEMPLATES.legs_b!]) expect(slotsForCount(t, 5, false).some((s) => s.kind === "core")).toBe(true)
  })

  it("Upper B never programs two horizontal presses without an overhead one", () => {
    const pushes = TEMPLATES.upper_b!.slots.filter((s) => s.kind === "upper_push")
    expect(pushes.filter((s) => s.patterns.every((p) => p === "horizontal_push"))).toHaveLength(1)
    expect(pushes.filter((s) => s.patterns.every((p) => p === "vertical_push"))).toHaveLength(1)
  })

  it("the fitter never adds sets past a group's remaining weekly room", () => {
    const slot = (id: string, sets: number): WorkoutExercise => ({
      slotId: id, exerciseId: "dumbbell-bench-press", phase: "main", role: "accessory", sets, reps: [8, 12],
      durationSeconds: null, restSeconds: 60, tempo: null, rir: 2, recommendedWeightKg: null, note: null, replacedFromExerciseId: null,
    })
    const make = (id: string): FittableSlot => ({ slot: slot(id, 2), exercise: fx("dumbbell-bench-press"), minSets: 2, maxSets: 5, minRest: 60, priority: 1, group: "chest" })
    const plan = [make("a"), make("b")]
    const room = new Map<string, number>([["chest", 1]])
    const kept = fitToDuration(plan, 0, 60, "muscle_gain", room)
    expect(kept.reduce((sum, f) => sum + f.slot.sets, 0)).toBe(5)
    expect(room.get("chest")).toBe(0)
    expect(kept.every((f) => estimateSlotSeconds(f.slot, f.exercise) > 0)).toBe(true)
  })
})

describe("warm-up and cool-down fit the session", () => {
  it("the warm-up prepares the groups today's compounds load, even on a full-body day", () => {
    const profile = makeProfile({ durationPreferenceMinutes: 45 })
    const items = buildWarmup({ pool: FIXTURE_LIBRARY, profile, focus: ["full_body", "quads", "chest", "back"], heavy: ["quads", "chest"], rng: createRng(3) })
    expect(items[0]!.exercise.id.startsWith("warmup-")).toBe(true)
    const prepares = (g: MuscleGroup) => items.some((i) => (i.exercise.tags ?? []).includes(`for:${g}`))
    expect(prepares("quads")).toBe(true)
    expect(prepares("chest")).toBe(true)
    for (const i of items) expect(i.exercise.movementPattern).not.toBe("stretch")
  })

  it("the cool-down never stretches an untrained muscle while two relevant stretches exist", () => {
    const profile = makeProfile({ durationPreferenceMinutes: 60 })
    const items = buildCooldown({ pool: FIXTURE_LIBRARY, profile, focus: ["back", "biceps"], trained: ["back", "biceps"], rng: createRng(5) })
    const stretches = items.filter((i) => !(i.exercise.tags ?? []).includes("breathing"))
    expect(stretches.length).toBeGreaterThanOrEqual(2)
    for (const i of stretches) expect(i.exercise.id).not.toMatch(/quad|hamstring/)
  })
})

describe("replacement tiers", () => {
  it("lists same-group compounds first for a compound slot, then the rest, so excluding the list exhausts it", () => {
    const input = makeInput(makeProfile())
    const workout = generateWorkout(input, lib)
    const primary = workout.exercises.find((e) => e.role === "primary_compound")!
    const group = muscleGroupOf(fx(primary.exerciseId))
    const ranked = replacementCandidates(workout, primary.slotId, input, 50, lib).map((c) => fx(c.exerciseId))
    const firstOther = ranked.findIndex((e) => muscleGroupOf(e) !== group || e.mechanics !== "compound")
    const lastSame = ranked.map((e) => muscleGroupOf(e) === group && e.mechanics === "compound").lastIndexOf(true)
    expect(lastSame).toBeGreaterThanOrEqual(0)
    if (firstOther >= 0) expect(firstOther).toBeGreaterThan(lastSame)
  })
})

describe("exercise data supports no-equipment programming", () => {
  it("a bodyweight beginner has triceps, biceps, delt, rear-delt and hamstring options", () => {
    const profile = makeProfile({ experience: "beginner", equipmentPreset: "bodyweight", equipment: EQUIPMENT_PRESETS.bodyweight })
    const options = EXERCISES.filter((e) => passesProfileFilter(e, profile) && e.category !== "cardio")
    const has = (pred: (e: (typeof EXERCISES)[number]) => boolean) => options.some(pred)
    expect(has((e) => e.primaryMuscle === "triceps" && e.movementPattern === "elbow_extension")).toBe(true)
    expect(has((e) => e.primaryMuscle === "biceps" && e.movementPattern === "elbow_flexion")).toBe(true)
    // Coach review F25: prone-y-raise was mislabelled side_delts and is now rear_delts; no
    // bodyweight-only lift honestly isolates the side delts, so any shoulder isolation counts.
    expect(has((e) => muscleGroupOf(e) === "shoulders" && e.mechanics === "isolation")).toBe(true)
    expect(has((e) => e.primaryMuscle === "rear_delts" && e.movementPattern === "horizontal_pull")).toBe(true)
    expect(has((e) => e.primaryMuscle === "hamstrings" && e.movementPattern === "hinge")).toBe(true)
  })
})
