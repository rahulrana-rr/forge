import { describe, expect, it } from "vitest"
import type { CompletedWorkout, TrainingDays, DurationPreference, Experience } from "@/lib/domain/types"
import { getExercise, muscleGroupOf } from "@/lib/exercises"
import { ALL_MUSCLE_GROUPS, type BodyArea, type Goal } from "@/lib/exercises/types"
import { addDays } from "@/lib/dates"
import {
  AEROBIC_NOTE_MINUTES,
  chooseTemplate,
  coreCatchUpDue,
  finisherFloor,
  generateWorkout,
  MIN_MAIN_EXERCISES,
  orderPlans,
  rescueExclusions,
  sessionBudgets,
  trimSupportFirst,
  type SlotPlan,
} from "./generate"
import { computeRecovery, coreWeeklyCap } from "./recovery"
import { CORE_DAYS_TARGET, liftingSlotCap, MAX_CORE_DAYS, rotationFor } from "./splits"
import { libraryFrom } from "./library"
import { estimateDurationMinutes, estimateSlotSeconds, FIT_CEILING, fitToDuration, type FittableSlot } from "./duration"
import { CALIBRATION_RIR, prescribe, prescribeRir, UNPROVEN_SUPPORT_RIR, type MainRole, type Prescription } from "./prescriptions"
import type { WorkoutExercise } from "./types"
import { lastPerformance } from "./progression"
import {
  completeAtTop,
  FIXTURE_BY_ID,
  FIXTURE_LIBRARY,
  makeExercise,
  makeInput,
  makeProfile,
  progressFromHistory,
  setupNoteViolation,
} from "./test-fixtures"
import type { Workout } from "./types"

const lib = libraryFrom(FIXTURE_LIBRARY)

interface FitSpec {
  id: string
  role: WorkoutExercise["role"]
  sets: number
  priority: number
  reps?: [number, number]
  durationSeconds?: number
  rest?: number
  minSets?: number
}

/** A main slot ready for the time fitter, the way generate.ts builds one. */
function fittableOf(spec: FitSpec, exercises: ReadonlyMap<string, SlotPlan["exercise"]> = FIXTURE_BY_ID): FittableSlot {
  const exercise = exercises.get(spec.id)!
  const rest = spec.rest ?? 60
  return {
    slot: {
      slotId: spec.id,
      exerciseId: spec.id,
      phase: "main",
      role: spec.role,
      sets: spec.sets,
      reps: spec.durationSeconds ? null : (spec.reps ?? [10, 12]),
      durationSeconds: spec.durationSeconds ?? null,
      restSeconds: rest,
      tempo: null,
      rir: null,
      recommendedWeightKg: null,
      note: null,
      replacedFromExerciseId: null,
    },
    exercise,
    minSets: spec.minSets ?? Math.min(2, spec.sets),
    maxSets: spec.sets,
    minRest: spec.role === "finisher" ? rest : Math.min(rest, 45),
    priority: spec.priority,
    group: spec.role === "finisher" ? undefined : muscleGroupOf(exercise),
  }
}

/** Fixed seconds that put a plan at `minutes` in total. */
function fixedFor(slots: readonly FittableSlot[], minutes: number): number {
  return minutes * 60 - slots.reduce((sum, f) => sum + estimateSlotSeconds(f.slot, f.exercise), 0)
}

function totalSeconds(slots: readonly FittableSlot[], fixed: number): number {
  return fixed + slots.reduce((sum, f) => sum + estimateSlotSeconds(f.slot, f.exercise), 0)
}
const ALL_AREAS: BodyArea[] = ["shoulder", "elbow", "wrist", "lower_back", "hip", "knee", "ankle", "neck"]

function main(w: ReturnType<typeof generateWorkout>) {
  return w.exercises.filter((e) => e.phase === "main")
}

describe("generateWorkout (fixtures)", () => {
  it("builds a complete, well-formed session from an empty history", () => {
    const profile = makeProfile()
    const w = generateWorkout(makeInput(profile), lib)
    expect(w.split).toBe("upper")
    expect(w.title).toBe("Upper A")
    expect(w.engineVersion).toBe(1)
    expect(w.generatedAt).toBe("2026-10-07T07:00:00.000Z")
    const warm = w.exercises.filter((e) => e.phase === "warmup")
    const cool = w.exercises.filter((e) => e.phase === "cooldown")
    expect(warm.length).toBeGreaterThanOrEqual(3)
    expect(warm.length).toBeLessThanOrEqual(6)
    expect(warm[0]?.exerciseId.startsWith("warmup-")).toBe(true)
    expect(cool.length).toBeGreaterThanOrEqual(3)
    expect(cool[cool.length - 1]?.exerciseId).toBe("box-breathing")
    const m = main(w)
    expect(m.length).toBeGreaterThanOrEqual(6)
    expect(m.length).toBeLessThanOrEqual(7)
    expect(m.map((e) => e.role).slice(0, 2)).toEqual(["primary_compound", "secondary_compound"])
    expect(m[0]?.exerciseId).toBe("barbell-bench-press")
    // Coach review F16/F02: whether the primary carries the ramp-up sentence depends on its load
    // (a 22.5 kg bench estimate is the empty bar plus one step: no lighter sets below it).
    expect(setupNoteViolation(m[0]!, FIXTURE_BY_ID.get(m[0]!.exerciseId)!)).toBeNull()
    expect(m[0]?.note).toMatch(/Ramp up|Starting guess|Find your working weight/)
    expect(new Set(w.exercises.map((e) => e.exerciseId)).size).toBe(w.exercises.length)
    expect(new Set(w.exercises.map((e) => e.slotId)).size).toBe(w.exercises.length)
    for (const e of m) {
      // No history: a load is either absent or a labelled starting estimate, never "recommended".
      expect(e.recommendedWeightKg === null || e.weightSource === "estimate").toBe(true)
      expect(e.sets).toBeGreaterThanOrEqual(2)
      expect(e.reps !== null || e.durationSeconds !== null).toBe(true)
    }
    expect(w.estimatedMinutes).toBe(estimateDurationMinutes(w, lib))
    expect(w.estimatedMinutes).toBeGreaterThanOrEqual(42)
    expect(w.estimatedMinutes).toBeLessThanOrEqual(78)
  })

  it("is deterministic and changes with the seed", () => {
    const profile = makeProfile()
    const a = generateWorkout(makeInput(profile), lib)
    const b = generateWorkout(makeInput(profile), lib)
    expect(a).toEqual(b)
    const c = generateWorkout(makeInput(profile, "2026-10-07", [], {}, 12345), lib)
    expect(c.seed).toBe(12345)
    expect(c.id).not.toBe(a.id)
  })

  it("respects equipment, difficulty, limitations and exclusions for every slot", () => {
    const profile = makeProfile({ experience: "beginner", equipmentPreset: "dumbbells", limitations: ["lower_back", "knee"], excludedExerciseIds: ["dumbbell-curl"] })
    const w = generateWorkout(makeInput(profile), lib)
    for (const e of w.exercises) {
      const ex = FIXTURE_BY_ID.get(e.exerciseId)!
      expect(ex.equipment.every((q) => profile.equipment.includes(q))).toBe(true)
      expect(ex.difficulty).toBe("beginner")
      expect(ex.contraindications.some((c) => profile.limitations.includes(c))).toBe(false)
      expect(e.exerciseId).not.toBe("dumbbell-curl")
      // Beginners get at most 3 working sets; a conditioning finisher's rounds are intervals, not sets.
      if (e.phase === "main" && e.role !== "finisher") expect(e.sets).toBeLessThanOrEqual(3)
    }
  })

  it("bodyweight-only beginner with every limitation does not throw", () => {
    const profile = makeProfile({ experience: "beginner", equipmentPreset: "bodyweight", limitations: ALL_AREAS, trainingDaysPerWeek: 3, durationPreferenceMinutes: 30 })
    const w = generateWorkout(makeInput(profile), lib)
    expect(w.exercises.every((e) => FIXTURE_BY_ID.has(e.exerciseId))).toBe(true)
    if (main(w).length < MIN_MAIN_EXERCISES) expect(w.notes?.length).toBeGreaterThan(0)
  })

  it("works with an empty library", () => {
    const w = generateWorkout(makeInput(makeProfile()), libraryFrom([]))
    expect(w.exercises).toEqual([])
    expect(w.notes?.[0]).toMatch(/No exercises/)
    expect(w.estimatedMinutes).toBe(1)
  })

  it("drops the chest slot instead of standing in another slot's work when every chest exercise is excluded", () => {
    // Coach round 1 (F06, F10): this used to require a secondary-muscle stand-in (a triceps or
    // shoulder press in the chest slot). Those groups belong to other Push slots, so the coach
    // rejected the stand-in: the slot is dropped, a spare slot takes its place, and the day says why.
    const chestIds = FIXTURE_LIBRARY.filter((e) => e.category === "chest").map((e) => e.id)
    const profile = makeProfile({ trainingDaysPerWeek: 3, excludedExerciseIds: chestIds })
    const w = generateWorkout(makeInput(profile), lib)
    expect(w.split).toBe("push")
    expect(main(w).length).toBeGreaterThanOrEqual(MIN_MAIN_EXERCISES)
    expect(w.exercises.some((e) => chestIds.includes(e.exerciseId))).toBe(false)
    expect(main(w).some((e) => /Stand-in/.test(e.note ?? ""))).toBe(false)
    expect(w.focus).not.toContain("chest")
    expect((w.notes ?? []).some((n) => /chest/.test(n) && /excluded/.test(n))).toBe(true)
  })

  it("30 minutes with 6 days yields a short session of 4 main slots", () => {
    const profile = makeProfile({ trainingDaysPerWeek: 6, durationPreferenceMinutes: 30, experience: "advanced", goal: "strength" })
    const w = generateWorkout(makeInput(profile), lib)
    expect(main(w)).toHaveLength(4)
    expect(w.estimatedMinutes).toBeLessThanOrEqual(30 * 1.3)
  })

  it("conditioning goals end the main phase with a finisher", () => {
    for (const goal of ["fat_loss", "general_fitness", "endurance"] as Goal[]) {
      const w = generateWorkout(makeInput(makeProfile({ goal, durationPreferenceMinutes: 45 })), lib)
      const m = main(w)
      expect(m[m.length - 1]?.role).toBe("finisher")
      const ex = FIXTURE_BY_ID.get(m[m.length - 1]!.exerciseId)!
      expect(["cardio", "full_body"]).toContain(ex.category)
    }
    const strength = generateWorkout(makeInput(makeProfile({ goal: "strength" })), lib)
    expect(main(strength).some((e) => e.role === "finisher")).toBe(false)
  })

  it("full-body days contain lower, push, pull and core", () => {
    const w = generateWorkout(makeInput(makeProfile({ trainingDaysPerWeek: 2, durationPreferenceMinutes: 30 })), lib)
    const patterns = main(w).map((e) => FIXTURE_BY_ID.get(e.exerciseId)!.movementPattern)
    expect(patterns.some((p) => p === "squat" || p === "hinge" || p === "lunge")).toBe(true)
    expect(patterns.some((p) => p === "horizontal_push" || p === "vertical_push")).toBe(true)
    expect(patterns.some((p) => p === "horizontal_pull" || p === "vertical_pull")).toBe(true)
    expect(main(w).some((e) => muscleGroupOf(FIXTURE_BY_ID.get(e.exerciseId)!) === "core")).toBe(true)
  })

  it("rotates through the split and skips a day whose muscles are not recovered", () => {
    const profile = makeProfile({ trainingDaysPerWeek: 4 })
    const history: CompletedWorkout[] = []
    const titles: string[] = []
    for (let d = 0; d < 4; d++) {
      const date = `2026-10-0${d + 1}`
      const w = generateWorkout(makeInput(profile, date, history), lib)
      titles.push(w.title)
      history.unshift(completeAtTop(w, (id) => FIXTURE_BY_ID.get(id)))
    }
    expect(titles).toEqual(["Upper A", "Lower A", "Upper B", "Lower B"])

    // Natural next is Upper A, but chest was hit heavy yesterday → freshest alternative.
    const rotation = rotationFor(4, "intermediate")
    const fake = completeAtTop(generateWorkout(makeInput(profile, "2026-10-05", history), lib), (id) => FIXTURE_BY_ID.get(id))
    const heavyYesterday: CompletedWorkout = { ...fake, title: "Lower B", split: "lower", date: "2026-10-05" }
    const choice = chooseTemplate(rotation, [heavyYesterday, ...history], computeRecovery([heavyYesterday, ...history], "2026-10-06", lib), "2026-10-06")
    expect(choice.natural.key).toBe("upper_a")
    expect(choice.template.key).not.toBe("upper_a")
    expect(choice.reason).toBe("freshness")
  })

  it("avoids repeating the exact exercise list of the last same-split workout", () => {
    const profile = makeProfile({ trainingDaysPerWeek: 3 })
    const first = generateWorkout(makeInput(profile, "2026-10-01"), lib)
    const history = [completeAtTop(first, (id) => FIXTURE_BY_ID.get(id))]
    const second = generateWorkout(makeInput(profile, "2026-10-04", history), lib)
    expect(second.split).toBe("pull")
    const third = generateWorkout(makeInput(profile, "2026-10-04", history, {}, 99), lib)
    // Force the same split as the first workout to compare lists.
    const pushAgain = generateWorkout(makeInput(profile, "2026-10-04", [{ ...history[0]!, split: "legs", title: "Legs" }]), lib)
    expect(pushAgain.split).toBe("push")
    const firstIds = new Set(main(first).map((e) => e.exerciseId))
    const differing = main(pushAgain).filter((e) => !firstIds.has(e.exerciseId)).length
    expect(differing).toBeGreaterThanOrEqual(2)
    expect(third.split).toBe("pull")
  })

  it("recommends weights from history and progresses after top-of-range sessions", () => {
    const profile = makeProfile({ trainingDaysPerWeek: 3, goal: "muscle_gain" })
    const first = generateWorkout(makeInput(profile, "2026-10-01"), lib)
    const done = completeAtTop(first, (id) => FIXTURE_BY_ID.get(id), 60)
    const history = [{ ...done, split: "legs" as const, title: "Legs" }]
    const again = generateWorkout(makeInput(profile, "2026-10-04", history, progressFromHistory(history)), lib)
    expect(again.split).toBe("push")
    const bench = main(again).find((e) => e.exerciseId === "barbell-bench-press")
    expect(bench).toBeDefined()
    expect(bench!.recommendedWeightKg).toBe(62.5)
    expect(bench!.note).toMatch(/Ramp up/)
  })

  it("caps weekly sets per muscle group including today's plan", () => {
    const profile = makeProfile({ trainingDaysPerWeek: 6, experience: "beginner", durationPreferenceMinutes: 75 })
    const history: CompletedWorkout[] = []
    for (let d = 1; d <= 6; d++) {
      const date = `2026-10-0${d}`
      const w = generateWorkout(makeInput(profile, date, history), lib)
      history.unshift(completeAtTop(w, (id) => FIXTURE_BY_ID.get(id)))
    }
    const w = generateWorkout(makeInput(profile, "2026-10-07", history), lib)
    const recovery = computeRecovery(history, "2026-10-07", lib)
    const planned = new Map<string, number>()
    for (const e of main(w)) {
      const g = muscleGroupOf(FIXTURE_BY_ID.get(e.exerciseId)!)
      planned.set(g, (planned.get(g) ?? 0) + e.sets)
    }
    for (const g of ALL_MUSCLE_GROUPS) {
      const total = recovery[g].setsLast7 + (planned.get(g) ?? 0)
      if (total <= 10) continue
      // Over the cap only through the 2-set floor: every slot for that group is at 2 sets.
      const slots = main(w).filter((e) => muscleGroupOf(FIXTURE_BY_ID.get(e.exerciseId)!) === g && e.role !== "finisher")
      for (const s of slots) expect(s.sets, `${g} ${s.exerciseId}`).toBe(2)
    }
    // Six straight days spend every pushing group's beginner cap (volume is now spread across
    // the week instead of front-loaded), so day 7 is a light day built from groups that still
    // have room plus conditioning, and says why. It still has the minimum three exercises.
    // Coach round 1 (F17): six days in a row now also trigger the rest-day guard, whose note is
    // an explanation in its own right (minimum sets, an extra rep in reserve).
    const explained =
      main(w).some((e) => /Capped/.test(e.note ?? "")) || (w.notes ?? []).some((n) => /volume cap|Rest day recommended/.test(n))
    expect(explained).toBe(true)
    expect(main(w).length).toBeGreaterThanOrEqual(MIN_MAIN_EXERCISES)
  })

  it("spreads a group's weekly cap across the rotation days that load it", () => {
    // Beginner, 6 days: back is the compound focus of two pull days, so each gets ≤ 5 direct sets
    // and the second pull day still opens with a compound instead of curls.
    const profile = makeProfile({ trainingDaysPerWeek: 6, experience: "beginner", durationPreferenceMinutes: 60 })
    const history: CompletedWorkout[] = []
    const pulls: Workout[] = []
    for (let d = 1; d <= 6; d++) {
      const w = generateWorkout(makeInput(profile, `2026-10-0${d}`, history), lib)
      if (w.split === "pull") pulls.push(w)
      history.unshift(completeAtTop(w, (id) => FIXTURE_BY_ID.get(id)))
    }
    expect(pulls.length).toBe(2)
    for (const w of pulls) {
      const backSets = main(w)
        .filter((e) => e.role !== "finisher" && muscleGroupOf(FIXTURE_BY_ID.get(e.exerciseId)!) === "back")
        .reduce((sum, e) => sum + e.sets, 0)
      expect(backSets).toBeLessThanOrEqual(5)
      expect(FIXTURE_BY_ID.get(main(w)[0]!.exerciseId)!.mechanics).toBe("compound")
    }
  })

  it("handles 30 workouts of history without throwing and stays deterministic", () => {
    const profile = makeProfile({ trainingDaysPerWeek: 5, experience: "advanced" })
    const history: CompletedWorkout[] = []
    for (let d = 0; d < 30; d++) {
      const date = `2026-09-${String(d + 1).padStart(2, "0")}`
      const w = generateWorkout(makeInput(profile, date, history, progressFromHistory(history)), lib)
      history.unshift(completeAtTop(w, (id) => FIXTURE_BY_ID.get(id)))
    }
    expect(history).toHaveLength(30)
    const a = generateWorkout(makeInput(profile, "2026-10-01", history, progressFromHistory(history)), lib)
    const b = generateWorkout(makeInput(profile, "2026-10-01", history, progressFromHistory(history)), lib)
    expect(a).toEqual(b)
    expect(main(a).length).toBeGreaterThanOrEqual(MIN_MAIN_EXERCISES)
  })

  it("every goal × experience × days × duration generates against fixtures", () => {
    const goals: Goal[] = ["muscle_gain", "strength", "fat_loss", "general_fitness", "endurance"]
    for (const goal of goals) {
      for (const experience of ["beginner", "intermediate", "advanced"] as const) {
        for (const days of [2, 3, 4, 5, 6] as TrainingDays[]) {
          for (const duration of [30, 45, 60, 75] as DurationPreference[]) {
            const profile = makeProfile({ goal, experience, trainingDaysPerWeek: days, durationPreferenceMinutes: duration })
            const w = generateWorkout(makeInput(profile), lib)
            expect(main(w).length).toBeGreaterThanOrEqual(MIN_MAIN_EXERCISES)
            if (duration === 45 || duration === 60) {
              // Core spec C04: the trunk's own weekly cap (a muscle-gain beginner's 6 sets over three
              // core days) leaves a fixture beginner's six-day push day one core set lighter, at 41
              // of 60 minutes; the bound was 0.7 (42).
              expect(w.estimatedMinutes).toBeGreaterThanOrEqual(duration * 0.68)
              expect(w.estimatedMinutes).toBeLessThanOrEqual(duration * 1.3)
            }
          }
        }
      }
    }
  })
})

/** A logged session built by hand: every listed exercise completed with `sets` sets at 50 kg × 10. */
function logged(date: string, title: string, split: CompletedWorkout["split"], entries: { id: string; role: CompletedWorkout["exercises"][number]["role"]; sets: number }[]): CompletedWorkout {
  return {
    id: `log-${date}`,
    date,
    title,
    split,
    focus: [],
    goal: "muscle_gain",
    startedAt: `${date}T07:00:00.000Z`,
    completedAt: `${date}T08:00:00.000Z`,
    durationSeconds: 3600,
    exercises: entries.map((e, i) => ({
      slotId: `s${i}`,
      exerciseId: e.id,
      role: e.role,
      phase: "main" as const,
      status: "completed" as const,
      sets: Array.from({ length: e.sets }, (_, n) => ({ setNumber: n + 1, weightKg: 50, reps: 10, completed: true })),
      prescribedSets: e.sets,
      prescribedReps: [8, 12] as [number, number],
      prescribedDurationSeconds: null,
      recommendedWeightKg: null,
    })),
    totals: { exercisesCompleted: entries.length, exercisesSkipped: 0, sets: 0, reps: 0, volumeKg: 0, caloriesEstimate: null },
    personalRecords: [],
    engineVersion: 1,
    synced: true,
  }
}

describe("coach round 1 (fixtures)", () => {
  it("passes the lift's history into RIR: unproven loads stay 3 or more from failure (F04 caller)", () => {
    const profile = makeProfile({ goal: "strength", experience: "advanced", trainingDaysPerWeek: 4 })
    const first = generateWorkout(makeInput(profile, "2026-10-05"), lib)
    // Coach round 2 (R21): unproven accessory and isolation work for intermediate and advanced
    // lifters sits at UNPROVEN_SUPPORT_RIR (2); compounds keep CALIBRATION_RIR (3).
    const unprovenFloor = (role: string) => (role === "accessory" || role === "isolation" ? UNPROVEN_SUPPORT_RIR : CALIBRATION_RIR)
    for (const e of main(first)) if (e.rir !== null) expect(e.rir, e.exerciseId).toBeGreaterThanOrEqual(unprovenFloor(e.role))
    // Upper A again after a long break (the rotation restarts), now with every lift logged.
    const history = [completeAtTop(first, (id) => FIXTURE_BY_ID.get(id), 60)]
    const progress = progressFromHistory(history)
    const again = generateWorkout(makeInput(profile, "2026-10-20", history, progress), lib)
    expect(again.title).toBe(first.title)
    const primary = main(again).find((e) => e.role === "primary_compound")!
    expect(primary.weightSource).toBe("history")
    const last = lastPerformance(primary.exerciseId, history, progress)
    expect(primary.rir).toBe(prescribeRir(FIXTURE_BY_ID.get(primary.exerciseId)!, "strength", "advanced", "primary_compound", { last, weightSource: "history" }))
    expect(primary.rir).toBeLessThan(3)
    for (const e of main(again)) if (e.rir !== null && e.weightSource === "estimate") expect(e.rir, e.exerciseId).toBeGreaterThanOrEqual(unprovenFloor(e.role))
  })

  it("a capped day names what it trains, says it is a light day and never blames exclusions (F10)", () => {
    // Three sessions this week (the plan's other three days) already put 16 chest sets in against
    // the intermediate cap of 14: no room even for a maintenance dose.
    const profile = makeProfile({ trainingDaysPerWeek: 4, experience: "intermediate" })
    const bench = (date: string, title: string, split: CompletedWorkout["split"], sets: number) =>
      logged(date, title, split, [{ id: "barbell-bench-press", role: "primary_compound", sets }])
    const history = [bench("2026-10-05", "Lower B", "lower", 6), bench("2026-10-03", "Upper B", "upper", 5), bench("2026-10-01", "Lower A", "lower", 5)]
    const w = generateWorkout(makeInput(profile, "2026-10-07", history), lib)
    expect(w.title).toBe("Upper A")
    const chestSets = main(w).filter((e) => e.role !== "finisher" && muscleGroupOf(FIXTURE_BY_ID.get(e.exerciseId)!) === "chest").reduce((s, e) => s + e.sets, 0)
    expect(chestSets).toBe(0)
    expect(w.focus).not.toContain("chest")
    expect(w.focus.length).toBeGreaterThan(0)
    for (const g of w.focus) {
      expect(main(w).some((e) => e.role !== "finisher" && muscleGroupOf(FIXTURE_BY_ID.get(e.exerciseId)!) === g), g).toBe(true)
    }
    expect((w.notes ?? []).some((n) => n.startsWith("Light day") && /chest/.test(n) && /volume cap/.test(n))).toBe(true)
    const notes = [...(w.notes ?? []), ...main(w).map((e) => e.note ?? "")]
    expect(notes.some((n) => /excluded or unavailable/.test(n))).toBe(false)
    expect(main(w).length).toBeGreaterThanOrEqual(MIN_MAIN_EXERCISES)
  })

  it("rescue never repeats a movement already in the day, nor adds trunk work twice (F13)", () => {
    const plan = (id: string, kind: SlotPlan["slot"]["kind"] = "upper_push"): SlotPlan => ({
      slot: { key: id, role: "accessory", patterns: [], groups: [], priority: 1, kind },
      role: "accessory",
      exercise: FIXTURE_BY_ID.get(id)!,
      prescription: prescribe(FIXTURE_BY_ID.get(id)!, "muscle_gain", "advanced", "accessory"),
      note: null,
      capped: false,
      matchLevel: 0,
    })
    const out = rescueExclusions([plan("cable-triceps-pushdown", "arms"), plan("dumbbell-curl", "arms")], FIXTURE_LIBRARY, true)
    // Another elbow extension for the triceps or another curl is the same work.
    expect(out.has("bench-dip")).toBe(true)
    expect(out.has("band-curl")).toBe(true)
    // A different movement for the same group is fine, and so is trunk work while the trunk has room.
    expect(out.has("diamond-push-up")).toBe(false)
    expect(out.has("plank")).toBe(false)
    // Trunk work is out once the day has some, or once the trunk is at its cap.
    expect(rescueExclusions([plan("plank", "core")], FIXTURE_LIBRARY, true).has("dead-bug")).toBe(true)
    expect(rescueExclusions([], FIXTURE_LIBRARY, false).has("dead-bug")).toBe(true)
  })

  it("recommends a rest day after a full week of training and reduces the session (F17)", () => {
    const profile = makeProfile({ trainingDaysPerWeek: 5, goal: "fat_loss", experience: "intermediate" })
    const history: CompletedWorkout[] = []
    // Seven sessions in the seven days up to and including today.
    for (let d = 0; d < 7; d++) {
      const date = addDays("2026-10-01", d)
      const w = generateWorkout(makeInput(profile, date, history.slice(), progressFromHistory(history)), lib)
      history.unshift(completeAtTop(w, (id) => FIXTURE_BY_ID.get(id)))
    }
    const progress = progressFromHistory(history)
    const w = generateWorkout(makeInput(profile, "2026-10-07", history, progress), lib)
    expect((w.notes ?? []).some((n) => n.startsWith("Rest day recommended"))).toBe(true)
    const m = main(w)
    expect(m.length).toBeGreaterThanOrEqual(MIN_MAIN_EXERCISES)
    expect(m.some((e) => e.role === "finisher")).toBe(false)
    let checked = 0
    for (const e of m) {
      const ex = FIXTURE_BY_ID.get(e.exerciseId)!
      const normal = prescribe(ex, profile.goal, profile.experience, e.role as MainRole)
      expect(e.sets, e.exerciseId).toBe(normal.minSets)
      if (e.rir === null) continue
      const last = lastPerformance(e.exerciseId, history, progress)
      const rir = prescribeRir(ex, profile.goal, profile.experience, e.role as MainRole, { last, weightSource: e.weightSource ?? null })
      expect(e.rir, e.exerciseId).toBe(Math.min(4, rir! + 1))
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it("goals without conditioning never get a time-filling finisher (F18)", () => {
    for (const goal of ["muscle_gain", "strength"] as Goal[]) {
      for (const experience of ["beginner", "intermediate", "advanced"] as Experience[]) {
        for (const days of [2, 3, 4, 5, 6] as TrainingDays[]) {
          for (const duration of [30, 45, 60, 75] as DurationPreference[]) {
            for (const seed of [1, 2, 3]) {
              const profile = makeProfile({ goal, experience, trainingDaysPerWeek: days, durationPreferenceMinutes: duration })
              const w = generateWorkout(makeInput(profile, "2026-10-07", [], {}, seed), lib)
              expect(main(w).some((e) => e.role === "finisher"), `${goal} ${experience} ${days}d ${duration}m`).toBe(false)
            }
          }
        }
      }
    }
  })

  it("puts jumps and ballistic lifts first, while the legs are fresh (F28)", () => {
    const jump = makeExercise({ id: "box-jump", category: "legs", primary: "quads", secondary: ["glutes"], pattern: "squat", equipment: ["bodyweight"], loadType: "bodyweight", reps: [3, 5], tags: ["explosive"] })
    const burpee = { ...FIXTURE_BY_ID.get("burpee")!, tags: ["explosive"] }
    const plan = (exercise: SlotPlan["exercise"], role: SlotPlan["role"], kind: SlotPlan["slot"]["kind"] = "lower"): SlotPlan => ({
      slot: { key: exercise.id, role, patterns: [], groups: [], priority: 1, kind },
      role,
      exercise,
      prescription: prescribe(exercise, "strength", "advanced", role),
      note: null,
      capped: false,
      matchLevel: 0,
    })
    const plans = [
      plan(FIXTURE_BY_ID.get("barbell-back-squat")!, "primary_compound"),
      plan(FIXTURE_BY_ID.get("romanian-deadlift")!, "secondary_compound"),
      plan(jump, "accessory"),
      plan(FIXTURE_BY_ID.get("plank")!, "accessory", "core"),
      plan(burpee, "finisher", "conditioning"),
    ]
    orderPlans(plans)
    expect(plans.map((p) => p.exercise.id)).toEqual(["box-jump", "barbell-back-squat", "romanian-deadlift", "plank", "burpee"])
  })
})

describe("coach round 2 (fixtures)", () => {
  /** Five lifts at three sets and a four-round finisher, the shape of the fat-loss sample day. */
  const conditioningDay = (): FittableSlot[] => [
    fittableOf({ id: "dumbbell-bench-press", role: "primary_compound", sets: 3, priority: 1, rest: 75 }),
    fittableOf({ id: "single-arm-dumbbell-row", role: "secondary_compound", sets: 3, priority: 2, rest: 70 }),
    fittableOf({ id: "goblet-squat", role: "accessory", sets: 3, priority: 3, rest: 65 }),
    fittableOf({ id: "dumbbell-lateral-raise", role: "isolation", sets: 3, priority: 4, rest: 50 }),
    fittableOf({ id: "dumbbell-curl", role: "isolation", sets: 3, priority: 5, rest: 50 }),
    fittableOf({ id: "burpee", role: "finisher", sets: 4, priority: 99, durationSeconds: 30, rest: 30, minSets: 1 }),
  ]
  const setsOf = (slots: readonly FittableSlot[], id: string) => slots.find((f) => f.exercise.id === id)?.slot.sets

  it("a conditioning goal trims isolation and accessory sets before a finisher round (R01)", () => {
    // The old order (finisher first, a one-round floor) cut the conditioning block to fit. The time
    // fitter now uses the conditioning order itself (duration.ts CONDITIONING_TRIM_ORDER), so even
    // on its own, with a one-round floor, it takes support sets before a finisher round.
    const before = conditioningDay()
    const fixed = fixedFor(before, 50.5)
    const fitterOnly = fitToDuration(before, fixed, 45, "fat_loss")
    expect(setsOf(fitterOnly, "burpee")).toBe(4)

    const slots = conditioningDay()
    const finisher = slots[5]!
    const rx = { sets: 4, minSets: 1 } as Prescription
    finisher.minSets = finisherFloor(finisher.exercise, rx, "fat_loss")
    finisher.priority = 2.5
    const kept = fitToDuration(trimSupportFirst(slots, fixed, 45, "fat_loss"), fixed, 45, "fat_loss")
    expect(totalSeconds(kept, fixed)).toBeLessThanOrEqual(45 * 60 * FIT_CEILING)
    expect(setsOf(kept, "burpee")).toBe(4)
    // Support work gave the time; the compounds kept every set.
    expect(setsOf(kept, "dumbbell-bench-press")).toBe(3)
    expect(setsOf(kept, "single-arm-dumbbell-row")).toBe(3)
    const support = ["goblet-squat", "dumbbell-lateral-raise", "dumbbell-curl"].map((id) => setsOf(kept, id) ?? 0)
    expect(support.reduce((a, b) => a + b, 0)).toBeLessThan(9)
    expect(support.every((s) => s === 0 || s >= 2)).toBe(true)
  })

  it("far over, a conditioning goal's finisher keeps its floor and outlasts the support slots (R01)", () => {
    const slots = conditioningDay()
    const finisher = slots[5]!
    finisher.minSets = finisherFloor(finisher.exercise, { sets: 4, minSets: 1 } as Prescription, "fat_loss")
    finisher.priority = 2.5
    expect(finisher.minSets).toBe(3)
    // Far over: every support set and rest reaches its floor and no finisher round has gone yet.
    const fixed = fixedFor(slots, 64)
    const trimmed = trimSupportFirst(slots, fixed, 45, "fat_loss")
    expect(trimmed).toHaveLength(6)
    expect(setsOf(trimmed, "burpee")).toBe(4)
    for (const f of trimmed.filter((x) => x.slot.role === "isolation" || x.slot.role === "accessory")) {
      expect(f.slot.sets, f.exercise.id).toBe(2)
      expect(f.slot.restSeconds - 15, f.exercise.id).toBeLessThan(f.minRest)
    }
    // The fitter then takes rounds only down to the floor, and drops support slots before the block.
    const kept = fitToDuration(trimmed, fixed, 45, "fat_loss")
    expect(setsOf(kept, "burpee")).toBeGreaterThanOrEqual(3)
    expect(kept.some((f) => f.exercise.id === "dumbbell-curl")).toBe(false)
    expect(kept.some((f) => f.exercise.id === "burpee")).toBe(true)
  })

  it("a strength plan still trims its filler finisher first (R01)", () => {
    const slots = [
      fittableOf({ id: "barbell-back-squat", role: "primary_compound", sets: 4, priority: 1, rest: 180, reps: [4, 6] }),
      fittableOf({ id: "lying-leg-curl", role: "isolation", sets: 3, priority: 4, rest: 60 }),
      fittableOf({ id: "burpee", role: "finisher", sets: 4, priority: 99, durationSeconds: 30, rest: 30, minSets: 1 }),
    ]
    const fixed = 30 * 60 * FIT_CEILING - slots.reduce((sum, f) => sum + estimateSlotSeconds(f.slot, f.exercise), 0) + 30
    const kept = trimSupportFirst(slots, fixed, 30, "strength")
    expect(setsOf(kept, "burpee")).toBe(3)
    expect(setsOf(kept, "lying-leg-curl")).toBe(3)
    expect(finisherFloor(slots[2]!.exercise, { sets: 4, minSets: 1 } as Prescription, "strength")).toBe(1)
  })

  it("within a role, isolation or unloaded work gives up a set before a loaded compound (R22)", () => {
    const tRaise = makeExercise({ id: "prone-t-raise", category: "shoulders", primary: "rear_delts", pattern: "horizontal_pull", mechanics: "isolation", equipment: ["bodyweight"], loadType: "bodyweight", reps: [10, 15], rest: [30, 45] })
    const exercises = new Map([...FIXTURE_BY_ID, [tRaise.id, tRaise]])
    const day = (rowSets: number) => [
      fittableOf({ id: "barbell-back-squat", role: "primary_compound", sets: 3, priority: 1, rest: 180, reps: [4, 6] }),
      // The day's only loaded pull comes first in the plan and has the higher priority.
      fittableOf({ id: "single-arm-dumbbell-row", role: "accessory", sets: rowSets, priority: 3, rest: 90 }, exercises),
      fittableOf({ id: "prone-t-raise", role: "accessory", sets: 3, priority: 5, rest: 60 }, exercises),
    ]
    for (const rowSets of [3, 4]) {
      const slots = day(rowSets)
      // One set over the ceiling.
      const fixed = 45 * 60 * FIT_CEILING - slots.reduce((sum, f) => sum + estimateSlotSeconds(f.slot, f.exercise), 0) + 20
      const kept = trimSupportFirst(slots, fixed, 45, "strength")
      expect(setsOf(kept, "prone-t-raise"), `row at ${rowSets} sets`).toBe(2)
      expect(setsOf(kept, "single-arm-dumbbell-row"), `row at ${rowSets} sets`).toBe(rowSets)
    }
    // Two loaded accessories: the lower-priority slot gives first.
    const loaded = [
      fittableOf({ id: "single-arm-dumbbell-row", role: "accessory", sets: 3, priority: 3, rest: 90 }),
      fittableOf({ id: "goblet-squat", role: "accessory", sets: 3, priority: 6, rest: 90 }),
    ]
    const fixed = 45 * 60 * FIT_CEILING - loaded.reduce((sum, f) => sum + estimateSlotSeconds(f.slot, f.exercise), 0) + 20
    const kept = trimSupportFirst(loaded, fixed, 45, "muscle_gain")
    expect(setsOf(kept, "goblet-squat")).toBe(2)
    expect(setsOf(kept, "single-arm-dumbbell-row")).toBe(3)
  })

  it("endurance sessions keep their lifting within the cap and the conditioning block sized to the rest (R17)", () => {
    for (const experience of ["beginner", "intermediate", "advanced"] as const) {
      for (const days of [2, 3, 4, 5, 6] as TrainingDays[]) {
        for (const duration of [30, 45, 60, 75] as DurationPreference[]) {
          const profile = makeProfile({ goal: "endurance", experience, trainingDaysPerWeek: days, durationPreferenceMinutes: duration })
          const w = generateWorkout(makeInput(profile), lib)
          const label = `${experience} ${days}d ${duration}m ${w.title}`
          // Core spec C03: a protected core day's trunk work does not count against the lifting cap.
          const lifts = main(w).filter((e) => e.role !== "finisher" && FIXTURE_BY_ID.get(e.exerciseId)!.category !== "core")
          expect(lifts.length, label).toBeLessThanOrEqual(liftingSlotCap(duration, "endurance"))
          expect(main(w).filter((e) => e.role !== "finisher").length, label).toBeLessThanOrEqual(liftingSlotCap(duration, "endurance") + 1)
          expect(main(w).some((e) => e.role === "finisher"), label).toBe(true)
        }
      }
    }
  })

  it("only low-frequency conditioning plans short of aerobic work get the off-day note (R17)", () => {
    const noted = (w: Workout) => (w.notes ?? []).some((n) => n.startsWith("Aerobic activity:") && /WHO adult guidance \(2020\)/.test(n))
    for (const goal of ["fat_loss", "general_fitness", "endurance", "strength", "muscle_gain"] as Goal[]) {
      for (const days of [2, 3, 4] as TrainingDays[]) {
        const profile = makeProfile({ goal, trainingDaysPerWeek: days, durationPreferenceMinutes: 30 })
        const w = generateWorkout(makeInput(profile), lib)
        const minutes =
          main(w)
            .filter((e) => e.role === "finisher")
            .reduce((sum, e) => sum + e.sets * (e.durationSeconds ?? 0), 0) / 60
        const expected = days <= 3 && goal !== "strength" && goal !== "muscle_gain" && minutes < AEROBIC_NOTE_MINUTES
        expect(noted(w), `${goal} ${days}d: ${minutes} min`).toBe(expected)
      }
    }
    // A week that already holds enough conditioning is not nagged.
    const profile = makeProfile({ goal: "fat_loss", trainingDaysPerWeek: 3, durationPreferenceMinutes: 30 })
    const first = generateWorkout(makeInput(profile, "2026-10-05"), lib)
    const cardio = completeAtTop(first, (id) => FIXTURE_BY_ID.get(id))
    const long = {
      ...cardio,
      exercises: cardio.exercises.map((e) => (e.role === "finisher" ? { ...e, sets: e.sets.map((s) => ({ ...s, durationSeconds: 900 })) } : e)),
    }
    const w = generateWorkout(makeInput(profile, "2026-10-07", [long], progressFromHistory([long])), lib)
    expect(noted(w)).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// Core programming spec (C02, C03, C04, C14, C16) against the real library.
// ---------------------------------------------------------------------------------------------

describe("core programming (core spec, real library)", () => {
  const mainOf = (w: Workout) => w.exercises.filter((e) => e.phase === "main")
  const exOf = (e: WorkoutExercise) => getExercise(e.exerciseId)!
  const isTrunk = (e: WorkoutExercise) => e.role !== "finisher" && exOf(e).category === "core" && !exOf(e).tags?.includes("conditioning")
  const compoundSets = (w: Workout) =>
    mainOf(w)
      .filter((e) => e.role === "primary_compound" || e.role === "secondary_compound")
      .map((e) => `${e.exerciseId}:${e.sets}`)
  /** The plan's sessions on the audit schedule from Monday 2026-10-05 until `title` comes up. */
  const WEEK: Record<TrainingDays, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] }
  function dayOf(profile: ReturnType<typeof makeProfile>, title: string) {
    const history: CompletedWorkout[] = []
    for (let week = 0; week < 3; week++) {
      for (const offset of WEEK[profile.trainingDaysPerWeek]) {
        const input = makeInput(profile, addDays("2026-10-05", week * 7 + offset), [...history].reverse(), progressFromHistory(history))
        const w = generateWorkout(input)
        if (w.title === title) return { input, w, history }
        history.push(completeAtTop(w, getExercise, 40, { loads: "calibrated", lifter: profile }))
      }
    }
    throw new Error(`${title} never came up`)
  }

  it("C02: the catch-up protects core on a 4-day plan's Upper A after four days without trunk work", () => {
    const profile = makeProfile({ goal: "strength", experience: "intermediate", trainingDaysPerWeek: 4, durationPreferenceMinutes: 60 })
    const history = [
      logged("2026-10-09", "Lower B", "lower", [{ id: "conventional-deadlift", role: "primary_compound", sets: 4 }, { id: "bulgarian-split-squat", role: "secondary_compound", sets: 3 }]),
      logged("2026-10-08", "Upper B", "upper", [{ id: "bent-over-barbell-row", role: "primary_compound", sets: 4 }, { id: "barbell-bench-press", role: "secondary_compound", sets: 3 }]),
      logged("2026-10-06", "Lower A", "lower", [{ id: "barbell-back-squat", role: "primary_compound", sets: 4 }, { id: "plank", role: "accessory", sets: 3 }]),
    ]
    const exposure = { sessionsLast7: 1, daysSinceCore: 6, sessionsInWindow: 3 }
    expect(coreCatchUpDue(exposure)).toBe(true)
    expect(coreCatchUpDue({ ...exposure, daysSinceCore: 3 })).toBe(false)
    expect(coreCatchUpDue({ ...exposure, sessionsLast7: 2 })).toBe(false)
    expect(coreCatchUpDue({ sessionsLast7: 0, daysSinceCore: null, sessionsInWindow: 2 })).toBe(true)
    expect(coreCatchUpDue({ sessionsLast7: 0, daysSinceCore: null, sessionsInWindow: 1 })).toBe(false)
    const w = generateWorkout(makeInput(profile, "2026-10-12", history))
    expect(w.title).toBe("Upper A")
    expect(mainOf(w).some(isTrunk), mainOf(w).map((e) => e.exerciseId).join(",")).toBe(true)
  })

  it("C02: a 6-day plan at its most core days gives a non-designated day no core, at the same size", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "intermediate", trainingDaysPerWeek: 6, durationPreferenceMinutes: 75 })
    const week = (legsCore: boolean) => [
      logged("2026-10-10", "Legs B", "legs", [{ id: "romanian-deadlift", role: "primary_compound", sets: 3 }, { id: "plank", role: "accessory", sets: 2 }]),
      logged("2026-10-09", "Pull B", "pull", [{ id: "bent-over-barbell-row", role: "primary_compound", sets: 3 }]),
      logged("2026-10-08", "Push B", "push", [{ id: "overhead-press", role: "primary_compound", sets: 3 }, { id: "dead-bug", role: "accessory", sets: 2 }]),
      logged("2026-10-07", "Legs", "legs", [{ id: "barbell-back-squat", role: "primary_compound", sets: 3 }, ...(legsCore ? [{ id: "cable-crunch", role: "accessory" as const, sets: 2 }] : [])]),
      logged("2026-10-06", "Pull", "pull", [{ id: "lat-pulldown", role: "primary_compound", sets: 3 }, { id: "pallof-press", role: "accessory", sets: 2 }]),
    ]
    expect(MAX_CORE_DAYS[6]).toBe(4)
    const capped = generateWorkout(makeInput(profile, "2026-10-12", week(true)))
    const open = generateWorkout(makeInput(profile, "2026-10-12", week(false)))
    expect(capped.title).toBe("Push")
    expect(mainOf(capped).some(isTrunk), mainOf(capped).map((e) => e.exerciseId).join(",")).toBe(false)
    expect(mainOf(open).some(isTrunk)).toBe(true)
    expect(mainOf(capped).length).toBe(mainOf(open).length)
  })

  it("C03 (a): a 30-minute strength Lower A gets core without losing a compound set", () => {
    const profile = makeProfile({ goal: "strength", experience: "intermediate", trainingDaysPerWeek: 4, durationPreferenceMinutes: 30 })
    const { input, w } = dayOf(profile, "Lower A")
    const off = generateWorkout(input, undefined, { coreProtection: false })
    expect(mainOf(w).some(isTrunk), mainOf(w).map((e) => e.exerciseId).join(",")).toBe(true)
    expect(compoundSets(w)).toEqual(compoundSets(off))
    expect(w.estimatedMinutes).toBeLessThanOrEqual(Math.round(30 * FIT_CEILING))
  })

  it("C03 (b): a 30-minute Upper B (four compounds, no isolation) only gets core with time to spare", () => {
    for (const goal of ["strength", "muscle_gain", "general_fitness"] as Goal[]) {
      const profile = makeProfile({ goal, experience: "intermediate", trainingDaysPerWeek: 4, durationPreferenceMinutes: 30 })
      // Two sessions this week without trunk work: the catch-up protects Upper B.
      const history = [
        logged("2026-10-06", "Lower A", "lower", [{ id: "barbell-back-squat", role: "primary_compound", sets: 3 }]),
        logged("2026-10-05", "Upper A", "upper", [{ id: "barbell-bench-press", role: "primary_compound", sets: 3 }, { id: "lat-pulldown", role: "secondary_compound", sets: 3 }]),
      ]
      const input = makeInput(profile, "2026-10-08", history)
      const w = generateWorkout(input)
      const off = generateWorkout(input, undefined, { coreProtection: false })
      expect(w.title).toBe("Upper B")
      expect(mainOf(off).some((e) => e.role === "isolation")).toBe(false)
      expect(compoundSets(w), goal).toEqual(compoundSets(off))
      if (mainOf(w).some(isTrunk)) expect(w.estimatedMinutes, goal).toBeLessThanOrEqual(Math.round(30 * FIT_CEILING))
      else expect(mainOf(w).map((e) => e.exerciseId)).toEqual(mainOf(off).map((e) => e.exerciseId))
    }
  })

  it("C03 (c): a 30-minute hypertrophy push day keeps its presses, and its delt isolation unless core needs the time", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "intermediate", trainingDaysPerWeek: 6, durationPreferenceMinutes: 30 })
    // Two sessions in the window without trunk work: the catch-up protects Push.
    const history = [
      logged("2026-10-10", "Legs B", "legs", [{ id: "romanian-deadlift", role: "primary_compound", sets: 3 }]),
      logged("2026-10-09", "Pull B", "pull", [{ id: "bent-over-barbell-row", role: "primary_compound", sets: 3 }]),
    ]
    const input = makeInput(profile, "2026-10-12", history)
    const w = generateWorkout(input)
    const off = generateWorkout(input, undefined, { coreProtection: false })
    expect(w.title).toBe("Push")
    expect(mainOf(w).some(isTrunk)).toBe(true)
    const presses = (x: Workout) => mainOf(x).filter((e) => e.role !== "isolation" && exOf(e).mechanics === "compound" && ["horizontal_push", "vertical_push"].includes(exOf(e).movementPattern))
    expect(presses(w).map((e) => e.exerciseId)).toEqual(presses(off).map((e) => e.exerciseId))
    expect(presses(w).length).toBeGreaterThanOrEqual(3)
    expect(compoundSets(w)).toEqual(compoundSets(off))
    expect(w.estimatedMinutes).toBeLessThanOrEqual(Math.round(30 * FIT_CEILING))
    // The compounds are already at their 2-set floor without core, so core costs them nothing and
    // the lateral raise stays; were they not, the raise (never the day's only pull) would make way.
    const delts = (x: Workout) => mainOf(x).filter((e) => e.role === "isolation" && exOf(e).movementPattern === "shoulder_abduction")
    expect(delts(off).length).toBe(1)
    expect(delts(w).length).toBeLessThanOrEqual(1)
  })

  it("C03: when time is short the lowest-priority isolation makes way, never a compound or the only pull", () => {
    const profile = makeProfile({ goal: "strength", experience: "intermediate", trainingDaysPerWeek: 4, durationPreferenceMinutes: 30 })
    const { input, w } = dayOf(profile, "Lower A")
    const off = generateWorkout(input, undefined, { coreProtection: false })
    const isolations = (x: Workout) => mainOf(x).filter((e) => e.role === "isolation").map((e) => e.exerciseId)
    expect(mainOf(w).some(isTrunk)).toBe(true)
    expect(compoundSets(w)).toEqual(compoundSets(off))
    // Week one's Lower A has no time to spare: its hamstring isolation went for the core block.
    expect(isolations(off).length).toBe(1)
    expect(isolations(w)).toEqual([])
    expect(mainOf(w).filter((e) => e.role !== "isolation" && !isTrunk(e)).map((e) => e.exerciseId)).toEqual(
      mainOf(off).filter((e) => e.role !== "isolation").map((e) => e.exerciseId),
    )
  })

  it("C03 (d): a 30-minute endurance Full body A keeps its conditioning block at its minimum with core in", () => {
    const profile = makeProfile({ goal: "endurance", experience: "intermediate", equipmentPreset: "dumbbells", trainingDaysPerWeek: 3, durationPreferenceMinutes: 30 })
    const input = makeInput(profile, "2026-10-05")
    const w = generateWorkout(input)
    expect(w.title).toBe("Full body A")
    expect(mainOf(w).some(isTrunk), mainOf(w).map((e) => e.exerciseId).join(",")).toBe(true)
    const block = mainOf(w).find((e) => e.role === "finisher")!
    expect(block.sets).toBeGreaterThanOrEqual(exOf(block).setsRange[0])
    expect(w.estimatedMinutes).toBeLessThanOrEqual(Math.round(30 * FIT_CEILING))
    expect(compoundSets(w)).toEqual(compoundSets(generateWorkout(input, undefined, { coreProtection: false })))
    // Where the lifts and the block already fill the session, core waits for the catch-up rather
    // than costing a compound set.
    for (const preset of ["full_gym", "home_gym", "bodyweight"] as const) {
      const other = makeProfile({ goal: "endurance", experience: "intermediate", equipmentPreset: preset, trainingDaysPerWeek: 3, durationPreferenceMinutes: 30 })
      const day = makeInput(other, "2026-10-05")
      const on = generateWorkout(day)
      expect(compoundSets(on), preset).toEqual(compoundSets(generateWorkout(day, undefined, { coreProtection: false })))
      const minimum = mainOf(on).find((e) => e.role === "finisher")!
      expect(minimum.sets, preset).toBeGreaterThanOrEqual(exOf(minimum).setsRange[0])
    }
  })

  it("C04: a six-day push/pull/legs plan splits an advanced hypertrophy core cap of 12 over 3 core days", () => {
    const rotation = rotationFor(6, "advanced", "muscle_gain")
    expect(sessionBudgets(rotation, 18, { cap: coreWeeklyCap("muscle_gain", "advanced"), days: CORE_DAYS_TARGET[6] }).get("core")).toBe(4)
    expect(sessionBudgets(rotation, 10, { cap: coreWeeklyCap("strength", "beginner"), days: CORE_DAYS_TARGET[2] }).get("core")).toBe(3)
  })

  it("C14: anti-movement trunk work carries the position-stop cue, and a loaded Pallof press still progresses", () => {
    const beginner = makeProfile({ goal: "general_fitness", experience: "beginner", trainingDaysPerWeek: 2, durationPreferenceMinutes: 45, preferredExerciseIds: ["dead-bug"] })
    const bug = mainOf(generateWorkout(makeInput(beginner, "2026-10-05"))).find((e) => e.exerciseId === "dead-bug")!
    expect(bug.rir).toBeNull()
    expect(bug.note).toContain("before your position slips")
    expect(bug.note).toContain("2-3 reps")
    const lifter = makeProfile({ goal: "strength", experience: "intermediate", trainingDaysPerWeek: 2, durationPreferenceMinutes: 60, preferredExerciseIds: ["pallof-press"] })
    const first = generateWorkout(makeInput(lifter, "2026-10-05"))
    const pallof = mainOf(first).find((e) => e.exerciseId === "pallof-press")!
    expect(pallof.rir).toBeNull()
    expect(pallof.note).toMatch(/^Find your working weight: the first set sets the weight/)
    expect(pallof.note).toContain("without losing position")
    const done = completeAtTop(first, getExercise, 40)
    const logged = done.exercises.find((e) => e.exerciseId === "pallof-press")!.sets[0]!.weightKg!
    expect(logged).toBe(40)
    const next = mainOf(generateWorkout(makeInput(lifter, "2026-10-08", [done], progressFromHistory([done])))).find((e) => e.exerciseId === "pallof-press")!
    expect(next.recommendedWeightKg).toBeGreaterThan(logged)
    expect(next.note).toContain("before your position slips")
  })

  it("C16: a 30-minute session's trunk work is 2 sets, one-sided holds at most 30 s and one-sided reps at most 8", () => {
    const check = (favourite: string, goal: Goal, experience: Experience) => {
      // Full body B, whose core slot is in its first three, at thirty minutes.
      const profile = makeProfile({ goal, experience, trainingDaysPerWeek: 2, durationPreferenceMinutes: 30, preferredExerciseIds: [favourite] })
      const { w } = dayOf(profile, "Full body B")
      for (const e of mainOf(w).filter(isTrunk)) expect(e.sets, `${favourite} ${e.exerciseId}`).toBe(2)
      return mainOf(w).find((e) => e.exerciseId === favourite)
    }
    const plank = check("side-plank", "general_fitness", "advanced")!
    expect(plank.durationSeconds).toBeLessThanOrEqual(30)
    const pallof = check("pallof-press", "muscle_gain", "intermediate")!
    expect(pallof.reps![1]).toBeLessThanOrEqual(8)
    for (const goal of ["strength", "muscle_gain", "fat_loss", "general_fitness", "endurance"] as Goal[]) {
      for (const days of [2, 3, 4, 5, 6] as TrainingDays[]) {
        const profile = makeProfile({ goal, experience: "intermediate", trainingDaysPerWeek: days, durationPreferenceMinutes: 30 })
        const history: CompletedWorkout[] = []
        for (const offset of WEEK[days]) {
          const w = generateWorkout(makeInput(profile, addDays("2026-10-05", offset), [...history].reverse(), progressFromHistory(history)))
          for (const e of mainOf(w).filter(isTrunk)) expect(e.sets, `${goal} ${days}d ${w.title} ${e.exerciseId}`).toBe(2)
          history.push(completeAtTop(w, getExercise, 40, { loads: "calibrated", lifter: profile }))
        }
      }
    }
  })
})
