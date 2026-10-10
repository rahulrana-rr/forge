import { describe, expect, it } from "vitest"
import { EXERCISES, getExercise, muscleGroupOf, requireExercise } from "@/lib/exercises"
import type { CompletedWorkout, EquipmentPreset } from "@/lib/domain/types"
import type { Exercise, Goal } from "@/lib/exercises/types"
import { createRng } from "./random"
import { computeRecovery } from "./recovery"
import { generateWorkout } from "./generate"
import {
  CORE_SCORE,
  coreFamily,
  coreOverlapPenalty,
  equipmentAllowed,
  familyRoot,
  fitsFinisher,
  isConditioning,
  isLoadable,
  isRedundantWith,
  isStrengthMainLift,
  isTorsoSupported,
  isUnloadedPlyometric,
  limitationPreference,
  loadableTrunk,
  lookupFor,
  matchesSlot,
  passesProfileFilter,
  rankCandidates,
  scoreCandidate,
  selectForSlot,
  slotCandidates,
  supportLiftStatus,
  type ScoreContext,
} from "./selection"
import { TEMPLATES, FINISHER_SLOT, type SlotSpec } from "./splits"
import { completeAtTop, FIXTURE_BY_ID, FIXTURE_LIBRARY, makeExercise, makeInput, makeProfile, progressFromHistory } from "./test-fixtures"

const primaryChest = TEMPLATES.push_a!.slots[0]!
const bench = FIXTURE_BY_ID.get("barbell-bench-press")!

function ctx(overrides: Partial<ScoreContext> = {}): ScoreContext {
  return {
    profile: makeProfile(),
    slot: primaryChest,
    chosen: [],
    lastSameSplitIds: new Set(),
    recentIds: new Map(),
    rng: createRng(1),
    ...overrides,
  }
}

describe("selection", () => {
  it("profile filter enforces equipment, difficulty, limitations and exclusions", () => {
    expect(passesProfileFilter(bench, makeProfile())).toBe(true)
    expect(passesProfileFilter(bench, makeProfile({ equipmentPreset: "bodyweight" }))).toBe(false)
    expect(passesProfileFilter(bench, makeProfile({ experience: "beginner" }))).toBe(false)
    expect(passesProfileFilter(bench, makeProfile({ limitations: ["shoulder"] }))).toBe(false)
    expect(passesProfileFilter(bench, makeProfile({ excludedExerciseIds: ["barbell-bench-press"] }))).toBe(false)
  })

  it("matchesSlot degrades by level", () => {
    const dip = FIXTURE_BY_ID.get("bench-dip")!
    expect(matchesSlot(bench, primaryChest, 0)).toBe(true)
    expect(matchesSlot(FIXTURE_BY_ID.get("cable-fly")!, primaryChest, 0)).toBe(false)
    // Compound slots keep their mechanics at level 1 (pattern relaxes first), so a fly only
    // stands in for the primary press at level 2, once no chest compound is left.
    expect(matchesSlot(FIXTURE_BY_ID.get("cable-fly")!, primaryChest, 1)).toBe(false)
    expect(matchesSlot(FIXTURE_BY_ID.get("cable-fly")!, primaryChest, 2)).toBe(true)
    expect(matchesSlot(dip, primaryChest, 2)).toBe(false)
    expect(matchesSlot(dip, primaryChest, 4)).toBe(true) // chest is a secondary muscle
    expect(matchesSlot(FIXTURE_BY_ID.get("burpee")!, primaryChest, 4)).toBe(false)
    expect(matchesSlot(FIXTURE_BY_ID.get("burpee")!, FINISHER_SLOT, 0)).toBe(true)
    expect(matchesSlot(bench, FINISHER_SLOT, 4)).toBe(false)
  })

  it("falls back to secondary muscles when every chest exercise is excluded", () => {
    const chestIds = FIXTURE_LIBRARY.filter((e) => e.category === "chest").map((e) => e.id)
    const profile = makeProfile({ excludedExerciseIds: chestIds })
    const result = slotCandidates(primaryChest, FIXTURE_LIBRARY, profile)
    expect(result).not.toBeNull()
    expect(result!.level).toBeGreaterThanOrEqual(3)
    expect(result!.exercises.every((e) => !chestIds.includes(e.id))).toBe(true)
  })

  it("returns null when nothing can fill the slot", () => {
    // Bodyweight work is always available, so an empty kit list alone still leaves push-ups.
    const profile = makeProfile({ equipment: [], excludedExerciseIds: FIXTURE_LIBRARY.map((e) => e.id) })
    expect(slotCandidates(primaryChest, FIXTURE_LIBRARY, profile)).toBeNull()
    expect(selectForSlot(primaryChest, FIXTURE_LIBRARY, ctx({ profile }))).toBeNull()
  })

  it("treats bodyweight as always available, even when a stored list leaves it out", () => {
    const pushup = FIXTURE_LIBRARY.find((e) => e.equipment.length > 0 && e.equipment.every((q) => q === "bodyweight"))!
    expect(equipmentAllowed(pushup, [])).toBe(true)
    const barbell = FIXTURE_LIBRARY.find((e) => e.equipment.includes("barbell"))!
    expect(equipmentAllowed(barbell, ["bodyweight"])).toBe(false)
  })

  it("prefers canonical compounds for the primary slot and the user's favourites", () => {
    const pick = selectForSlot(primaryChest, FIXTURE_LIBRARY, ctx())
    expect(pick?.exercise.id).toBe("barbell-bench-press")
    const fav = selectForSlot(primaryChest, FIXTURE_LIBRARY, ctx({ profile: makeProfile({ preferredExerciseIds: ["machine-chest-press"] }) }))
    expect(fav?.exercise.id).toBe("machine-chest-press")
  })

  it("beginners get machines and dumbbells over barbells for primaries", () => {
    const profile = makeProfile({ experience: "beginner" })
    const pick = selectForSlot(primaryChest, FIXTURE_LIBRARY, ctx({ profile }))
    expect(pick?.exercise.equipment).not.toContain("barbell")
    expect(pick?.exercise.difficulty).toBe("beginner")
  })

  it("rotates accessories away from the last same-split workout but keeps primaries sticky", () => {
    const isoSlot: SlotSpec = TEMPLATES.push_a!.slots[3]!
    // Coach round 2 (R19): in a strength or hypertrophy block the slot's only loadable option (the
    // fixture's dumbbell lateral raise against a band raise) is no longer rotated out, so the
    // rotation rule is checked with a conditioning goal, where it still applies.
    const profile = makeProfile({ goal: "fat_loss" })
    const base = rankCandidates(slotCandidates(isoSlot, FIXTURE_LIBRARY, profile)!.exercises, ctx({ profile, slot: isoSlot }))
    const top = base[0]!.exercise.id
    const rotated = rankCandidates(slotCandidates(isoSlot, FIXTURE_LIBRARY, profile)!.exercises, ctx({ profile, slot: isoSlot, lastSameSplitIds: new Set([top]) }))
    expect(rotated[0]!.exercise.id).not.toBe(top)
    const sticky = selectForSlot(primaryChest, FIXTURE_LIBRARY, ctx({ lastSameSplitIds: new Set(["dumbbell-bench-press"]) }))
    expect(["dumbbell-bench-press", "barbell-bench-press"]).toContain(sticky?.exercise.id)
  })

  it("never repeats an exercise already in the workout and respects open groups", () => {
    const taken = new Set(["barbell-bench-press"])
    const pick = selectForSlot(primaryChest, FIXTURE_LIBRARY, ctx(), { taken })
    expect(pick?.exercise.id).not.toBe("barbell-bench-press")
    const hamSlot = TEMPLATES.legs_a!.slots[1]! // hinge: hamstrings or glutes
    const open = slotCandidates(hamSlot, FIXTURE_LIBRARY, makeProfile(), { openGroups: ["glutes"] })
    expect(open!.exercises.every((e) => e.primaryMuscle === "glutes")).toBe(true)
  })

  it("scoring is deterministic for the same seed", () => {
    const a = rankCandidates(FIXTURE_LIBRARY.filter((e) => e.category === "chest"), ctx({ rng: createRng(9) }))
    const b = rankCandidates(FIXTURE_LIBRARY.filter((e) => e.category === "chest"), ctx({ rng: createRng(9) }))
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------------------------
// Coach round 1 (F07, F08, F12, F18, F19, F28): rules checked against the real library.
// ---------------------------------------------------------------------------------------------

const lookup = lookupFor(EXERCISES)
const ex = (id: string): Exercise => requireExercise(id)
const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1)

function realCtx(overrides: Partial<ScoreContext> & Pick<ScoreContext, "profile" | "slot">): ScoreContext {
  return { chosen: [], lastSameSplitIds: new Set(), recentIds: new Map(), rng: createRng(1), ...overrides }
}

function pickFor(slot: SlotSpec, overrides: Partial<ScoreContext> & Pick<ScoreContext, "profile">, seed: number): Exercise | null {
  return selectForSlot(slot, EXERCISES, realCtx({ slot, rng: createRng(seed), ...overrides }))?.exercise ?? null
}

const slotOf = (template: string, key: string): SlotSpec => TEMPLATES[template]!.slots.find((s) => s.key === key)!
const usesBar = (e: Exercise) => e.equipment.includes("barbell") || e.equipment.includes("trap_bar")

describe("strength blocks build on the barbell lifts (F07)", () => {
  const advanced = makeProfile({ goal: "strength", experience: "advanced" })
  const bigLiftDays = ["push_a", "push_b", "legs_a", "legs_b", "upper_a", "lower_a", "lower_b"]

  it("an advanced full-gym strength profile always gets a big barbell lift as the primary", () => {
    for (const key of bigLiftDays) {
      const slot = slotOf(key, "primary")
      for (const seed of SEEDS) {
        const pick = pickFor(slot, { profile: advanced }, seed)!
        expect(pick.tags ?? [], `${key} seed ${seed}: ${pick.id}`).toContain("big_lift")
        expect(usesBar(pick), `${key} seed ${seed}: ${pick.id}`).toBe(true)
      }
    }
  })

  it("last week's dumbbell or machine pick no longer locks the slot while a barbell lift is available", () => {
    const lastWeek = new Set(["dumbbell-bench-press", "incline-dumbbell-press", "seated-dumbbell-shoulder-press", "leg-press", "hack-squat"])
    for (const key of ["push_a", "push_b", "legs_a"]) {
      for (const seed of SEEDS) {
        const pick = pickFor(slotOf(key, "primary"), { profile: advanced, lastSameSplitIds: lastWeek }, seed)!
        expect(isStrengthMainLift(pick), `${key} seed ${seed}: ${pick.id}`).toBe(true)
      }
    }
    // Last week's barbell lift keeps its slot: consistency still applies to the main lifts.
    for (const id of ["trap-bar-deadlift", "conventional-deadlift"]) {
      for (const seed of SEEDS) expect(pickFor(slotOf("legs_b", "primary"), { profile: advanced, lastSameSplitIds: new Set([id]) }, seed)!.id).toBe(id)
    }
  })

  it("dumbbell or machine primaries appear only when the barbell is unavailable or preferred", () => {
    const noBar = makeProfile({ goal: "strength", experience: "advanced", equipmentPreset: "dumbbells" })
    expect(usesBar(pickFor(slotOf("push_a", "primary"), { profile: noBar }, 1)!)).toBe(false)
    const shoulder = makeProfile({ goal: "strength", experience: "advanced", limitations: ["shoulder"] })
    const press = pickFor(slotOf("push_a", "primary"), { profile: shoulder }, 1)
    expect(press?.contraindications ?? []).not.toContain("shoulder")
    const fan = makeProfile({ goal: "strength", experience: "advanced", preferredExerciseIds: ["dumbbell-bench-press"] })
    expect(pickFor(slotOf("push_a", "primary"), { profile: fan }, 1)!.id).toBe("dumbbell-bench-press")
  })

  it("beginners and other goals keep their own equipment preferences", () => {
    const beginner = makeProfile({ goal: "strength", experience: "beginner" })
    for (const seed of SEEDS.slice(0, 10)) expect(usesBar(pickFor(slotOf("push_a", "primary"), { profile: beginner }, seed)!)).toBe(false)
    const machineFirst = (goal: Goal) => scoreCandidate(ex("leg-press"), realCtx({ profile: makeProfile({ goal, experience: "advanced" }), slot: slotOf("legs_a", "primary") }))
    // The machine penalty is a strength-block rule: a hypertrophy leg press scores the same as before.
    expect(machineFirst("muscle_gain")).toBeGreaterThan(machineFirst("strength") - 1)
  })
})

describe("trunk work never loads what the day's heavy lifts loaded (F08)", () => {
  const days: Record<string, string[]> = {
    push_a: ["barbell-bench-press", "overhead-press", "incline-dumbbell-press", "dumbbell-lateral-raise"],
    upper_a: ["barbell-bench-press", "lat-pulldown", "overhead-press", "seated-cable-row"],
    upper_b: ["bent-over-barbell-row", "barbell-bench-press", "lat-pulldown", "seated-dumbbell-shoulder-press"],
  }

  // Core spec C09: this asserted that no shoulder-listing trunk drill follows pressing. The overlap
  // penalty now covers only real same-structure conflicts: hanging and overhead trunk work after a
  // press. A side plank or landmine rotation lists the shoulder positionally and stays available to
  // users who flagged nothing (a flagged shoulder is still kept out by the hard filter).
  it("the core slot on push and upper days never picks hanging or overhead work when another option exists", () => {
    for (const goal of ["strength", "muscle_gain"] as const) {
      const profile = makeProfile({ goal, experience: "advanced" })
      for (const [key, ids] of Object.entries(days)) {
        const slot = TEMPLATES[key]!.slots.find((s) => s.kind === "core")!
        const options = slotCandidates(slot, EXERCISES, profile)!.exercises
        expect(options.some((e) => !e.contraindications.includes("shoulder"))).toBe(true)
        for (const seed of SEEDS) {
          const pick = pickFor(slot, { profile, chosen: ids.map(ex) }, seed)!
          expect(pick.tags ?? [], `${goal} ${key} seed ${seed}: ${pick.id}`).not.toContain("hanging")
          expect(pick.equipment, `${goal} ${key} seed ${seed}: ${pick.id}`).not.toContain("pull_up_bar")
          expect(pick.equipment, `${goal} ${key} seed ${seed}: ${pick.id}`).not.toContain("dip_station")
          expect(pick.tags ?? [], `${goal} ${key} seed ${seed}: ${pick.id}`).not.toContain("overhead")
          expect(pick.id).not.toBe("kettlebell-windmill")
        }
      }
    }
  })

  it("on hinge and squat days the core slot spares the lower back", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "advanced" })
    const slot = TEMPLATES.legs_b!.slots.find((s) => s.kind === "core")!
    const chosen = ["romanian-deadlift", "barbell-back-squat", "bulgarian-split-squat"].map(ex)
    for (const seed of SEEDS) {
      const pick = pickFor(slot, { profile, chosen }, seed)!
      expect(pick.contraindications, `seed ${seed}: ${pick.id}`).not.toContain("lower_back")
    }
  })
})

describe("one exercise per family and no stacked joint stress in a session (F12)", () => {
  it("resolves variations transitively to the family root", () => {
    expect(familyRoot(ex("b-stance-hip-thrust"), lookup)).toBe("barbell-hip-thrust")
    expect(isRedundantWith(ex("b-stance-hip-thrust"), ex("barbell-hip-thrust"), lookup)).toBe(true)
    expect(isRedundantWith(ex("underhand-barbell-row"), ex("bent-over-barbell-row"), lookup)).toBe(true)
    // JM press and skull crusher list each other as alternatives: the same lying elbow extension.
    expect(isRedundantWith(ex("jm-press"), ex("skull-crusher"), lookup)).toBe(true)
    // Forearm and rear-delt work: one direct exercise per session.
    expect(isRedundantWith(ex("wrist-curl"), ex("reverse-curl"), lookup)).toBe(true)
    expect(isRedundantWith(ex("reverse-pec-deck"), ex("face-pull"), lookup)).toBe(true)
    // A press and an incline press from different families are not the same work.
    expect(isRedundantWith(ex("incline-dumbbell-press"), ex("barbell-bench-press"), lookup)).toBe(false)
  })

  it("never offers a second member of a family already in the session", () => {
    const profile = makeProfile({ goal: "fat_loss" })
    const thrustSlot = slotOf("legs_b", "accessory")
    const afterThrust = slotCandidates(thrustSlot, EXERCISES, profile, { chosen: [ex("barbell-hip-thrust")] })!.exercises
    expect(afterThrust.length).toBeGreaterThan(0)
    for (const e of afterThrust) expect(familyRoot(e, lookup), e.id).not.toBe("barbell-hip-thrust")
    expect(afterThrust.map((e) => e.id)).not.toContain("barbell-glute-bridge") // listed alternative of the thrust
    const rowSlot = slotOf("upper_a", "acc_pull")
    const intermediate = makeProfile({ goal: "general_fitness", equipmentPreset: "home_gym" })
    for (const seed of SEEDS) {
      const row = pickFor(rowSlot, { profile: intermediate, chosen: [ex("bent-over-barbell-row")] }, seed)!
      expect(familyRoot(row, lookup), `seed ${seed}: ${row.id}`).not.toBe("bent-over-barbell-row")
    }
  })

  it("a second forearm or rear-delt lift is never added, even when it is the only option left", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "advanced" })
    const forearms = slotOf("pull_a", "iso_forearms")
    for (const seed of SEEDS) {
      const pick = pickFor(forearms, { profile, chosen: [ex("reverse-curl")] }, seed)
      expect(pick?.primaryMuscle, `seed ${seed}: ${pick?.id}`).not.toBe("forearms")
    }
    const onlyForearms = selectForSlot(forearms, EXERCISES, realCtx({ profile, slot: forearms, chosen: [ex("reverse-curl")] }), { openGroups: ["forearms"] })
    expect(onlyForearms).toBeNull()
    const rear = slotOf("pull_a", "iso_rear")
    for (const seed of SEEDS) {
      const pick = pickFor(rear, { profile, chosen: [ex("lat-pulldown"), ex("face-pull")] }, seed)
      expect(pick?.primaryMuscle, `seed ${seed}: ${pick?.id}`).not.toBe("rear_delts")
    }
  })

  it("penalises the same muscle through the same movement whatever the mechanics label", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "advanced" })
    const rescue: SlotSpec = { key: "rescue", role: "accessory", patterns: [], groups: ["chest", "shoulders", "triceps"], priority: 50, kind: "general" }
    const score = (id: string, chosen: string[]) => scoreCandidate(ex(id), realCtx({ profile, slot: rescue, chosen: chosen.map(ex), rng: createRng(4) }))
    // A compound lying extension after an isolation one: -8, where the mechanics rule saw nothing.
    expect(score("tate-press", ["jm-press"])).toBeLessThanOrEqual(score("tate-press", []) - 8)
    // A second small-muscle lift is penalised even with a different movement.
    const curlSlot = slotOf("pull_b", "iso_biceps_2")
    const curl = (chosen: string[]) => scoreCandidate(ex("cable-curl"), realCtx({ profile, slot: curlSlot, chosen: chosen.map(ex), rng: createRng(4) }))
    expect(curl(["chin-up"])).toBeGreaterThan(curl(["chin-up", "hammer-curl"]) + 15)
  })

  it("does not stack a third lower-back lift on a leg day while a lift that spares it exists", () => {
    const profile = makeProfile({ goal: "muscle_gain" })
    const slot = slotOf("legs_b", "accessory")
    const chosen = [ex("romanian-deadlift"), ex("barbell-back-squat")]
    const options = slotCandidates(slot, EXERCISES, profile, { chosen })!.exercises
    expect(options.some((e) => !e.contraindications.includes("lower_back"))).toBe(true)
    for (const seed of SEEDS) {
      const pick = pickFor(slot, { profile, chosen }, seed)!
      expect(pick.contraindications, `seed ${seed}: ${pick.id}`).not.toContain("lower_back")
    }
  })

  it("generated workouts never hold two members of one family, two forearm or two rear-delt lifts", () => {
    const presets: EquipmentPreset[] = ["full_gym", "home_gym", "dumbbells", "bodyweight"]
    for (const goal of ["muscle_gain", "strength", "fat_loss"] as const) {
      for (const equipmentPreset of presets) {
        for (const trainingDaysPerWeek of [3, 6] as const) {
          const profile = makeProfile({ goal, experience: "advanced", equipmentPreset, trainingDaysPerWeek, durationPreferenceMinutes: 75 })
          const history: CompletedWorkout[] = []
          for (let day = 1; day <= 4; day++) {
            const date = `2026-10-0${day}`
            const w = generateWorkout(makeInput(profile, date, history.slice(), progressFromHistory(history)))
            const main = w.exercises.filter((e) => e.phase === "main" && e.role !== "finisher").map((e) => ex(e.exerciseId))
            for (let i = 0; i < main.length; i++) {
              for (let j = i + 1; j < main.length; j++) {
                expect(isRedundantWith(main[j]!, main[i]!, lookup), `${goal}/${equipmentPreset}/${trainingDaysPerWeek}d ${date}: ${main[i]!.id} + ${main[j]!.id}`).toBe(false)
              }
            }
            history.unshift(completeAtTop(w, getExercise))
          }
        }
      }
    }
  })
})

describe("finishers are conditioning that suits the day (F18, scoring)", () => {
  it("complexes and Olympic lifts are never finishers", () => {
    for (const e of EXERCISES) {
      if ((e.tags ?? []).some((t) => t === "complex" || t === "olympic")) expect(fitsFinisher(e), e.id).toBe(false)
    }
    expect(fitsFinisher(ex("man-maker"))).toBe(false)
    expect(fitsFinisher(ex("burpee"))).toBe(true)
  })

  it("an upper-body day never ends with sprints or a drill that needs a lower-body warm-up", () => {
    const profile = makeProfile({ goal: "fat_loss", experience: "advanced" })
    const chosen = ["barbell-bench-press", "lat-pulldown", "overhead-press", "seated-cable-row"].map(ex)
    const options = slotCandidates(FINISHER_SLOT, EXERCISES, profile)!.exercises
    expect(options.some((e) => e.warmupRequired)).toBe(true)
    for (const seed of SEEDS) {
      const pick = pickFor(FINISHER_SLOT, { profile, chosen }, seed)!
      expect(pick.warmupRequired, `seed ${seed}: ${pick.id}`).toBe(false)
      expect(pick.tags ?? []).not.toContain("sprint")
    }
  })

  it("prefers low-impact cyclical cardio and spares groups trained heavily in the last 48 hours", () => {
    const profile = makeProfile({ goal: "fat_loss" })
    const base = { id: "twin", category: "cardio" as const, primary: "cardiovascular" as const, pattern: "conditioning" as const, equipment: ["cardio_machine" as const], loadType: "timed" as const, duration: [30, 60] as [number, number], tags: ["intervals"] }
    const plain = makeExercise(base)
    const soft = makeExercise({ ...base, tags: ["intervals", "low_impact"] })
    const score = (e: Exercise, extra: Partial<ScoreContext> = {}) => scoreCandidate(e, realCtx({ profile, slot: FINISHER_SLOT, rng: createRng(2), ...extra }))
    expect(score(soft) - score(plain)).toBeCloseTo(3)
    const sled = ex("sled-push") // quads
    const recovery = computeRecovery([], "2026-10-07")
    const sore = { ...recovery, quads: { ...recovery.quads, daysSinceHeavy: 1 } }
    expect(score(sled) - score(sled, { recovery: sore })).toBeCloseTo(6)
    const rested = { ...recovery, quads: { ...recovery.quads, daysSinceHeavy: 3 } }
    expect(score(sled, { recovery: rested })).toBeCloseTo(score(sled))
  })
})

describe("beginners start bodyweight lifts on their regression (F19, scoring)", () => {
  const beginner = makeProfile({ goal: "fat_loss", experience: "beginner", equipmentPreset: "bodyweight" })
  const press = slotOf("full_a", "secondary")

  it("a bodyweight beginner with no history gets a knee or incline push-up over a full push-up", () => {
    let regressions = 0
    for (const seed of SEEDS) {
      const pick = pickFor(press, { profile: beginner }, seed)!
      if (pick.id === "knee-push-up" || pick.id === "incline-push-up") regressions++
      expect(pick.id).not.toBe("push-up")
    }
    expect(regressions / SEEDS.length).toBeGreaterThanOrEqual(0.8)
  })

  it("drops the regression bonus once the lift is in the log", () => {
    const peers = slotCandidates(press, EXERCISES, beginner)!.exercises
    const score = (id: string, performedIds?: ReadonlySet<string>) =>
      scoreCandidate(ex(id), realCtx({ profile: beginner, slot: press, rng: createRng(5), performedIds }), peers)
    // The parent loses 6 until the user has logged it; the regression gains 6 until it is logged.
    expect(score("push-up", new Set(["push-up"])) - score("push-up")).toBeCloseTo(6)
    expect(score("knee-push-up") - score("knee-push-up", new Set(["knee-push-up"]))).toBeCloseTo(6)
    // Without a log, recent workouts stand in for it.
    const recent = scoreCandidate(ex("push-up"), realCtx({ profile: beginner, slot: press, rng: createRng(5), recentIds: new Map([["push-up", 0]]) }), peers)
    expect(recent - score("push-up")).toBeCloseTo(6)
  })

  it("in core slots beginners get the drill that stresses nothing when the pattern has one", () => {
    const core = TEMPLATES.full_a!.slots.find((s) => s.kind === "core")!
    const ctx = realCtx({ profile: makeProfile({ goal: "general_fitness", experience: "beginner" }), slot: core, rng: createRng(6) })
    const flagged = ex("lying-leg-raise") // trunk flexion, lower back
    const clean = ex("reverse-crunch") // trunk flexion, nothing flagged
    expect(scoreCandidate(flagged, ctx, [flagged]) - scoreCandidate(flagged, { ...ctx, rng: createRng(6) }, [flagged, clean])).toBeCloseTo(4)
  })
})

describe("explosive lifts stay out of loaded accessory slots (F28)", () => {
  const accessory = slotOf("legs_a", "accessory")

  it("strength and hypertrophy blocks never fill a squat or lunge accessory with an unloaded jump", () => {
    for (const goal of ["strength", "muscle_gain"] as const) {
      for (const equipmentPreset of ["bodyweight", "full_gym"] as const) {
        const profile = makeProfile({ goal, experience: "intermediate", equipmentPreset })
        const options = slotCandidates(accessory, EXERCISES, profile)!.exercises
        for (const e of options) expect(isUnloadedPlyometric(e), `${goal}/${equipmentPreset}: ${e.id}`).toBe(false)
        const secondary = slotCandidates(slotOf("legs_b", "secondary"), EXERCISES, profile)!.exercises
        for (const e of secondary) expect(isUnloadedPlyometric(e), `${goal}/${equipmentPreset}: ${e.id}`).toBe(false)
      }
    }
  })

  it("conditioning goals and favourites keep them", () => {
    const fatLoss = makeProfile({ goal: "fat_loss", experience: "intermediate", equipmentPreset: "bodyweight" })
    expect(slotCandidates(accessory, EXERCISES, fatLoss)!.exercises.some(isUnloadedPlyometric)).toBe(true)
    const fan = makeProfile({ goal: "strength", experience: "intermediate", equipmentPreset: "bodyweight", preferredExerciseIds: ["broad-jump"] })
    expect(slotCandidates(accessory, EXERCISES, fan)!.exercises.map((e) => e.id)).toContain("broad-jump")
  })
})

// ---------------------------------------------------------------------------------------------
// Coach round 2 (R05, R07, R13, R14, R16, R19, R27): selection rules checked against the real library.
// ---------------------------------------------------------------------------------------------

/** Picks for a slot across the 50 seeds. */
function picksFor(slot: SlotSpec, overrides: Partial<ScoreContext> & Pick<ScoreContext, "profile">): Exercise[] {
  return SEEDS.map((seed) => pickFor(slot, overrides, seed)).filter((e): e is Exercise => e !== null)
}

describe("beginner bodyweight regressions are judged within the variation family (R05)", () => {
  it("an endurance bodyweight beginner starts on knee or incline push-ups, never wide-grip or full push-ups", () => {
    const profile = makeProfile({ goal: "endurance", experience: "beginner", equipmentPreset: "bodyweight" })
    for (const pick of picksFor(slotOf("full_a", "secondary"), { profile })) {
      expect(["knee-push-up", "incline-push-up"], pick.id).toContain(pick.id)
    }
  })

  it("penalises a sibling variation when a beginner_friendly member of its family is in the slot", () => {
    const profile = makeProfile({ goal: "fat_loss", experience: "beginner", equipmentPreset: "bodyweight" })
    const slot = slotOf("full_a", "secondary")
    const withRegression = [ex("wide-grip-push-up"), ex("knee-push-up")]
    const withoutRegression = [ex("wide-grip-push-up"), ex("push-up")]
    const score = (peers: Exercise[]) => scoreCandidate(ex("wide-grip-push-up"), realCtx({ profile, slot, rng: createRng(3) }), peers)
    expect(score(withoutRegression) - score(withRegression)).toBeCloseTo(6)
  })

  it("the regression bonus is a tie-break among bodyweight variants, never a bonus over loadable lifts", () => {
    const profile = makeProfile({ goal: "general_fitness", experience: "beginner" })
    const slot = slotOf("full_a", "acc_pull")
    // A doorway row has no harder bodyweight member in its family: no +6, whatever the tag says.
    const peers = slotCandidates(slot, EXERCISES, profile)!.exercises
    const doorway = scoreCandidate(ex("doorway-row"), realCtx({ profile, slot, rng: createRng(2) }), peers)
    const machine = scoreCandidate(ex("machine-row"), realCtx({ profile, slot, rng: createRng(2) }), peers)
    expect(machine).toBeGreaterThan(doorway + 4)
  })

  it("a full-gym general-fitness beginner's second pull is never a doorway row", () => {
    const profile = makeProfile({ goal: "general_fitness", experience: "beginner" })
    const slot = slotOf("full_a", "acc_pull")
    for (const chosen of [[], ["leg-press", "machine-chest-press", "lat-pulldown"]]) {
      for (const pick of picksFor(slot, { profile, chosen: chosen.map(ex) })) expect(pick.id).not.toBe("doorway-row")
    }
  })

  it("an improvised no-equipment lift loses to the user's own kit for the same movement", () => {
    const profile = makeProfile({ goal: "general_fitness", experience: "intermediate", equipmentPreset: "home_gym", limitations: ["shoulder"] })
    const slot = slotOf("upper_a", "acc_pull")
    const picks = picksFor(slot, { profile })
    expect(picks.filter((e) => e.id === "doorway-row").length).toBe(0)
    // Without kit for the movement the improvised lift is still a candidate on equal terms.
    const bodyweight = makeProfile({ goal: "general_fitness", experience: "beginner", equipmentPreset: "bodyweight" })
    const peers = slotCandidates(slot, EXERCISES, bodyweight)!.exercises
    expect(peers.map((e) => e.id)).toContain("doorway-row")
  })

  it("a home-gym strength beginner's chest compound is a loadable press", () => {
    const profile = makeProfile({ goal: "strength", experience: "beginner", equipmentPreset: "home_gym" })
    for (const [template, key] of [["full_a", "secondary"], ["full_c", "primary"]] as const) {
      const picks = picksFor(slotOf(template, key), { profile })
      const loadable = picks.filter((e) => e.loadType === "external" || e.loadType === "assisted")
      expect(loadable.length / picks.length, `${template}/${key}: ${picks.map((e) => e.id).join(",")}`).toBeGreaterThanOrEqual(0.95)
      // Push-ups programmed at 8–12 cannot be a 3–6 strength lift while a dumbbell press is available.
      const options = slotCandidates(slotOf(template, key), EXERCISES, profile)!.exercises.map((e) => e.id)
      expect(options).not.toContain("incline-push-up")
      expect(options).not.toContain("knee-push-up")
    }
  })

  it("keeps the rep-fit penalty off a beginner's first knee push-ups in an endurance block, and only then", () => {
    const profile = makeProfile({ goal: "endurance", experience: "beginner", equipmentPreset: "bodyweight" })
    const slot = slotOf("full_a", "secondary")
    const peers = slotCandidates(slot, EXERCISES, profile)!.exercises
    const score = (performedIds?: ReadonlySet<string>) =>
      scoreCandidate(ex("knee-push-up"), realCtx({ profile, slot, rng: createRng(8), performedIds }), peers)
    // Logged: the +6 first-exposure bonus goes and the 8–15 range no longer escapes the misfit penalty.
    expect(score() - score(new Set(["knee-push-up"]))).toBeCloseTo(14)
  })
})

/** A completed workout of one split day holding `entries`, logged as given. */
function sameSplitLog(date: string, entries: { id: string; reps: number[]; kg?: number; floor?: number; status?: "completed" | "skipped" }[]): CompletedWorkout {
  return {
    id: `log-${date}`,
    date,
    title: "Upper A",
    split: "upper",
    focus: [],
    goal: "muscle_gain",
    startedAt: `${date}T07:00:00.000Z`,
    completedAt: `${date}T08:00:00.000Z`,
    durationSeconds: 3600,
    exercises: entries.map((e, i) => ({
      slotId: `s${i}`,
      exerciseId: e.id,
      role: "accessory" as const,
      phase: "main" as const,
      status: e.status ?? ("completed" as const),
      sets: e.reps.map((reps, n) => ({ setNumber: n + 1, weightKg: e.kg ?? 20, reps, completed: true })),
      prescribedSets: e.reps.length,
      prescribedReps: [e.floor ?? 8, 12] as [number, number],
      prescribedDurationSeconds: null,
      recommendedWeightKg: e.kg ?? 20,
    })),
    totals: { exercisesCompleted: entries.length, exercisesSkipped: 0, sets: 0, reps: 0, volumeKg: 0, caloriesEstimate: null },
    personalRecords: [],
    engineVersion: 1,
    synced: false,
  }
}

describe("support lifts keep their slot while they progress (R07)", () => {
  const row = "chest-supported-dumbbell-row"
  const weeks = (n: number, kg = (i: number) => 20 + (n - i) * 2) =>
    Array.from({ length: n }, (_, i) => sameSplitLog(`2026-09-${String(28 - i * 7).padStart(2, "0")}`, [{ id: row, reps: [10, 10, 10], kg: kg(i) }]))

  it("reports exposures, on-track and stalls from the split day's history", () => {
    expect(supportLiftStatus(row, weeks(1))).toMatchObject({ exposures: 1, onTrack: true, stalled: false, keep: true })
    expect(supportLiftStatus(row, weeks(4))).toMatchObject({ exposures: 4, keep: false })
    // Same load and reps three sessions running: two stalled sessions.
    expect(supportLiftStatus(row, weeks(3, () => 20))).toMatchObject({ stalled: true, keep: false })
    // A set below the range floor is not on track.
    const missed = [sameSplitLog("2026-09-28", [{ id: row, reps: [10, 9, 7], kg: 22 }])]
    expect(supportLiftStatus(row, missed)).toMatchObject({ onTrack: false, keep: false })
    // Skipped last time: no exposure to keep.
    const skipped = [sameSplitLog("2026-09-28", [{ id: row, reps: [], status: "skipped" }]), ...weeks(1)]
    expect(supportLiftStatus(row, skipped).exposures).toBe(0)
  })

  it("last week's accessory keeps its slot instead of rotating, and rotates at the block boundary", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "intermediate" })
    const slot = slotOf("upper_a", "acc_pull")
    const chosen = [ex("barbell-bench-press"), ex("lat-pulldown")]
    // Last week's Upper A: the same two compounds and this row.
    const lastSameSplitIds = new Set([row, "barbell-bench-press", "lat-pulldown"])
    for (const seed of SEEDS) {
      expect(pickFor(slot, { profile, chosen, lastSameSplitIds, sameSplitHistory: weeks(1) }, seed)!.id).toBe(row)
      expect(pickFor(slot, { profile, chosen, lastSameSplitIds, sameSplitHistory: weeks(4) }, seed)!.id).not.toBe(row)
      expect(pickFor(slot, { profile, chosen, lastSameSplitIds, sameSplitHistory: weeks(3, () => 20) }, seed)!.id).not.toBe(row)
    }
  })

  it("only one support lift rotates per session at the boundary", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "intermediate" })
    const slot = slotOf("upper_a", "acc_pull")
    const lastSameSplitIds = new Set([row, "barbell-bench-press", "lat-pulldown", "cable-lateral-raise"])
    // Another of today's lifts is already new to the split day: the boundary lift stays a session longer.
    const chosen = [ex("barbell-bench-press"), ex("lat-pulldown"), ex("dumbbell-lateral-raise")]
    for (const seed of SEEDS) expect(pickFor(slot, { profile, chosen, lastSameSplitIds, sameSplitHistory: weeks(4) }, seed)!.id).toBe(row)
  })

  it("without the split day's history, support work rotates as before", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "intermediate" })
    const slot = slotOf("upper_a", "acc_pull")
    const peers = slotCandidates(slot, EXERCISES, profile)!.exercises
    const score = (extra: Partial<ScoreContext>) => scoreCandidate(ex(row), realCtx({ profile, slot, rng: createRng(4), ...extra }), peers)
    expect(score({}) - score({ lastSameSplitIds: new Set([row]) })).toBeCloseTo(12)
    expect(score({ lastSameSplitIds: new Set([row]), sameSplitHistory: weeks(1) }) - score({})).toBeCloseTo(6)
  })
})

describe("band-only lifts are not loadable and joint stacking is a lower-back rule (R13)", () => {
  it("treats band-only lifts as unloadable", () => {
    expect(isLoadable(ex("band-fly"))).toBe(false)
    expect(isLoadable(ex("band-lateral-raise"))).toBe(false)
    expect(isLoadable(ex("band-assisted-pull-up"))).toBe(true)
    expect(isLoadable(ex("cable-fly"))).toBe(true)
  })

  it("an advanced full-gym hypertrophy push day rarely flies with a band", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "advanced" })
    const chosen = ["barbell-bench-press", "overhead-press", "incline-dumbbell-press", "dumbbell-lateral-raise"].map(ex)
    const picks = picksFor(slotOf("push_a", "iso_chest"), { profile, chosen })
    expect(picks.filter((e) => e.id === "band-fly").length / picks.length).toBeLessThan(0.1)
  })

  it("a full-gym strength delt slot is never a band lateral raise", () => {
    for (const experience of ["intermediate", "advanced"] as const) {
      const profile = makeProfile({ goal: "strength", experience })
      const chosen = [ex("barbell-bench-press"), ex("overhead-press")]
      for (const pick of picksFor(slotOf("push_a", "iso_delts"), { profile, chosen })) expect(pick.id).not.toBe("band-lateral-raise")
    }
  })

  it("a trained fat-loss lifter with cables and machines does not row with a band", () => {
    const profile = makeProfile({ goal: "fat_loss", experience: "intermediate", limitations: ["knee"] })
    const chosen = [ex("dumbbell-bench-press"), ex("lat-pulldown")]
    for (const pick of picksFor(slotOf("upper_a", "acc_pull"), { profile, chosen })) expect(pick.id).not.toBe("band-row")
  })

  it("scores a hypertrophy accessory in a strength rep window down unless it spares a flagged area", () => {
    const slot = slotOf("push_a", "accessory")
    const base = { category: "chest" as const, primary: "chest" as const, pattern: "horizontal_push" as const, equipment: ["dumbbell" as const], tags: ["shoulder_friendly"] }
    const heavy = makeExercise({ ...base, id: "heavy-press", reps: [4, 8] })
    const normal = makeExercise({ ...base, id: "normal-press", reps: [8, 12] })
    const score = (e: Exercise, limitations: ("shoulder")[] = []) =>
      scoreCandidate(e, realCtx({ profile: makeProfile({ goal: "muscle_gain", limitations }), slot, rng: createRng(5) }))
    expect(score(normal) - score(heavy)).toBeCloseTo(6)
    expect(score(normal, ["shoulder"]) - score(heavy, ["shoulder"])).toBeCloseTo(0)
  })
})

describe("flagged areas get a soft preference on top of the hard filter (R14)", () => {
  it("prefers supported and friendly lifts and scores trunk-braced ones down for a flagged lower back", () => {
    const flagged = makeProfile({ limitations: ["lower_back"] })
    expect(limitationPreference(ex("seal-row"), flagged)).toBe(4)
    expect(limitationPreference(ex("chest-supported-dumbbell-row"), flagged)).toBe(4)
    expect(limitationPreference(ex("renegade-row"), flagged)).toBe(-4)
    expect(limitationPreference(ex("bodyweight-single-leg-rdl"), flagged)).toBe(-4)
    expect(limitationPreference(ex("band-fly"), makeProfile({ limitations: ["shoulder"] }))).toBe(4)
    expect(limitationPreference(ex("renegade-row"), makeProfile())).toBe(0)
  })

  it("a lower-back-flagged strength lifter's back accessory is a supported or lower-back-friendly row, never a renegade row", () => {
    const profile = makeProfile({ goal: "strength", experience: "intermediate", limitations: ["lower_back"], trainingDaysPerWeek: 3 })
    const picks = picksFor(slotOf("full_a", "accessory"), { profile, chosen: [ex("leg-press"), ex("barbell-bench-press")] })
    for (const pick of picks) expect(pick.id).not.toBe("renegade-row")
    const supported = picks.filter((e) => e.movementPattern === "horizontal_pull" && (isTorsoSupported(e) || !!e.tags?.includes("lower_back_friendly")))
    expect(supported.length / picks.length, picks.map((e) => e.id).join(",")).toBeGreaterThanOrEqual(0.9)
  })

  it("a beginner takes the row or fly that spares the lower back when the movement has one", () => {
    const profile = makeProfile({ goal: "strength", experience: "beginner", equipmentPreset: "home_gym" })
    const slot = slotOf("full_a", "accessory")
    const peers = [ex("kettlebell-row"), ex("single-arm-dumbbell-row")]
    const score = (others: Exercise[]) => scoreCandidate(ex("kettlebell-row"), realCtx({ profile, slot, rng: createRng(7) }), others)
    expect(score([ex("kettlebell-row")]) - score(peers)).toBeCloseTo(5)
  })

  it("a home-gym beginner never gets two lower-back-loading pulls in a day while supported ones exist", () => {
    const profile = makeProfile({ goal: "strength", experience: "beginner", equipmentPreset: "home_gym", trainingDaysPerWeek: 3 })
    const history: CompletedWorkout[] = []
    for (const day of [1, 3, 5, 8, 10, 12]) {
      const date = `2026-10-${String(day).padStart(2, "0")}`
      const w = generateWorkout(makeInput(profile, date, history.slice(), progressFromHistory(history)))
      const pulls = w.exercises
        .filter((e) => e.phase === "main" && e.role !== "finisher")
        .map((e) => ex(e.exerciseId))
        .filter((e) => (e.movementPattern === "horizontal_pull" || e.movementPattern === "vertical_pull") && e.contraindications.includes("lower_back"))
      expect(pulls.length, `${date}: ${pulls.map((e) => e.id).join(", ")}`).toBeLessThanOrEqual(1)
      history.unshift(completeAtTop(w, getExercise))
    }
  })
})

describe("finishers are interval work, never steady blocks (R16)", () => {
  it("steady-state work is never a finisher", () => {
    expect(fitsFinisher(ex("march-in-place"))).toBe(false)
    expect(fitsFinisher(ex("jump-rope"))).toBe(false)
    expect(fitsFinisher(ex("fast-feet"))).toBe(true)
    for (const e of EXERCISES) {
      if (e.tags?.includes("steady_state")) expect(fitsFinisher(e), e.id).toBe(false)
      if (fitsFinisher(e) && e.durationRange) expect(e.durationRange[0], e.id).toBeLessThan(300)
    }
  })

  it("caps a finisher's recency and rotation penalties so a repeated interval drill still wins", () => {
    const profile = makeProfile({ goal: "fat_loss", experience: "beginner", equipmentPreset: "bodyweight" })
    const score = (extra: Partial<ScoreContext>) => scoreCandidate(ex("fast-feet"), realCtx({ profile, slot: FINISHER_SLOT, rng: createRng(3), ...extra }))
    expect(score({}) - score({ lastSameSplitIds: new Set(["fast-feet"]), recentIds: new Map([["fast-feet", 0]]) })).toBeCloseTo(4)
  })

  it("a fat-loss bodyweight beginner's finisher over 15 days is never steady work or shorter than its own minimum", () => {
    const profile = makeProfile({ goal: "fat_loss", experience: "beginner", equipmentPreset: "bodyweight", trainingDaysPerWeek: 3 })
    const history: CompletedWorkout[] = []
    for (let day = 1; day <= 15; day++) {
      if (![1, 3, 5, 8, 10, 12, 15].includes(day)) continue
      const date = `2026-10-${String(day).padStart(2, "0")}`
      const w = generateWorkout(makeInput(profile, date, history.slice(), progressFromHistory(history)))
      for (const f of w.exercises.filter((e) => e.role === "finisher")) {
        const e = ex(f.exerciseId)
        expect(e.tags ?? [], `${date}: ${e.id}`).not.toContain("steady_state")
        if (f.durationSeconds !== null && e.durationRange) expect(f.durationSeconds, `${date}: ${e.id}`).toBeGreaterThanOrEqual(e.durationRange[0])
      }
      history.unshift(completeAtTop(w, getExercise))
    }
  })
})

describe("lower-body isolation slots get loadable or hamstring work in strength and hypertrophy blocks (R19)", () => {
  it("a dumbbell hypertrophy beginner's hamstring slot is a loadable or knee-flexion exercise", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "beginner", equipmentPreset: "dumbbells", trainingDaysPerWeek: 3 })
    const chosen = ["goblet-squat", "incline-dumbbell-press", "single-arm-dumbbell-row"].map(ex)
    const picks = picksFor(slotOf("full_a", "iso_hams"), { profile, chosen })
    const good = picks.filter((e) => isLoadable(e) || e.movementPattern === "knee_flexion")
    expect(good.length / picks.length, picks.map((e) => e.id).join(",")).toBeGreaterThanOrEqual(0.9)
    for (const pick of picks) expect(pick.tags ?? [], pick.id).not.toContain("abduction")
  })

  it("falls back to a hamstring hinge before glute drills only when no knee-flexion lift is available", () => {
    const slot = slotOf("full_a", "iso_hams")
    // The library now has a bodyweight slider hamstring curl (R19 data), so the dumbbell preset has
    // a knee-flexion lift; excluding it recreates the "no knee flexion" case.
    const withCurl = slotCandidates(slot, EXERCISES, makeProfile({ goal: "muscle_gain", experience: "beginner", equipmentPreset: "dumbbells" }))!
    expect(withCurl.exercises.map((e) => e.id)).toContain("slider-hamstring-curl")
    const noCurl = makeProfile({ goal: "muscle_gain", experience: "beginner", equipmentPreset: "dumbbells", excludedExerciseIds: ["slider-hamstring-curl"] })
    const dumbbells = slotCandidates(slot, EXERCISES, noCurl)!
    expect(dumbbells.exercises.every((e) => muscleGroupOf(e) === "hamstrings"), dumbbells.exercises.map((e) => e.id).join(",")).toBe(true)
    expect(dumbbells.exercises.map((e) => e.id)).toContain("dumbbell-romanian-deadlift")
    const gym = slotCandidates(slot, EXERCISES, makeProfile({ goal: "muscle_gain", experience: "beginner" }))!
    expect(gym.exercises.some((e) => e.movementPattern === "knee_flexion")).toBe(true)
  })

  it("the isolation bonus goes to loadable work, and a slot's only loadable lift is not rotated out", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "beginner", equipmentPreset: "dumbbells" })
    const slot = slotOf("full_c", "iso_glutes")
    const peers = slotCandidates(slot, EXERCISES, profile)!.exercises
    const score = (id: string, extra: Partial<ScoreContext> = {}) => scoreCandidate(ex(id), realCtx({ profile, slot, rng: createRng(6), ...extra }), peers)
    expect(score("dumbbell-hip-thrust")).toBeGreaterThan(score("reverse-hyperextension") + 2)
    expect(score("dumbbell-hip-thrust", { lastSameSplitIds: new Set(["dumbbell-hip-thrust"]) })).toBeCloseTo(score("dumbbell-hip-thrust"))
    // In a conditioning goal the bodyweight drill keeps its isolation bonus.
    const fatLoss = makeProfile({ goal: "general_fitness", experience: "beginner", equipmentPreset: "dumbbells" })
    const fl = (id: string) => scoreCandidate(ex(id), realCtx({ profile: fatLoss, slot, rng: createRng(6) }), peers)
    expect(fl("reverse-hyperextension") - score("reverse-hyperextension")).toBeGreaterThanOrEqual(6 - 5)
  })
})

describe("smaller selection gaps (R27)", () => {
  it("a push day with a front-delt press fills the delt slot with side or rear delt work", () => {
    for (const goal of ["endurance", "muscle_gain", "general_fitness"] as const) {
      const profile = makeProfile({ goal, experience: "intermediate" })
      const chosen = [ex("dumbbell-bench-press"), ex("seated-dumbbell-shoulder-press")]
      const slot = slotOf("push_a", "iso_delts")
      expect(slotCandidates(slot, EXERCISES, profile, { chosen })!.exercises.some((e) => e.movementPattern === "shoulder_abduction")).toBe(true)
      for (const pick of picksFor(slot, { profile, chosen })) {
        expect(pick.movementPattern === "shoulder_flexion" && pick.primaryMuscle === "front_delts", `${goal}: ${pick.id}`).toBe(false)
      }
    }
  })

  it("the difficulty-match bonus applies to compound slots only", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "intermediate" })
    const base = { category: "back" as const, primary: "upper_back" as const, pattern: "horizontal_pull" as const, equipment: ["dumbbell" as const], force: "pull" as const }
    const easy = makeExercise({ ...base, id: "easy-row", difficulty: "beginner" })
    const match = makeExercise({ ...base, id: "match-row", difficulty: "intermediate" })
    const score = (e: Exercise, slot: SlotSpec) => scoreCandidate(e, realCtx({ profile, slot, rng: createRng(1) }))
    expect(score(match, slotOf("upper_a", "acc_pull"))).toBeCloseTo(score(easy, slotOf("upper_a", "acc_pull")))
    expect(score(match, slotOf("pull_b", "primary")) - score(easy, slotOf("pull_b", "primary"))).toBeCloseTo(3)
  })

  it("trained lifters' trunk work goes by closeness to their level", () => {
    const slot = slotOf("full_a", "core")
    const base = { category: "core" as const, primary: "abs" as const, pattern: "anti_extension" as const, mechanics: "isolation" as const, equipment: ["bodyweight" as const], loadType: "bodyweight" as const, force: "static" as const }
    const drill = makeExercise({ ...base, id: "drill", difficulty: "beginner" })
    const hard = makeExercise({ ...base, id: "hard", difficulty: "advanced" })
    const score = (e: Exercise, experience: "beginner" | "advanced") => scoreCandidate(e, realCtx({ profile: makeProfile({ experience }), slot, rng: createRng(1) }))
    expect(score(hard, "advanced") - score(drill, "advanced")).toBeCloseTo(3)
  })

  it("a squat after a barbell RDL primary, or one another lower day just used, is not the second lower compound", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "intermediate" })
    const slot = slotOf("legs_b", "secondary")
    for (const pick of picksFor(slot, { profile, chosen: [ex("romanian-deadlift")] })) expect(pick.id).not.toBe("barbell-back-squat")
    // Lower A's squat in the last few sessions: Lower B's second lower compound is a different lift.
    const recentIds = new Map([["barbell-back-squat", 1], ["leg-press", 1]])
    for (const pick of picksFor(slot, { profile, chosen: [ex("trap-bar-deadlift")], recentIds })) {
      expect(["barbell-back-squat", "leg-press"]).not.toContain(pick.id)
    }
  })

  it("Lower A and Lower B do not share their second lower compound", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "intermediate", trainingDaysPerWeek: 4 })
    const history: CompletedWorkout[] = []
    const secondaries = new Map<string, Set<string>>()
    for (const day of [5, 6, 8, 9, 12, 13, 15, 16]) {
      const date = `2026-10-${String(day).padStart(2, "0")}`
      const w = generateWorkout(makeInput(profile, date, history.slice(), progressFromHistory(history)))
      if (w.split === "lower") {
        const secondary = w.exercises.find((e) => e.role === "secondary_compound")
        if (secondary) secondaries.set(w.title, new Set([...(secondaries.get(w.title) ?? []), secondary.exerciseId]))
      }
      history.unshift(completeAtTop(w, getExercise))
    }
    const [a, b] = [secondaries.get("Lower A"), secondaries.get("Lower B")]
    expect(a && b, [...secondaries.keys()].join(",")).toBeTruthy()
    for (const id of a!) expect(b!.has(id), `${id} in both lower days`).toBe(false)
  })

  it("a primary slot takes the two-arm member of a family over the one-arm one", () => {
    const slot = slotOf("full_c", "primary")
    const base = { category: "chest" as const, primary: "chest" as const, pattern: "horizontal_push" as const, equipment: ["dumbbell" as const] }
    const twoArm = makeExercise({ ...base, id: "two-arm-press" })
    const oneArm = { ...makeExercise({ ...base, id: "one-arm-press", unilateral: true }), variationOf: "two-arm-press" }
    const score = (peers: Exercise[]) => scoreCandidate(oneArm, realCtx({ profile: makeProfile(), slot, rng: createRng(1) }), peers)
    expect(score([oneArm]) - score([oneArm, twoArm])).toBeCloseTo(3)
  })
})

describe("selection follow-ups (coach round 2, R12, R09)", () => {
  const workoutWith = (exerciseId: string, suggestedExerciseId: string | null): CompletedWorkout => ({
    id: "w",
    date: "2026-10-01",
    title: "Upper A",
    split: "upper",
    focus: ["chest"],
    goal: "muscle_gain",
    startedAt: "2026-10-01T07:00:00.000Z",
    completedAt: "2026-10-01T08:00:00.000Z",
    durationSeconds: 3600,
    exercises: [
      {
        slotId: "s",
        exerciseId,
        role: "primary_compound",
        phase: "main",
        status: "completed",
        sets: [{ setNumber: 1, weightKg: null, reps: 12, completed: true }],
        prescribedSets: 1,
        prescribedReps: [10, 12],
        prescribedDurationSeconds: null,
        recommendedWeightKg: null,
        suggestedExerciseId,
      },
    ],
    totals: { exercisesCompleted: 1, exercisesSkipped: 0, sets: 1, reps: 12, volumeKg: 0, caloriesEstimate: null },
    personalRecords: [],
    engineVersion: 1,
    synced: true,
  })

  it("a bodyweight lift that earned a harder variation no longer holds a hypertrophy compound slot for consistency (R12)", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "intermediate", equipmentPreset: "bodyweight" })
    const slot = slotOf("upper_a", "primary")
    const pushUp = ex("push-up")
    const score = (suggested: string | null) =>
      scoreCandidate(pushUp, realCtx({ profile, slot, lastSameSplitIds: new Set(["push-up"]), sameSplitHistory: [workoutWith("push-up", suggested)] }))
    expect(score(null) - score("decline-push-up")).toBeCloseTo(10)
    // In a conditioning goal the lift keeps its slot as before.
    const general = makeProfile({ goal: "general_fitness", experience: "intermediate", equipmentPreset: "bodyweight" })
    const g = (suggested: string | null) =>
      scoreCandidate(pushUp, realCtx({ profile: general, slot, lastSameSplitIds: new Set(["push-up"]), sameSplitHistory: [workoutWith("push-up", suggested)] }))
    expect(g(null)).toBeCloseTo(g("decline-push-up"))
  })

  it("a pull in the plane the day has not trained yet is not penalised as a repeat of the row (R09)", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "intermediate" })
    const slot = slotOf("full_a", "acc_pull")
    // Both lat-primary compounds: the row was the same-primary -6's case before R09.
    const row = ex("single-arm-dumbbell-row")
    const pulldown = ex("lat-pulldown")
    expect(row.primaryMuscle).toBe(pulldown.primaryMuscle)
    const withRow = scoreCandidate(pulldown, realCtx({ profile, slot, chosen: [row] }))
    const alone = scoreCandidate(pulldown, realCtx({ profile, slot, chosen: [] }))
    // A second row would still pay it.
    const secondRow = scoreCandidate(ex("single-arm-cable-row"), realCtx({ profile, slot, chosen: [row] }))
    const secondRowAlone = scoreCandidate(ex("single-arm-cable-row"), realCtx({ profile, slot, chosen: [] }))
    expect(alone - withRow).toBeLessThan(secondRowAlone - secondRow)
  })
})


// ---------------------------------------------------------------------------------------------
// Core programming spec (C06-C13, C20): core-slot selection against the real library.
// ---------------------------------------------------------------------------------------------

describe("core slots (core spec)", () => {
  const coreSlot = slotOf("full_a", "core")
  const SEEDS_100 = Array.from({ length: 100 }, (_, i) => i + 1)
  const noHistory = { familiesLast7: new Set<never>(), lastFamily: null, flexionLast7: 0 }
  const candidatesFor = (profile: ReturnType<typeof makeProfile>, chosen: Exercise[] = []) =>
    slotCandidates(coreSlot, EXERCISES, profile, { chosen })!.exercises

  it("C06: a shoulder-flagged dumbbell lifter reaches the suitcase carry at match level 0", () => {
    const profile = makeProfile({ goal: "general_fitness", experience: "intermediate", equipmentPreset: "dumbbells", limitations: ["shoulder"] })
    const found = slotCandidates(coreSlot, EXERCISES, profile)!
    expect(found.level).toBe(0)
    expect(found.exercises.map((e) => e.id)).toContain("suitcase-carry")
    expect(coreFamily(ex("suitcase-carry"))).toBe("anti_lateral")
    // Full-body carries stay conditioning, never trunk work.
    for (const e of EXERCISES.filter((x) => x.movementPattern === "carry" && x.category !== "core")) {
      expect(matchesSlot(e, coreSlot, 0), e.id).toBe(false)
      expect(coreFamily(e), e.id).toBeNull()
    }
  })

  it("C07: families map from the pattern, with side bends as flexion and no family for hip extension", () => {
    expect(coreFamily(ex("plank"))).toBe("anti_extension")
    expect(coreFamily(ex("pallof-press"))).toBe("anti_rotation")
    expect(coreFamily(ex("side-plank"))).toBe("anti_lateral")
    expect(coreFamily(ex("cable-crunch"))).toBe("flexion_rotation")
    expect(coreFamily(ex("cable-woodchop"))).toBe("flexion_rotation")
    expect(coreFamily({ ...ex("dumbbell-side-bend"), movementPattern: "anti_lateral_flexion", tags: ["lateral_flexion"] })).toBe("flexion_rotation")
    expect(coreFamily(ex("back-extension"))).toBeNull()
    expect(coreFamily(ex("mountain-climber"))).toBeNull()
    expect(coreFamily(ex("barbell-back-squat"))).toBeNull()
  })

  it("C07: a family missing from the week outranks the one the last session trained", () => {
    const profile = makeProfile({ goal: "general_fitness", experience: "intermediate" })
    const peers = candidatesFor(profile)
    const core = { familiesLast7: new Set(["anti_extension" as const]), lastFamily: "anti_extension" as const, flexionLast7: 0 }
    for (const seed of SEEDS) {
      const score = (id: string) => scoreCandidate(ex(id), realCtx({ profile, slot: coreSlot, rng: createRng(seed), core }), peers)
      expect(score("pallof-press"), `seed ${seed}`).toBeGreaterThan(score("dead-bug"))
    }
    // The +8 and -6 are relative to the same drill without history.
    const plain = scoreCandidate(ex("dead-bug"), realCtx({ profile, slot: coreSlot, rng: createRng(3) }), peers)
    const seen = scoreCandidate(ex("dead-bug"), realCtx({ profile, slot: coreSlot, rng: createRng(3), core }), peers)
    const fresh = scoreCandidate(ex("dead-bug"), realCtx({ profile, slot: coreSlot, rng: createRng(3), core: noHistory }), peers)
    expect(plain - seen).toBeCloseTo(-CORE_SCORE.lastFamily)
    expect(fresh - plain).toBeCloseTo(CORE_SCORE.missingFamily)
  })

  it("C08: with no history a trained strength lifter's trunk work is anti-extension or anti-lateral", () => {
    const profile = makeProfile({ goal: "strength", experience: "intermediate" })
    const picks = SEEDS_100.map((seed) => pickFor(coreSlot, { profile, core: noHistory }, seed)!)
    const emphasised = picks.filter((e) => coreFamily(e) === "anti_extension" || coreFamily(e) === "anti_lateral")
    expect(emphasised.length, picks.map((e) => e.id).join(",")).toBeGreaterThanOrEqual(90)
  })

  it("C08: once the week has a flexion exposure a fat-loss beginner gets anti-movement work", () => {
    const profile = makeProfile({ goal: "fat_loss", experience: "beginner" })
    const core = { familiesLast7: new Set(["flexion_rotation" as const]), lastFamily: "flexion_rotation" as const, flexionLast7: 1 }
    expect(candidatesFor(profile).some((e) => coreFamily(e) !== "flexion_rotation")).toBe(true)
    for (const seed of SEEDS_100) {
      const pick = pickFor(coreSlot, { profile, core }, seed)!
      expect(coreFamily(pick), `seed ${seed}: ${pick.id}`).not.toBe("flexion_rotation")
    }
    // Trained hypertrophy lifters are not capped: loaded flexion stays weekly.
    const hypertrophy = makeProfile({ goal: "muscle_gain", experience: "advanced" })
    const peers = candidatesFor(hypertrophy)
    const score = (flexionLast7: number) =>
      scoreCandidate(ex("cable-crunch"), realCtx({ profile: hypertrophy, slot: coreSlot, rng: createRng(2), core: { ...core, flexionLast7 } }), peers)
    expect(score(1)).toBeCloseTo(score(0))
  })

  it("C09: the overlap penalty is limited to real same-structure conflicts", () => {
    const profile = makeProfile({ goal: "muscle_gain", experience: "advanced" })
    // (1) A back squat lists the knee; a cable crunch's kneeling position no longer costs it.
    const crunch = (chosen: Exercise[]) => scoreCandidate(ex("cable-crunch"), realCtx({ profile, slot: coreSlot, chosen, rng: createRng(5) }))
    expect(crunch([ex("barbell-back-squat")])).toBeCloseTo(crunch([]))
    // (2) Grip after a trap-bar deadlift: carries and hanging work lose 8, a Pallof press does not.
    const trapBar = [ex("trap-bar-deadlift")]
    expect(coreOverlapPenalty(ex("suitcase-carry"), trapBar)).toBe(CORE_SCORE.overlap)
    expect(coreOverlapPenalty(ex("hanging-knee-raise"), trapBar)).toBe(CORE_SCORE.overlap)
    expect(coreOverlapPenalty(ex("pallof-press"), trapBar)).toBe(0)
    // (3) Shoulder after a bench press: hanging work loses 8, a side plank does not.
    const bench = [ex("barbell-bench-press")]
    expect(coreOverlapPenalty(ex("hanging-leg-raise"), bench)).toBe(CORE_SCORE.overlap)
    expect(coreOverlapPenalty(ex("side-plank"), bench)).toBe(0)
    // (4) Lower back after a conventional deadlift: a rollout loses 8.
    expect(coreOverlapPenalty(ex("ab-wheel-rollout"), [ex("conventional-deadlift")])).toBe(CORE_SCORE.overlap)
    // Two compound pulls also tax the grip.
    expect(coreOverlapPenalty(ex("suitcase-carry"), [ex("lat-pulldown"), ex("seated-cable-row")])).toBe(CORE_SCORE.overlap)
    expect(coreOverlapPenalty(ex("suitcase-carry"), [ex("lat-pulldown")])).toBe(0)
  })

  it("C10: one-sided trunk drills are not penalised after one-sided lifts", () => {
    const profile = makeProfile({ goal: "general_fitness", experience: "intermediate" })
    const chosen = [ex("bulgarian-split-squat"), ex("single-arm-dumbbell-row")]
    expect(chosen.every((e) => e.isUnilateral)).toBe(true)
    const score = (picked: Exercise[]) => scoreCandidate(ex("pallof-press"), realCtx({ profile, slot: coreSlot, chosen: picked, rng: createRng(7) }))
    expect(score(chosen)).toBeCloseTo(score([]))
  })

  it("C11: a trained strength lifter's trunk work is loadable", () => {
    const profile = makeProfile({ goal: "strength", experience: "advanced" })
    const chosen = [ex("barbell-back-squat")]
    const picks = SEEDS_100.map((seed) => pickFor(coreSlot, { profile, chosen, core: noHistory }, seed)!)
    expect(picks.filter(loadableTrunk).length, picks.map((e) => e.id).join(",")).toBeGreaterThanOrEqual(80)
    expect(loadableTrunk(ex("suitcase-carry"))).toBe(true)
    expect(loadableTrunk(ex("cable-crunch"))).toBe(true)
    expect(loadableTrunk(ex("plank"))).toBe(false)
  })

  it("C12: hip-flexor-led floor drills give way for beginners and trained lifters with loadable options", () => {
    const beginner = makeProfile({ goal: "fat_loss", experience: "beginner", equipmentPreset: "bodyweight" })
    const peers = candidatesFor(beginner)
    expect(peers.map((e) => e.id)).toEqual(expect.arrayContaining(["seated-knee-tuck", "dead-bug"]))
    for (const seed of SEEDS) {
      const ranked = rankCandidates(peers, realCtx({ profile: beginner, slot: coreSlot, rng: createRng(seed) })).map((c) => c.exercise.id)
      expect(ranked.indexOf("seated-knee-tuck"), `seed ${seed}`).toBeGreaterThan(ranked.indexOf("dead-bug"))
    }
    const lifter = makeProfile({ goal: "muscle_gain", experience: "intermediate" })
    const gym = candidatesFor(lifter)
    const untagged = (e: Exercise): Exercise => ({ ...e, tags: (e.tags ?? []).filter((t) => t !== "hip_flexor_led") })
    const penalty = (e: Exercise) =>
      scoreCandidate(e, realCtx({ profile: lifter, slot: coreSlot, rng: createRng(4) }), gym) -
      scoreCandidate(untagged(e), realCtx({ profile: lifter, slot: coreSlot, rng: createRng(4) }), gym)
    const tagged = (e: Exercise, tags: string[]): Exercise => ({ ...e, tags: [...new Set([...(e.tags ?? []), ...tags])] })
    expect(penalty(tagged(ex("flutter-kick"), ["hip_flexor_led"]))).toBeCloseTo(CORE_SCORE.hipFlexorLed)
    expect(penalty(tagged(ex("hanging-knee-raise"), ["hip_flexor_led", "hanging"]))).toBeCloseTo(0)
  })

  it("C13: mountain climbers are conditioning: never a core slot, possibly a finisher", () => {
    const climber = ex("mountain-climber")
    expect(isConditioning(climber)).toBe(true)
    for (const level of [0, 1, 2, 3, 4] as const) expect(matchesSlot(climber, coreSlot, level)).toBe(false)
    expect(fitsFinisher(climber)).toBe(true)
  })

  it("C20: a flagged lower back prefers anti-movement work, and a favourite still wins", () => {
    const profile = makeProfile({ goal: "strength", experience: "intermediate", limitations: ["lower_back"] })
    const peers = candidatesFor(profile)
    expect(peers.map((e) => e.id)).toEqual(expect.arrayContaining(["cable-crunch", "pallof-press"]))
    let below = 0
    for (const seed of SEEDS_100) {
      const ranked = rankCandidates(peers, realCtx({ profile, slot: coreSlot, rng: createRng(seed), core: noHistory })).map((c) => c.exercise.id)
      if (ranked.indexOf("cable-crunch") > ranked.indexOf("pallof-press")) below++
    }
    expect(below).toBeGreaterThanOrEqual(90)
    const fan = makeProfile({ goal: "strength", experience: "intermediate", limitations: ["lower_back"], preferredExerciseIds: ["cable-crunch"] })
    for (const seed of SEEDS) expect(pickFor(coreSlot, { profile: fan, core: noHistory }, seed)!.id).toBe("cable-crunch")
  })
})
