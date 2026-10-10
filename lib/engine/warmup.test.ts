/**
 * Warm-up rules from the round-1 coach review (F26): the warm-up follows the work the session
 * actually does, not only the template focus.
 */
import { describe, expect, it } from "vitest"
import { EXERCISES, getExercise, requireExercise } from "@/lib/exercises"
import type { Exercise, Goal, MuscleGroup } from "@/lib/exercises/types"
import { EQUIPMENT_PRESETS } from "@/lib/domain/types"
import type { CompletedWorkout, EquipmentPreset, Experience, TrainingDays, UserProfile } from "@/lib/domain/types"
import { addDays } from "@/lib/dates"
import { generateWorkout } from "./generate"
import { libraryFrom } from "./library"
import { prescribeLight } from "./prescriptions"
import { createRng } from "./random"
import { replacementCandidates } from "./replace"
import { passesProfileFilter } from "./selection"
import { completeAtTop, makeInput, makeProfile, progressFromHistory } from "./test-fixtures"
import type { Workout } from "./types"
import {
  BALLISTIC_TAG,
  buildWarmup,
  duplicatesLift,
  focusAffinity,
  forGroups,
  IMPACT_PULSE_SECONDS,
  isBracingPrimer,
  isCorrective,
  isCuffDrill,
  isDynamicDrill,
  isLightCardio,
  isLowImpact,
  LIGHT_CARDIO_TAG,
  loadsWrist,
  prescribeWarmupItem,
  sharesModality,
  wantsBracingPrimer,
} from "./warmup"

const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1)
const FULL_A: MuscleGroup[] = ["full_body", "quads", "chest", "back"]
const FULL_B: MuscleGroup[] = ["full_body", "hamstrings", "glutes", "back", "chest"]
const PUSH: MuscleGroup[] = ["chest", "shoulders", "triceps"]
const LEGS: MuscleGroup[] = ["quads", "hamstrings", "glutes"]

const ex = requireExercise

function beginner(preset: "full_gym" | "dumbbells" | "bodyweight", minutes: 30 | 45 | 60 = 45): UserProfile {
  return makeProfile({ experience: "beginner", equipmentPreset: preset, equipment: EQUIPMENT_PRESETS[preset], durationPreferenceMinutes: minutes })
}

function drillsOf(items: ReturnType<typeof buildWarmup>): Exercise[] {
  return items.map((i) => i.exercise).filter((e) => !isLightCardio(e))
}

describe("focusAffinity scores what was trained", () => {
  it("without trained groups it scores against the focus, as before", () => {
    const chest = ex("clasped-hands-chest-stretch")
    expect(focusAffinity(chest, FULL_A)).toBeGreaterThan(0)
  })

  it("a focus group with zero sets today earns nothing", () => {
    // Squat-only day on a full-body template that listed chest and back (endurance-b-d7).
    const chest = ex("clasped-hands-chest-stretch")
    const quads = ex("standing-quad-stretch")
    expect(focusAffinity(chest, FULL_A, ["quads", "core"])).toBe(0)
    expect(focusAffinity(quads, FULL_A, ["quads", "core"])).toBeGreaterThan(0)
  })

  it("a trained group scores at or above a focus group", () => {
    // Upper focus lists chest, back and shoulders; biceps were trained too.
    const upper: MuscleGroup[] = ["chest", "back", "shoulders"]
    const trained: MuscleGroup[] = ["chest", "back", "biceps"]
    const biceps = ex("bicep-wall-stretch")
    const lats = ex("lat-stretch")
    expect(focusAffinity(biceps, upper, trained)).toBeGreaterThanOrEqual(focusAffinity(lats, upper, trained))
  })
})

describe("generated warm-ups prime the main lifts", () => {
  /** One week of generated sessions per profile across goals, levels, presets and frequencies. */
  function sessions(): { profile: UserProfile; workout: Workout }[] {
    const goals: Goal[] = ["muscle_gain", "strength", "fat_loss", "general_fitness", "endurance"]
    const levels: Experience[] = ["beginner", "intermediate", "advanced"]
    const presets: Exclude<EquipmentPreset, "custom">[] = ["full_gym", "dumbbells", "home_gym", "bodyweight"]
    const out: { profile: UserProfile; workout: Workout }[] = []
    for (const goal of goals)
      for (const experience of levels)
        for (const preset of presets)
          for (const days of [2, 3, 4, 6] as TrainingDays[]) {
            const profile = makeProfile({ id: `warm-${goal}-${experience}-${preset}-${days}`, goal, experience, equipmentPreset: preset, equipment: EQUIPMENT_PRESETS[preset], trainingDaysPerWeek: days, durationPreferenceMinutes: 45 })
            const history: CompletedWorkout[] = []
            for (let d = 0; d < days; d++) {
              const workout = generateWorkout(makeInput(profile, addDays("2026-10-05", d), history.slice(), progressFromHistory(history)))
              history.unshift(completeAtTop(workout, getExercise, 40))
              out.push({ profile, workout })
            }
          }
    return out
  }

  it("a hinge-primary day's warm-up includes a hinge-pattern drill", () => {
    let checked = 0
    for (const { profile, workout } of sessions()) {
      const primary = workout.exercises.find((e) => e.role === "primary_compound")
      if (!primary || getExercise(primary.exerciseId)!.movementPattern !== "hinge") continue
      // A lower-back flag rules out every hinge primer; that day gets other hip drills instead.
      const primerAllowed = EXERCISES.some((e) => e.category === "warmup" && e.movementPattern === "hinge" && !isCorrective(e) && passesProfileFilter(e, profile))
      if (!primerAllowed) continue
      checked++
      const warm = workout.exercises.filter((e) => e.phase === "warmup").map((e) => getExercise(e.exerciseId)!)
      expect(warm.some((e) => e.movementPattern === "hinge"), `${profile.id} ${workout.title}: ${warm.map((e) => e.id)}`).toBe(true)
    }
    expect(checked).toBeGreaterThan(20)
  })
})

describe("warm-up primes each main lift's pattern", () => {
  it("a hinge-primary day's warm-up includes a hinge-pattern drill", () => {
    // general-b-d5: frog rock and butt kicks were picked before an RDL while hip-hinge-primer existed.
    const cases: [UserProfile, Exercise[]][] = [
      [beginner("full_gym"), [ex("dumbbell-romanian-deadlift"), ex("seated-cable-row"), ex("machine-chest-press")]],
      [beginner("dumbbells"), [ex("dumbbell-romanian-deadlift"), ex("single-arm-dumbbell-row"), ex("dumbbell-bench-press")]],
      [beginner("bodyweight", 30), [ex("bodyweight-single-leg-rdl"), ex("knee-push-up")]],
    ]
    for (const [profile, main] of cases) {
      for (const seed of SEEDS) {
        const items = buildWarmup({ pool: EXERCISES, profile, focus: FULL_B, heavy: ["hamstrings", "back"], main, rng: createRng(seed) })
        const hinge = drillsOf(items).filter((e) => e.movementPattern === "hinge")
        expect(hinge.length, `${profile.equipmentPreset} seed ${seed}: ${items.map((i) => i.exercise.id)}`).toBeGreaterThanOrEqual(1)
        // The lift is rehearsed (a warm-up primer), not just a mobility drill sharing its pattern.
        expect(hinge[0]!.category).toBe("warmup")
      }
    }
  })

  it("a stand-in compound gets its primer whatever slot role it filled", () => {
    // hypertrophy-b-d7: an RDL demoted to accessory left the warm-up's heavy list, so nothing primed the hinge.
    const profile = makeProfile({ experience: "intermediate", equipmentPreset: "dumbbells", equipment: EQUIPMENT_PRESETS.dumbbells, durationPreferenceMinutes: 60 })
    const main = [ex("goblet-squat"), ex("dumbbell-bench-press"), ex("dumbbell-romanian-deadlift"), ex("crunch")]
    expect(main.some(loadsWrist)).toBe(false)
    for (const seed of SEEDS) {
      // `heavy` holds only the compound-role groups, as generate passes it today.
      const items = buildWarmup({ pool: EXERCISES, profile, focus: FULL_A, heavy: ["quads", "chest"], main, rng: createRng(seed) })
      const patterns = drillsOf(items).map((e) => e.movementPattern)
      expect(patterns, `seed ${seed}`).toContain("squat")
      expect(patterns, `seed ${seed}`).toContain("horizontal_push")
      expect(patterns, `seed ${seed}`).toContain("hinge")
    }
  })

  it("two lifts of one pattern share a single primer", () => {
    const profile = beginner("full_gym", 60)
    const main = [ex("dumbbell-romanian-deadlift"), ex("bodyweight-single-leg-rdl"), ex("seated-cable-row")]
    for (const seed of SEEDS) {
      const items = buildWarmup({ pool: EXERCISES, profile, focus: FULL_B, main, rng: createRng(seed) })
      const ids = items.map((i) => i.exercise.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(drillsOf(items).filter((e) => e.movementPattern === "hinge" && e.category === "warmup").length, `seed ${seed}: ${ids}`).toBe(1)
    }
  })
})

describe("warm-up prepares the joints the main phase loads", () => {
  it("wrist-loaded main work gets one wrist drill, even in a short session", () => {
    // endurance-i-d1: handstand holds and push-ups with no wrist preparation.
    // Round 2 (R25): the primary was incline-push-up, whose "own primer" was a set of full push-ups,
    // harder than the lift it prepares. An unloaded beginner lift is now its own rehearsal (tested
    // below), so the primer-kept-alongside check uses an intermediate push-up.
    const profile = makeProfile({ experience: "intermediate", equipmentPreset: "bodyweight", equipment: EQUIPMENT_PRESETS.bodyweight, durationPreferenceMinutes: 30 })
    const main = [ex("diamond-push-up"), ex("pike-push-up"), ex("crunch")]
    expect(main.some(loadsWrist)).toBe(true)
    for (const seed of SEEDS) {
      const items = buildWarmup({ pool: EXERCISES, profile, focus: PUSH, heavy: ["chest", "shoulders"], main, rng: createRng(seed) })
      const wrist = drillsOf(items).filter((e) => e.primaryMuscle === "forearms")
      expect(wrist.length, `seed ${seed}: ${items.map((i) => i.exercise.id)}`).toBe(1)
      // The primary lift's own primer is kept alongside it.
      expect(drillsOf(items).some((e) => e.movementPattern === "horizontal_push"), `seed ${seed}`).toBe(true)
    }
  })

  it("never adds a drill for groups the session does not touch", () => {
    // A legs day with a wrist-loading trunk drill: the wrist drills serve arm and chest work only.
    const profile = beginner("bodyweight")
    const main = [ex("bodyweight-squat"), ex("bodyweight-single-leg-rdl"), ex("plank-shoulder-tap")]
    for (const seed of SEEDS) {
      const items = buildWarmup({ pool: EXERCISES, profile, focus: LEGS, heavy: ["quads", "hamstrings"], main, rng: createRng(seed) })
      const session = new Set<MuscleGroup>([...LEGS, "core"])
      for (const e of drillsOf(items)) expect(forGroups(e).some((g) => session.has(g)), `seed ${seed}: ${e.id}`).toBe(true)
    }
  })
})

describe("warm-up pool", () => {
  it("never picks a corrective drill automatically", () => {
    const pool = EXERCISES.map((e) => (e.id === "push-up-primer" ? { ...e, tags: [...(e.tags ?? []), "corrective"] } : e))
    expect(isCorrective(pool.find((e) => e.id === "push-up-primer")!)).toBe(true)
    const profile = beginner("bodyweight")
    for (const seed of SEEDS) {
      const items = buildWarmup({ pool, profile, focus: PUSH, heavy: ["chest"], main: [ex("knee-push-up")], rng: createRng(seed) })
      expect(items.map((i) => i.exercise.id)).not.toContain("push-up-primer")
    }
  })

  it("is deterministic for the same input and seed", () => {
    const profile = beginner("full_gym", 60)
    const main = [ex("goblet-squat"), ex("dumbbell-romanian-deadlift"), ex("push-up")]
    const run = () => buildWarmup({ pool: EXERCISES, profile, focus: FULL_A, heavy: ["quads"], main, rng: createRng(42) }).map((i) => i.exercise.id)
    expect(run()).toEqual(run())
  })
})

/** A low-impact bodyweight light-cardio block tagged the new way: no "warmup-" id prefix. */
function marchEntry(): Exercise {
  return {
    ...ex("warmup-jumping-jacks"),
    id: "pulse-march",
    slug: "pulse-march",
    name: "Brisk march",
    movementPattern: "locomotion",
    variationOf: "march-in-place",
    contraindications: [],
    alternativeExercises: ["warmup-jumping-jacks", "high-knee-march"],
    tags: [LIGHT_CARDIO_TAG, "low_impact", "home_friendly", "for:full_body", "for:cardio", "for:quads", "for:glutes", "for:calves"],
  }
}

describe("light cardio (coach round 2, R25)", () => {
  it("is defined by the light_cardio tag, and the warmup- entries still count", () => {
    const march = marchEntry()
    expect(isLightCardio(march)).toBe(true)
    expect(isDynamicDrill(march)).toBe(false)
    for (const id of ["warmup-bike", "warmup-row", "warmup-jumping-jacks", "warmup-jump-rope"]) expect(isLightCardio(ex(id)), id).toBe(true)
    // A short locomotion drill is not a pulse raiser unless the library tags it.
    expect(isLightCardio(ex("high-knee-march"))).toBe(false)
  })

  it("a bodyweight beginner warms up on low-impact cardio when it exists, and can swap it", () => {
    // fatloss-b-d1 / hypertrophy-b-d1: without machines the block was always jumping, with no low-impact swap.
    // The library now has its own low-impact march (warmup-march), so the real library is used.
    const march = ex("warmup-march")
    const pool = EXERCISES
    const profile = beginner("bodyweight")
    for (const seed of SEEDS) {
      for (const focus of [FULL_A, PUSH, LEGS]) {
        const items = buildWarmup({ pool, profile, focus, main: [ex("bodyweight-squat"), ex("knee-push-up")], rng: createRng(seed) })
        expect(items[0]!.exercise.id, `seed ${seed} ${focus}`).toBe("warmup-march")
        expect(items[0]!.prescription.durationSeconds).toBeGreaterThanOrEqual(march.durationRange![0])
      }
    }
    const lib = libraryFrom(pool)
    const input = makeInput(makeProfile({ ...profile, goal: "fat_loss", trainingDaysPerWeek: 3 }))
    const workout = generateWorkout(input, lib)
    const cardio = workout.exercises.find((e) => e.phase === "warmup")!
    expect(cardio.exerciseId).toBe("warmup-march")
    const swaps = replacementCandidates(workout, cardio.slotId, input, 8, lib).map((c) => lib.get(c.exerciseId)!)
    expect(swaps.some(isLightCardio), swaps.map((e) => e.id).join(",")).toBe(true)
  })

  it("a beginner with machines never starts on jumping", () => {
    const profile = beginner("full_gym")
    for (const seed of SEEDS) {
      for (const focus of [FULL_A, PUSH, LEGS]) {
        const items = buildWarmup({ pool: EXERCISES, profile, focus, rng: createRng(seed) })
        expect(isLightCardio(items[0]!.exercise)).toBe(true)
        expect(isLowImpact(items[0]!.exercise), `seed ${seed}: ${items[0]!.exercise.id}`).toBe(true)
      }
    }
  })

  it("impact pulse raisers run 60–120 s; machine cardio keeps its 3–5 minutes", () => {
    // hypertrophy-b-d1: 210 s of jumping jacks before the first squat.
    const jacks = ex("warmup-jumping-jacks")
    const bike = ex("warmup-bike")
    for (const minutes of [30, 45, 60, 75]) {
      const seconds = prescribeWarmupItem(jacks, minutes).durationSeconds!
      expect(seconds, `${minutes} min`).toBeGreaterThanOrEqual(IMPACT_PULSE_SECONDS[0])
      expect(seconds, `${minutes} min`).toBeLessThanOrEqual(IMPACT_PULSE_SECONDS[1])
      expect(prescribeWarmupItem(bike, minutes)).toEqual(prescribeLight(bike, minutes))
    }
    // Without machines, a beginner now starts on the low-impact march (warmup-march); when the
    // pulse raiser is an impact one (jumping jacks, rope), it stays within IMPACT_PULSE_SECONDS.
    const profile = beginner("dumbbells", 60)
    for (const seed of SEEDS) {
      const first = buildWarmup({ pool: EXERCISES, profile, focus: LEGS, main: [ex("goblet-squat")], rng: createRng(seed) })[0]!
      expect(first.exercise.id).toBe("warmup-march")
    }
    const trained = makeProfile({ ...profile, experience: "intermediate" })
    for (const seed of SEEDS) {
      const first = buildWarmup({ pool: EXERCISES, profile: trained, focus: LEGS, main: [ex("goblet-squat")], rng: createRng(seed) })[0]!
      expect(isLightCardio(first.exercise)).toBe(true)
      if (!isLowImpact(first.exercise)) expect(first.prescription.durationSeconds).toBeLessThanOrEqual(IMPACT_PULSE_SECONDS[1])
    }
  })

  it("uses the finisher's machine for the light cardio", () => {
    // endurance-i-d1: jumping jacks before rowing intervals in a full gym.
    expect(sharesModality(ex("warmup-row"), ex("rowing-intervals"))).toBe(true)
    expect(sharesModality(ex("warmup-bike"), ex("assault-bike-intervals"))).toBe(true)
    expect(sharesModality(ex("warmup-bike"), ex("rowing-intervals"))).toBe(false)
    const profile = makeProfile({ goal: "endurance", experience: "intermediate", durationPreferenceMinutes: 45 })
    const cases: [string, string][] = [
      ["rowing-intervals", "warmup-row"],
      ["bike-intervals", "warmup-bike"],
      ["assault-bike-intervals", "warmup-bike"],
      ["treadmill-intervals", "warmup-treadmill-walk"],
    ]
    for (const [finisher, cardio] of cases) {
      for (const seed of SEEDS) {
        for (const focus of [FULL_A, PUSH]) {
          const items = buildWarmup({ pool: EXERCISES, profile, focus, finisher: ex(finisher), rng: createRng(seed) })
          expect(items[0]!.exercise.id, `${finisher} seed ${seed}`).toBe(cardio)
        }
      }
    }
  })
})

describe("primers (coach round 2, R25)", () => {
  it("an unloaded beginner lift is its own rehearsal: its drill goes to the next lift", () => {
    // fatloss-b-d1: a bodyweight squat primer before bodyweight squats took one of two drill slots
    // in a 30-minute session, and the push-ups and rows got no shoulder-blade preparation.
    const profile = beginner("bodyweight", 30)
    const main = [ex("bodyweight-squat"), ex("knee-push-up"), ex("doorway-row")]
    for (const seed of SEEDS) {
      const items = buildWarmup({ pool: EXERCISES, profile, focus: FULL_A, heavy: ["quads", "chest", "back"], main, rng: createRng(seed) })
      const drills = drillsOf(items)
      const ids = drills.map((e) => e.id)
      expect(ids, `seed ${seed}`).not.toContain("bodyweight-squat-primer")
      expect(ids, `seed ${seed}`).not.toContain("push-up-primer")
      for (const drill of drills) for (const lift of main) expect(duplicatesLift(drill, lift), `${drill.id} / ${lift.id}`).toBe(false)
      // The squat's slot went to other work: no squat-pattern drill. Core spec C19: a beginner's
      // braced lift (the squat) now gets a bracing primer in the free place after the wrist drill,
      // which the back or shoulder drill used to take; one of them is there.
      expect(drills.some((e) => e.movementPattern === "squat"), `seed ${seed}: ${ids}`).toBe(false)
      expect(drills.some((e) => isBracingPrimer(e) || forGroups(e).includes("back") || forGroups(e).includes("shoulders")), `seed ${seed}: ${ids}`).toBe(true)
    }
  })

  it("a loaded lift, or one the primer regresses, keeps its primer", () => {
    expect(duplicatesLift(ex("bodyweight-squat-primer"), ex("bodyweight-squat"))).toBe(true)
    expect(duplicatesLift(ex("push-up-primer"), ex("knee-push-up"))).toBe(true)
    expect(duplicatesLift(ex("bodyweight-squat-primer"), ex("goblet-squat"))).toBe(false)
    // A two-legged hinge before a single-leg RDL teaches the hinge before the balance demand.
    expect(duplicatesLift(ex("hip-hinge-primer"), ex("bodyweight-single-leg-rdl"))).toBe(false)
    // A shoulder-blade drill is not a rehearsal of the push-up.
    expect(duplicatesLift(ex("scapular-push-up"), ex("knee-push-up"))).toBe(false)
    const profile = beginner("dumbbells", 30)
    for (const seed of SEEDS) {
      const items = buildWarmup({ pool: EXERCISES, profile, focus: LEGS, main: [ex("goblet-squat"), ex("bodyweight-squat")], rng: createRng(seed) })
      expect(drillsOf(items).some((e) => e.movementPattern === "squat" && e.category === "warmup"), `seed ${seed}`).toBe(true)
    }
  })

  it("cuff and mobility drills keep their own rep floor; loaded-pattern primers stay at 8 per side", () => {
    // endurance-i-d1: band external rotation at 8 per side against its own 12–15.
    expect(prescribeWarmupItem(ex("band-external-rotation"), 45).reps).toEqual([12, 12])
    expect(prescribeWarmupItem(ex("leg-swings-front"), 45).reps).toEqual([10, 10])
    expect(prescribeWarmupItem(ex("walking-lunge-primer"), 75).reps![1]).toBeLessThanOrEqual(8)
    const profile = makeProfile({ experience: "intermediate", equipmentPreset: "home_gym", equipment: EQUIPMENT_PRESETS.home_gym, durationPreferenceMinutes: 60 })
    for (const seed of SEEDS) {
      const items = buildWarmup({ pool: EXERCISES, profile, focus: PUSH, main: [ex("dumbbell-bench-press"), ex("dumbbell-reverse-lunge"), ex("seated-dumbbell-shoulder-press")], rng: createRng(seed) })
      for (const { exercise, prescription } of items) {
        if (!prescription.reps || !exercise.repRange) continue
        const loadedPattern = ["squat", "hinge", "lunge", "hip_extension", "horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull"].includes(exercise.movementPattern)
        if (exercise.isUnilateral && loadedPattern) expect(prescription.reps[1]).toBeLessThanOrEqual(8)
        else expect(prescription.reps[0], exercise.id).toBe(exercise.repRange[0])
      }
    }
  })
})

describe("a protected shoulder (coach round 2, R15 engine side)", () => {
  const profile = makeProfile({ experience: "intermediate", equipmentPreset: "home_gym", equipment: EQUIPMENT_PRESETS.home_gym, durationPreferenceMinutes: 45, limitations: ["shoulder"] })
  const main = [ex("single-arm-dumbbell-row"), ex("dumbbell-floor-press"), ex("goblet-squat")]
  const upper: MuscleGroup[] = ["chest", "back", "shoulders"]

  it("an upper day gets a controlled cuff drill", () => {
    // general-i-shoulder-d1: arm swings were picked while band external rotation was available.
    for (const seed of SEEDS) {
      const items = buildWarmup({ pool: EXERCISES, profile, focus: upper, main, rng: createRng(seed) })
      expect(items.some((i) => isCuffDrill(i.exercise)), `seed ${seed}: ${items.map((i) => i.exercise.id)}`).toBe(true)
    }
    // No upper-body lift, no reserved cuff drill.
    const legs = buildWarmup({ pool: EXERCISES, profile, focus: LEGS, main: [ex("goblet-squat")], rng: createRng(1) })
    expect(legs.filter((i) => isCuffDrill(i.exercise)).length).toBe(0)
  })

  it("never picks a ballistic shoulder swing", () => {
    // The rule follows the "ballistic" tag, so it holds for a momentum drill the library does not
    // contraindicate for the shoulder (arm-swings without its shoulder contraindication here).
    const pool = EXERCISES.map((e) =>
      e.id === "arm-swings" ? { ...e, contraindications: [], tags: [...new Set([...(e.tags ?? []), BALLISTIC_TAG])] } : e,
    )
    for (const seed of SEEDS) {
      for (const focus of [upper, FULL_A]) {
        const ids = buildWarmup({ pool, profile, focus, main, rng: createRng(seed) }).map((i) => i.exercise.id)
        expect(ids, `seed ${seed}`).not.toContain("arm-swings")
      }
    }
    // A bodyweight chest day picks the swing often without a shoulder flag, never with one.
    const bodyweight = makeProfile({ experience: "intermediate", equipmentPreset: "bodyweight", equipment: EQUIPMENT_PRESETS.bodyweight, durationPreferenceMinutes: 45 })
    const swings = (limitations: UserProfile["limitations"]) =>
      SEEDS.filter((seed) => buildWarmup({ pool, profile: { ...bodyweight, limitations }, focus: ["chest"], rng: createRng(seed) }).some((i) => i.exercise.id === "arm-swings")).length
    expect(swings([])).toBeGreaterThan(0)
    expect(swings(["shoulder"])).toBe(0)
  })
})

describe("bracing primer (core spec C19)", () => {
  it("a beginner's squat day gets a bracing primer in a free place, keeping the squat primer and the item count", () => {
    const profile = beginner("full_gym", 30)
    const main = [ex("goblet-squat"), ex("machine-chest-press"), ex("lat-pulldown")]
    for (const seed of SEEDS) {
      const items = buildWarmup({ pool: EXERCISES, profile, focus: FULL_A, heavy: ["quads", "chest", "back"], main, rng: createRng(seed) })
      const ids = items.map((i) => i.exercise.id)
      expect(items.some((i) => isBracingPrimer(i.exercise)), `seed ${seed}: ${ids}`).toBe(true)
      expect(items.some((i) => i.exercise.category === "warmup" && i.exercise.movementPattern === "squat"), `seed ${seed}: ${ids}`).toBe(true)
      // The same number of items as a trained lifter's warm-up for the same day: it took a free place.
      const trained = buildWarmup({ pool: EXERCISES, profile: { ...profile, experience: "intermediate" }, focus: FULL_A, heavy: ["quads", "chest", "back"], main, rng: createRng(seed) })
      expect(items.length, `seed ${seed}`).toBe(trained.length)
    }
    expect(wantsBracingPrimer(profile, main)).toBe(true)
    // A seated press is not a braced lift; a flagged lower back gets the primer at any level.
    expect(wantsBracingPrimer(profile, [ex("seated-dumbbell-shoulder-press")])).toBe(false)
    expect(wantsBracingPrimer({ ...profile, experience: "advanced", limitations: ["lower_back"] }, [ex("goblet-squat")])).toBe(true)
  })

  it("a trained lifter gets it only before a heavy axial primary at 45 minutes or more", () => {
    const thirty = makeProfile({ experience: "intermediate", durationPreferenceMinutes: 30 })
    const squatDay = [ex("barbell-back-squat"), ex("romanian-deadlift"), ex("bulgarian-split-squat")]
    expect(wantsBracingPrimer(thirty, squatDay)).toBe(false)
    expect(wantsBracingPrimer({ ...thirty, durationPreferenceMinutes: 60 }, squatDay)).toBe(true)
    expect(wantsBracingPrimer({ ...thirty, durationPreferenceMinutes: 60 }, [ex("barbell-bench-press"), ex("barbell-back-squat")])).toBe(false)
    // At 30 minutes nothing is forced in: the warm-up is the one the drills' own scores give.
    for (const seed of SEEDS) {
      const items = buildWarmup({ pool: EXERCISES, profile: thirty, focus: LEGS, heavy: ["quads", "hamstrings"], main: squatDay, rng: createRng(seed) })
      expect(items.some((i) => i.exercise.category === "warmup" && i.exercise.movementPattern === "squat"), `seed ${seed}`).toBe(true)
    }
  })

  it("ballistic torso twists never come before a heavy squat or deadlift", () => {
    for (const lift of ["barbell-back-squat", "conventional-deadlift"]) {
      for (const experience of ["beginner", "intermediate", "advanced"] as const) {
        for (const seed of SEEDS) {
          const profile = makeProfile({ experience, durationPreferenceMinutes: 75 })
          const items = buildWarmup({ pool: EXERCISES, profile, focus: ["full_body", "quads", "core"], heavy: ["quads"], main: [ex(lift)], rng: createRng(seed) })
          expect(items.map((i) => i.exercise.id), `${lift} ${experience} seed ${seed}`).not.toContain("torso-twists")
        }
      }
    }
  })
})
