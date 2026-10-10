/**
 * Cool-down rules from the round-1 coach review (F26): stretch what the session trained, one
 * stretch per group, main lifts first; targeted correctives are never picked automatically.
 */
import { describe, expect, it } from "vitest"
import { EXERCISES, getExercise, muscleGroupOf, requireExercise } from "@/lib/exercises"
import type { Exercise, Goal, MuscleGroup } from "@/lib/exercises/types"
import { EQUIPMENT_PRESETS } from "@/lib/domain/types"
import type { CompletedWorkout, EquipmentPreset, Experience, TrainingDays, UserProfile } from "@/lib/domain/types"
import { addDays } from "@/lib/dates"
import { estimateSlotSeconds, estimateWorkSeconds } from "./duration"
import { generateWorkout } from "./generate"
import { prescribeLight } from "./prescriptions"
import { createRng } from "./random"
import { completeAtTop, makeInput, makeProfile, progressFromHistory } from "./test-fixtures"
import { buildCooldown, isBreathing, isStretch, prescribeCooldownItem, SHORT_BREATHING_SECONDS } from "./cooldown"
import { passesProfileFilter } from "./selection"
import { CORRECTIVE_TAG, forGroups, isCorrective } from "./warmup"
import type { Workout } from "./types"

const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1)
const FULL_A: MuscleGroup[] = ["full_body", "quads", "chest", "back"]
const ex = requireExercise

function stretchesOf(items: ReturnType<typeof buildCooldown>): Exercise[] {
  return items.map((i) => i.exercise).filter((e) => !isBreathing(e))
}

let generatedWeek: { profile: UserProfile; workout: Workout }[] | null = null

/** One week of generated sessions per profile across goals, levels, presets and frequencies (generated once per file). */
function weekOfWorkouts(): { profile: UserProfile; workout: Workout }[] {
  generatedWeek ??= generateWeek()
  return generatedWeek
}

function generateWeek(): { profile: UserProfile; workout: Workout }[] {
  const goals: Goal[] = ["muscle_gain", "strength", "fat_loss", "general_fitness", "endurance"]
  const levels: Experience[] = ["beginner", "intermediate", "advanced"]
  const presets: Exclude<EquipmentPreset, "custom">[] = ["full_gym", "dumbbells", "home_gym", "bodyweight"]
  const frequencies: TrainingDays[] = [2, 3, 4, 6]
  const out: { profile: UserProfile; workout: Workout }[] = []
  for (const goal of goals)
    for (const experience of levels)
      for (const preset of presets)
        for (const days of frequencies) {
          const profile = makeProfile({
            id: `cool-${goal}-${experience}-${preset}-${days}`,
            goal,
            experience,
            equipmentPreset: preset,
            equipment: EQUIPMENT_PRESETS[preset],
            trainingDaysPerWeek: days,
            durationPreferenceMinutes: preset === "full_gym" ? 60 : 45,
          })
          const history: CompletedWorkout[] = []
          for (let d = 0; d < days; d++) {
            const input = makeInput(profile, addDays("2026-10-05", d), history.slice(), progressFromHistory(history))
            const workout = generateWorkout(input)
            history.unshift(completeAtTop(workout, getExercise, 40))
            out.push({ profile, workout })
          }
        }
  return out
}

function cooldownOf(w: Workout): Exercise[] {
  return w.exercises
    .filter((e) => e.phase === "cooldown")
    .map((e) => getExercise(e.exerciseId)!)
    .filter((e) => !isBreathing(e))
}

describe("generated cool-downs stretch what was trained", () => {
  const sessions = weekOfWorkouts()

  it("every session whose primary compound loads the quads has a quad or hip-flexor stretch", () => {
    let checked = 0
    for (const { profile, workout } of sessions) {
      const primary = workout.exercises.find((e) => e.role === "primary_compound")
      if (!primary || muscleGroupOf(getExercise(primary.exerciseId)!) !== "quads" || profile.limitations.includes("knee")) continue
      checked++
      const cool = cooldownOf(workout)
      expect(
        cool.some((e) => muscleGroupOf(e) === "quads" || e.primaryMuscle === "hip_flexors"),
        `${profile.id} ${workout.title}: ${cool.map((e) => e.id)}`,
      ).toBe(true)
    }
    expect(checked).toBeGreaterThan(20)
  })

  it("no cool-down holds two stretches from the same group", () => {
    // fatloss-b-d1: lat-stretch and upper-trap-stretch (both back) passed a primaryMuscle check.
    for (const { profile, workout } of sessions) {
      const groups = cooldownOf(workout).map(muscleGroupOf)
      expect(new Set(groups).size, `${profile.id} ${workout.title}: ${groups}`).toBe(groups.length)
    }
  })

  it("sleeper-stretch never appears automatically", () => {
    // hypertrophy-b-d7 / hypertrophy-i-d1: a targeted corrective closed default upper days.
    for (const { profile, workout } of sessions) {
      expect(workout.exercises.map((e) => e.exerciseId), `${profile.id} ${workout.title}`).not.toContain("sleeper-stretch")
    }
  })
})

describe("buildCooldown", () => {
  const profile = makeProfile({ experience: "beginner", equipmentPreset: "bodyweight", equipment: EQUIPMENT_PRESETS.bodyweight, durationPreferenceMinutes: 60 })

  it("a focus group with no sets today gets no stretch", () => {
    // endurance-b-d7 / fatloss-b-d7: a squat-only full-body day closed with chest and back stretches.
    const main = [ex("bodyweight-squat"), ex("crunch")]
    for (const seed of SEEDS) {
      const items = buildCooldown({ pool: EXERCISES, profile, focus: FULL_A, trained: ["quads", "core"], main, rng: createRng(seed) })
      const groups = stretchesOf(items).map(muscleGroupOf)
      expect(groups, `seed ${seed}`).toContain("quads")
      expect(groups, `seed ${seed}`).not.toContain("chest")
      expect(groups, `seed ${seed}`).not.toContain("back")
    }
  })

  it("stretches each main lift's group first, stand-in compounds included", () => {
    // hypertrophy-b-d7: the RDL stood in as an accessory and the hamstrings got no stretch.
    const main = [ex("bodyweight-squat"), ex("knee-push-up"), ex("bodyweight-single-leg-rdl"), ex("crunch")]
    for (const seed of SEEDS) {
      const items = buildCooldown({ pool: EXERCISES, profile: { ...profile, durationPreferenceMinutes: 45 }, focus: FULL_A, heavy: ["quads", "chest"], main, rng: createRng(seed) })
      const groups = stretchesOf(items).map(muscleGroupOf)
      expect(groups, `seed ${seed}`).toEqual(["quads", "chest", "hamstrings"])
    }
  })

  it("prefers the stretch for the muscle the lift loaded, one per group", () => {
    // lat pulldown and row load the lats and upper back: the back gets one stretch, the lat stretch.
    const gym = makeProfile({ experience: "intermediate", durationPreferenceMinutes: 60 })
    const main = [ex("lat-pulldown"), ex("single-arm-dumbbell-row")]
    for (const seed of SEEDS) {
      const items = buildCooldown({ pool: EXERCISES, profile: gym, focus: ["back", "biceps"], main, rng: createRng(seed) })
      const stretches = stretchesOf(items)
      const back = stretches.filter((e) => muscleGroupOf(e) === "back")
      expect(back.map((e) => e.id), `seed ${seed}`).toEqual(["lat-stretch"])
    }
  })

  it("never picks a corrective stretch automatically", () => {
    // hypertrophy-i-d1: the sleeper stretch closed a default upper day.
    expect(isCorrective(ex("sleeper-stretch"))).toBe(true)
    const gym = makeProfile({ experience: "intermediate", durationPreferenceMinutes: 60 })
    const main = [ex("dumbbell-bench-press"), ex("seated-dumbbell-shoulder-press"), ex("lat-pulldown")]
    for (const seed of SEEDS) {
      const ids = buildCooldown({ pool: EXERCISES, profile: gym, focus: ["chest", "back", "shoulders"], main, rng: createRng(seed) }).map((i) => i.exercise.id)
      expect(ids).not.toContain("sleeper-stretch")
      // The general posterior-shoulder stretch takes its place.
      expect(ids).toContain("cross-body-shoulder-stretch")
    }
  })

  it("the rule follows the tag, not the id", () => {
    const pool = EXERCISES.map((e) => (e.id === "cross-body-shoulder-stretch" ? { ...e, tags: [...(e.tags ?? []), CORRECTIVE_TAG] } : e))
    const gym = makeProfile({ experience: "intermediate", durationPreferenceMinutes: 60 })
    const main = [ex("dumbbell-bench-press"), ex("seated-dumbbell-shoulder-press")]
    for (const seed of SEEDS) {
      const ids = buildCooldown({ pool, profile: gym, focus: ["chest", "shoulders", "triceps"], main, rng: createRng(seed) }).map((i) => i.exercise.id)
      expect(ids).not.toContain("cross-body-shoulder-stretch")
    }
  })

  it("keeps two stretches when a limitation leaves one relevant group", () => {
    // Shoulder-limited push day: every chest stretch is excluded, so trunk stretches that open the
    // chest beat an unrelated one, which only fills in to reach two.
    // Round 2 (R15): cobra-stretch now lists the shoulder, so the count of chest-opening stretches
    // left is read from the library instead of assumed to be two.
    const limited = makeProfile({ limitations: ["shoulder"], durationPreferenceMinutes: 30 })
    const opensChest = (e: Exercise) => (e.tags ?? []).includes("for:chest")
    const available = EXERCISES.filter((e) => isStretch(e) && opensChest(e) && !isCorrective(e) && passesProfileFilter(e, limited)).length
    expect(available).toBeGreaterThanOrEqual(1)
    for (const seed of SEEDS) {
      const items = buildCooldown({ pool: EXERCISES, profile: limited, focus: ["chest", "shoulders", "triceps"], trained: ["chest"], rng: createRng(seed) })
      const stretches = stretchesOf(items)
      expect(stretches.length, `seed ${seed}`).toBeGreaterThanOrEqual(2)
      for (const e of stretches) expect(e.contraindications).not.toContain("shoulder")
      const relevant = Math.min(2, available)
      expect(stretches.slice(0, relevant).every(opensChest), `seed ${seed}: ${stretches.map((e) => e.id)}`).toBe(true)
    }
  })

  it("is deterministic for the same input and seed", () => {
    const main = [ex("bodyweight-squat"), ex("knee-push-up"), ex("crunch")]
    const run = () => buildCooldown({ pool: EXERCISES, profile, focus: FULL_A, main, rng: createRng(9) }).map((i) => i.exercise.id)
    expect(run()).toEqual(run())
  })
})

/** Seconds the cool-down adds to the session estimate. */
function cooldownSeconds(items: ReturnType<typeof buildCooldown>): number {
  return items.reduce((sum, i) => sum + estimateWorkSeconds(i.prescription, "cooldown", "cooldown", i.exercise), 0)
}

describe("cool-down length (coach round 2, R18)", () => {
  const gym = makeProfile({ experience: "intermediate", durationPreferenceMinutes: 60 })
  const days: [MuscleGroup[], Exercise[]][] = [
    [["quads", "hamstrings", "glutes"], [ex("barbell-back-squat"), ex("romanian-deadlift"), ex("seated-leg-curl"), ex("leg-press")]],
    [["chest", "back", "shoulders"], [ex("dumbbell-bench-press"), ex("lat-pulldown"), ex("seated-dumbbell-shoulder-press")]],
    [["full_body", "quads", "chest", "back"], [ex("goblet-squat"), ex("dumbbell-bench-press"), ex("single-arm-dumbbell-row")]],
    [["hamstrings", "glutes", "back"], [ex("lying-leg-curl"), ex("seated-leg-curl"), ex("lat-pulldown")]],
  ]

  it("a 60-minute cool-down is about five minutes: three stretches at the bottom of their range", () => {
    // hypertrophy-i-d1/d7, strength-i-lb-d7: 8.5–9.3 minutes of fixed cool-down at 60 minutes cut
    // working sets (an overhead press set, the week's triceps work) instead.
    for (const minutes of [45, 60] as const) {
      for (const [focus, main] of days) {
        for (const seed of SEEDS) {
          const items = buildCooldown({ pool: EXERCISES, profile: { ...gym, durationPreferenceMinutes: minutes }, focus, main, rng: createRng(seed) })
          const label = `${minutes} min ${focus} seed ${seed}: ${items.map((i) => `${i.exercise.id}:${i.prescription.durationSeconds}`)}`
          expect(cooldownSeconds(items), label).toBeLessThanOrEqual(330)
          const stretches = items.filter((i) => !isBreathing(i.exercise))
          expect(stretches.length, label).toBe(3)
          for (const s of stretches) expect(s.prescription.durationSeconds, label).toBe(s.exercise.durationRange![0])
          const breathing = items.filter((i) => isBreathing(i.exercise))
          expect(breathing.length, label).toBe(1)
          expect(breathing[0]!.prescription.durationSeconds).toBe(SHORT_BREATHING_SECONDS)
        }
      }
    }
  })

  it("longer sessions, and a cool-down extended to fill a short session, keep the longer holds", () => {
    const [focus, main] = days[0]!
    for (const seed of SEEDS) {
      const long = buildCooldown({ pool: EXERCISES, profile: { ...gym, durationPreferenceMinutes: 75 }, focus, main, rng: createRng(seed) })
      expect(long.filter((i) => !isBreathing(i.exercise)).length).toBe(4)
      const short = buildCooldown({ pool: EXERCISES, profile: gym, focus, main, rng: createRng(seed) })
      const extended = buildCooldown({ pool: EXERCISES, profile: gym, focus, main, extended: true, rng: createRng(seed) })
      expect(extended.filter((i) => !isBreathing(i.exercise)).length).toBe(4)
      expect(cooldownSeconds(extended)).toBeGreaterThan(cooldownSeconds(short))
      for (const item of extended) expect(item.prescription).toEqual(prescribeLight(item.exercise, 60))
    }
    // A swap gets the builder's prescription.
    const stretch = ex("standing-hamstring-stretch")
    expect(prescribeCooldownItem(stretch, 60).durationSeconds).toBe(stretch.durationRange![0])
    expect(prescribeCooldownItem(stretch, 75)).toEqual(prescribeLight(stretch, 75))
  })

  it("generated 60-minute sessions keep the cool-down at or under 330 s", () => {
    let checked = 0
    for (const { profile, workout } of weekOfWorkouts()) {
      if (profile.durationPreferenceMinutes !== 60) continue
      const cool = workout.exercises.filter((e) => e.phase === "cooldown")
      const seconds = cool.reduce((sum, e) => sum + estimateSlotSeconds(e, getExercise(e.exerciseId)), 0)
      // A session whose main work cannot fill the hour may extend it (CooldownOptions.extended).
      if (cool.filter((e) => !isBreathing(getExercise(e.exerciseId)!)).length > 3) continue
      checked++
      expect(seconds, `${profile.id} ${workout.title}: ${cool.map((e) => e.exerciseId)}`).toBeLessThanOrEqual(330)
    }
    expect(checked).toBeGreaterThan(20)
  })
})

describe("cool-down groups (coach round 2, R25 and R15)", () => {
  it("never holds more than one neck or upper-trap stretch, and a back stretch takes the other place", () => {
    // general-i-shoulder-d7: the shoulder flag ruled out the lat and rear-delt stretches; the
    // upper-trap stretch filled the back, and the levator scapulae stretch filled the shoulders
    // through a tag-only fallback, so two neck stretches closed the day and child's pose did not.
    const flagged = makeProfile({ experience: "intermediate", equipmentPreset: "home_gym", equipment: EQUIPMENT_PRESETS.home_gym, limitations: ["shoulder"], durationPreferenceMinutes: 45 })
    for (const seed of SEEDS) {
      const items = buildCooldown({ pool: EXERCISES, profile: flagged, focus: ["chest", "back", "shoulders"], trained: ["chest", "back", "shoulders"], rng: createRng(seed) })
      const stretches = stretchesOf(items)
      const neck = stretches.filter((e) => e.primaryMuscle === "neck" || e.primaryMuscle === "traps")
      expect(neck.length, `seed ${seed}: ${stretches.map((e) => e.id)}`).toBeLessThanOrEqual(1)
      // The other place goes to a trunk stretch for the back (child's pose, a spinal twist).
      expect(stretches.some((e) => !neck.includes(e) && forGroups(e).includes("back")), `seed ${seed}: ${stretches.map((e) => e.id)}`).toBe(true)
      for (const e of stretches) expect(e.contraindications).not.toContain("shoulder")
    }
    for (const { profile, workout } of weekOfWorkouts()) {
      const neck = cooldownOf(workout).filter((e) => e.primaryMuscle === "neck" || e.primaryMuscle === "traps")
      expect(neck.length, `${profile.id} ${workout.title}`).toBeLessThanOrEqual(1)
    }
  })

  it("prefers a stretch built to spare a flagged area", () => {
    // R14: the soft limitation preference applies to the cool-down too (data tag "<area>_friendly").
    const pool = EXERCISES.map((e) => (e.id === "band-hamstring-stretch" ? { ...e, tags: [...(e.tags ?? []), "lower_back_friendly"] } : e))
    const profile = makeProfile({ experience: "intermediate", limitations: ["lower_back"], durationPreferenceMinutes: 45 })
    for (const seed of SEEDS) {
      const items = buildCooldown({ pool, profile, focus: ["hamstrings", "glutes"], main: [ex("lying-leg-curl"), ex("barbell-hip-thrust")], rng: createRng(seed) })
      const hamstrings = stretchesOf(items).filter((e) => muscleGroupOf(e) === "hamstrings")
      expect(hamstrings.map((e) => e.id), `seed ${seed}`).toEqual(["band-hamstring-stretch"])
    }
  })
})
