import { describe, expect, it } from "vitest"
import type { Exercise, Goal } from "@/lib/exercises/types"
import { EQUIPMENT_PRESETS, type Experience, type SetLog } from "@/lib/domain/types"
import { EXERCISES, requireExercise } from "@/lib/exercises"
import {
  applyShortCoreDose,
  BEGINNER_FINISHER_EXTRA_SECONDS,
  CALIBRATION_RIR,
  CONDITIONING_TRUNK_REST,
  coreHoldCeiling,
  easierVariation,
  finisherBlockSeconds,
  finisherBudgetSeconds,
  FINISHER_BUDGET_TOLERANCE,
  FIRST_EXPOSURE_NOTE_PREFIX,
  FIRST_HOLD_NOTE_PREFIX,
  fitsFinisherBudget,
  GOAL_PRESCRIPTIONS,
  intersectRange,
  isAntiMovementTrunk,
  isPlyometricPrimer,
  isTimed,
  prescribe,
  prescribeDuration,
  prescribeFinisher,
  prescribeLight,
  prescribeReps,
  prescribeRest,
  prescribeRir,
  protectedRestSeconds,
  repRangeFitsGoal,
  restCeiling,
  setBounds,
  SHORT_CORE_HOLD_SECONDS,
  slowerEccentricTempo,
  UNPROVEN_SUPPORT_RIR,
  type MainRole,
  type PrescribeContext,
} from "./prescriptions"
import type { LastPerformance } from "./progression"
import { passesProfileFilter } from "./selection"
import { FIXTURE_BY_ID, makeProfile } from "./test-fixtures"

const bench = FIXTURE_BY_ID.get("barbell-bench-press")!
const curl = FIXTURE_BY_ID.get("dumbbell-curl")!
const plank = FIXTURE_BY_ID.get("plank")!
const pushUp = FIXTURE_BY_ID.get("push-up")!

const GOALS: Goal[] = ["strength", "muscle_gain", "fat_loss", "general_fitness", "endurance"]
const LEVELS: Experience[] = ["beginner", "intermediate", "advanced"]
const ROLES: MainRole[] = ["primary_compound", "secondary_compound", "accessory", "isolation", "finisher"]
const WORK_ROLES: Exclude<MainRole, "finisher">[] = ["primary_compound", "secondary_compound", "accessory", "isolation"]
const REP_BASED = EXERCISES.filter((e) => !isTimed(e) && e.repRange && !["warmup", "cooldown", "stretching", "mobility"].includes(e.category))

/** A completed session: one entry per set, filled in with the defaults of a plain "done". */
function lastOf(sets: Partial<SetLog>[], prescribedReps: [number, number] | null = null): LastPerformance {
  return {
    sets: sets.map((s, i) => ({ setNumber: i + 1, weightKg: null, reps: null, durationSeconds: null, completed: true, ...s })),
    prescribedReps,
    date: "2026-10-01",
  }
}
function times<T>(n: number, value: T): T[] {
  return Array.from({ length: n }, () => value)
}
/** History with a logged working weight: the load is proven. */
const loaded = (weightKg = 40): PrescribeContext => ({ last: lastOf(times(3, { weightKg, reps: 8 })) })

describe("prescriptions", () => {
  it("intersectRange", () => {
    expect(intersectRange([3, 6], [4, 10])).toEqual([4, 6])
    expect(intersectRange([3, 6], [8, 12])).toBeNull()
  })

  it("stays inside the goal table for every goal × experience", () => {
    for (const goal of GOALS) {
      const g = GOAL_PRESCRIPTIONS[goal]
      for (const experience of LEVELS) {
        for (const role of ["primary_compound", "secondary_compound", "accessory", "isolation"] as const) {
          const rx = prescribe(bench, goal, experience, role)
          // Coach round 2 (R22): a strength beginner's support work may start at two sets.
          const supportFloor = goal === "strength" && experience === "beginner" && (role === "accessory" || role === "isolation") ? 2 : g.sets[0]
          expect(rx.sets).toBeGreaterThanOrEqual(supportFloor)
          expect(rx.sets).toBeLessThanOrEqual(g.sets[1])
          expect(rx.reps).not.toBeNull()
          const [lo, hi] = rx.reps!
          expect(lo).toBeLessThanOrEqual(hi)
          // Bench range is 4–10; goal ∩ exercise when it spans at least two reps. Coach review F01:
          // a one-rep overlap (fat loss 10–15) is widened inside the bench's own range (7–10)
          // instead of collapsing to 10–10.
          const inter = intersectRange(g.reps, bench.repRange!)
          if (inter && inter[1] - inter[0] >= 2) {
            expect(lo).toBeGreaterThanOrEqual(inter[0])
            expect(hi).toBeLessThanOrEqual(inter[1])
          } else if (inter) {
            expect(lo).toBeGreaterThanOrEqual(bench.repRange![0])
            expect(hi).toBeLessThanOrEqual(bench.repRange![1])
            expect(lo <= inter[0] && hi >= inter[1]).toBe(true)
            expect(hi - lo).toBeGreaterThanOrEqual(2)
          }
          expect(rx.restSeconds).toBeGreaterThanOrEqual(Math.min(g.rest[0], bench.restRange[0]))
          // Coach review F27: a heavy (ramp-up) compound in a hypertrophy block rests up to 180 s,
          // not the goal table's 120 s; everything else stays inside the goal's rest range.
          const heavyHypertrophy = goal === "muscle_gain" && bench.warmupRequired && (role === "primary_compound" || role === "secondary_compound")
          expect(rx.restSeconds).toBeLessThanOrEqual(heavyHypertrophy ? 180 : g.rest[1])
          expect(rx.rir).toBeGreaterThanOrEqual(g.rir[0])
          expect(rx.rir).toBeLessThanOrEqual(g.rir[1])
          expect(rx.minSets).toBeLessThanOrEqual(rx.sets)
          expect(rx.maxSets).toBeGreaterThanOrEqual(rx.sets)
        }
      }
    }
  })

  it("beginners get 2–3 sets and heavier roles sit lower in the rep range", () => {
    const primary = prescribe(bench, "muscle_gain", "beginner", "primary_compound")
    const iso = prescribe(curl, "muscle_gain", "beginner", "isolation")
    expect(primary.sets).toBeLessThanOrEqual(3)
    expect(iso.sets).toBeLessThanOrEqual(3)
    expect(iso.sets).toBeGreaterThanOrEqual(2)
    const primaryInt = prescribe(bench, "muscle_gain", "intermediate", "primary_compound")
    const isoInt = prescribe(curl, "muscle_gain", "intermediate", "isolation")
    expect(primaryInt.reps![0]).toBeLessThanOrEqual(isoInt.reps![0])
    expect(primaryInt.restSeconds).toBeGreaterThanOrEqual(isoInt.restSeconds)
    expect(setBounds(bench, "strength", "beginner")).toEqual([3, 3])
  })

  it("strength on a bodyweight exercise falls back to the exercise's own range", () => {
    const rx = prescribe(pushUp, "strength", "advanced", "primary_compound")
    expect(rx.reps![0]).toBeGreaterThanOrEqual(8)
    expect(rx.reps![1]).toBeLessThanOrEqual(20)
    // Coach review F04: the goal's RIR floor needs a proven lift. A first exposure is a
    // calibration session (RIR 3); RIR 1 only once the lift has logged sets.
    expect(rx.rir).toBe(CALIBRATION_RIR)
    const proven = prescribe(pushUp, "strength", "advanced", "primary_compound", { last: lastOf(times(3, { reps: 8 })) })
    expect(proven.rir).toBe(1)
  })

  it("timed exercises get durations instead of reps and scale with experience", () => {
    const b = prescribe(plank, "muscle_gain", "beginner", "accessory")
    const a = prescribe(plank, "muscle_gain", "advanced", "accessory")
    expect(b.reps).toBeNull()
    expect(b.durationSeconds).toBe(30)
    expect(a.durationSeconds).toBeGreaterThan(b.durationSeconds!)
    expect(a.durationSeconds).toBeLessThanOrEqual(60)
    expect(b.rir).toBeNull()
    expect(b.tempo).toBeNull()
  })

  it("prescribeFinisher fills its budget with short rounds", () => {
    const burpee = FIXTURE_BY_ID.get("burpee")! // timed 30–60 s, 3–5 sets, rest 30–60
    const rx = prescribeFinisher(burpee, "fat_loss", "intermediate", 360)
    expect(rx.reps).toBeNull()
    expect(rx.sets).toBeGreaterThanOrEqual(3)
    expect(rx.sets).toBeLessThanOrEqual(5)
    expect(rx.durationSeconds).toBeGreaterThanOrEqual(30)
    expect(rx.durationSeconds).toBeLessThanOrEqual(60)
    const total = rx.sets * ((rx.durationSeconds ?? 0) + rx.restSeconds)
    expect(total).toBeLessThanOrEqual(360 + 60)
    expect(total).toBeGreaterThanOrEqual(180)
    // Coach round 2, R02: this used to be minSets 1 / maxSets = rounds, so the time fitter could
    // cut a conditioning block to one round and never add one. The fitter may now trim to 75% of
    // the planned rounds (never below the exercise's own minimum) and grow to its maximum.
    expect(rx.minSets).toBeGreaterThanOrEqual(burpee.setsRange[0])
    expect(rx.minSets).toBeLessThanOrEqual(rx.sets)
    expect(rx.maxSets).toBe(burpee.setsRange[1])
    expect(rx.rir).toBeNull()
    const swing = prescribeFinisher(FIXTURE_BY_ID.get("kettlebell-swing")!, "fat_loss", "intermediate", 360)
    expect(swing.reps).not.toBeNull()
  })

  it("finisher rest never drops below the exercise's own minimum; work, then the budget, gives way instead", () => {
    for (const id of ["sprint-intervals", "hill-sprints", "assault-bike-intervals", "treadmill-intervals", "shuttle-run", "jump-rope-intervals"]) {
      const ex = requireExercise(id)
      for (const goal of GOALS) {
        for (const experience of LEVELS) {
          for (const budget of [240, 360, 480, 600]) {
            const label = `${id} ${goal} ${experience} ${budget}`
            const rx = prescribeFinisher(ex, goal, experience, budget)
            expect(rx.restSeconds, label).toBeGreaterThanOrEqual(ex.restRange[0])
            expect(rx.restSeconds).toBeLessThanOrEqual(ex.restRange[1])
            // Coach round 2, R02: rounds used to drop to 1 to meet a small budget ("rounds give
            // way"), below the exercise's own setsRange. Rounds now stay inside it; a minimum block
            // that cannot fit is flagged so the caller can pick a finisher that does.
            expect(rx.sets, label).toBeGreaterThanOrEqual(ex.setsRange[0])
            expect(rx.sets, label).toBeLessThanOrEqual(ex.setsRange[1])
            const total = finisherBlockSeconds(rx.sets, rx.durationSeconds ?? 0, rx.restSeconds)
            if (rx.overBudget) {
              expect(rx.sets, label).toBe(ex.setsRange[0])
              expect(rx.durationSeconds!, label).toBeGreaterThanOrEqual(ex.durationRange![0])
              expect(total, label).toBeGreaterThan(budget * FINISHER_BUDGET_TOLERANCE)
            } else {
              expect(total, label).toBeLessThanOrEqual(budget + ((rx.durationSeconds ?? 0) + rx.restSeconds) / 2)
            }
          }
        }
      }
    }
    // An advanced lifter's sprint finisher: 90 s walk-backs, not 25 s, and the exercise's six
    // rounds. Six sprints with 90 s walk-backs need about nine minutes: a 45-minute fat-loss
    // budget cannot hold them (flagged), a 60-minute one can.
    const sprints = prescribeFinisher(requireExercise("sprint-intervals"), "fat_loss", "advanced", 480)
    expect(sprints.restSeconds).toBe(90)
    expect(sprints.sets).toBe(6)
    expect(sprints.overBudget).toBe(true)
    expect(fitsFinisherBudget(requireExercise("sprint-intervals"), "fat_loss", "advanced", finisherBudgetSeconds(60, "fat_loss"))).toBe(true)
  })

  it("never inflates reps on complexes and skill lifts", () => {
    for (const id of ["man-maker", "devil-press", "turkish-get-up"]) {
      const ex = requireExercise(id)
      for (const goal of GOALS) {
        const reps = prescribeReps(ex, goal, "finisher")!
        expect(reps[1], `${id} ${goal}`).toBeLessThanOrEqual(ex.repRange![1])
        expect(reps[0]).toBeGreaterThanOrEqual(ex.repRange![0])
      }
      expect(repRangeFitsGoal(ex, "endurance")).toBe(false)
    }
    // A plain dumbbell lift is still lightened to the goal's reps.
    expect(prescribeReps(requireExercise("single-arm-dumbbell-row"), "endurance", "accessory")![0]).toBeGreaterThanOrEqual(15)
  })

  it("prescribeLight is a single easy round", () => {
    const rx = prescribeLight(FIXTURE_BY_ID.get("warmup-bike")!, 30)
    expect(rx.sets).toBe(1)
    expect(rx.reps).toBeNull()
    expect(rx.durationSeconds).toBe(180)
    expect(prescribeLight(FIXTURE_BY_ID.get("warmup-bike")!, 60).durationSeconds).toBe(240)
    expect(rx.rir).toBeNull()
    const drill = prescribeLight(FIXTURE_BY_ID.get("arm-circles")!, 60)
    // Coach review F29: warm-up drills take the low end of their range, not the working range.
    expect(drill.reps).toEqual([10, 10])
    expect(drill.restSeconds).toBeLessThanOrEqual(20)
  })
})

describe("rep windows never collapse to a single rep (coach review F01)", () => {
  it("widens a touching goal and exercise range into a real window", () => {
    // Endurance 15–25 against a machine press's 6–15: the load can be lightened, so the goal's window.
    expect(prescribeReps(requireExercise("machine-chest-press"), "endurance", "accessory")).toEqual([15, 20])
    // Strength 3–6 against a dumbbell press's 6–12: widen upwards inside the lift's own range.
    expect(prescribeReps(requireExercise("seated-dumbbell-shoulder-press"), "strength", "primary_compound")).toEqual([6, 8])
    // Fat loss 10–15 against a pull-up's 5–10: an unscalable bodyweight lift widens downwards.
    // Coach round 2, R06: this was 7–10, which at the first session's RIR 3 needs 10–13 pull-ups
    // against the lift's own top of 10. The window now leaves its reserve inside the lift's range.
    expect(prescribeReps(requireExercise("pull-up"), "fat_loss", "secondary_compound")).toEqual([5, 7])
    // Endurance against a knee push-up's 8–15. Coach round 2, R06: this was the lift's top window
    // (10–15), which needs 13–18 reps of capacity against a 15-rep graduation cue; now 8–12.
    expect(prescribeReps(requireExercise("knee-push-up"), "endurance", "accessory")).toEqual([8, 12])
  })

  it("does not count a one-rep overlap as a goal fit unless the load can be lightened", () => {
    expect(repRangeFitsGoal(requireExercise("pull-up"), "fat_loss")).toBe(false)
    expect(repRangeFitsGoal(requireExercise("seated-dumbbell-shoulder-press"), "strength")).toBe(false)
    expect(repRangeFitsGoal(requireExercise("machine-chest-press"), "endurance")).toBe(true)
    expect(repRangeFitsGoal(requireExercise("barbell-back-squat"), "strength")).toBe(true)
  })

  it("never returns lo === hi for any rep-based library exercise, goal and role", () => {
    for (const ex of REP_BASED) {
      const [lo, hi] = ex.repRange!
      if (hi - lo < 2) continue
      for (const goal of GOALS) {
        for (const role of ROLES) {
          const reps = prescribeReps(ex, goal, role)!
          expect(reps[1] - reps[0], `${ex.id} ${goal} ${role}: ${reps.join("-")}`).toBeGreaterThanOrEqual(2)
          expect(reps[0]).toBeGreaterThanOrEqual(1)
        }
      }
    }
  })
})

describe("RIR from role, risk and history (coach review F04)", () => {
  it("an advanced strength lifter with no history gets calibration effort on every compound and heavy lift", () => {
    for (const ex of REP_BASED) {
      for (const role of WORK_ROLES) {
        const rir = prescribeRir(ex, "strength", "advanced", role)
        if (rir === null) {
          // Core spec C14: anti-movement trunk work has no RIR target either (position-stop cue).
          if (isAntiMovementTrunk(ex)) continue
          expect(ex.tags, `${ex.id} null RIR`).toContain("explosive")
          continue
        }
        // Coach round 2, R21: this asserted CALIBRATION_RIR for every role, which left an
        // experienced lifter's unproven accessory and isolation work at RIR 3, easier than the
        // primary. That support work now sits at UNPROVEN_SUPPORT_RIR (2); compounds, heavy
        // (ramp-up) lifts and technique lifts keep calibration effort.
        const technique = (ex.tags ?? []).some((t) => ["skill", "overhead", "olympic", "complex"].includes(t))
        const support = (role === "accessory" || role === "isolation") && !ex.warmupRequired && !technique
        expect(rir, `${ex.id} ${role}`).toBeGreaterThanOrEqual(support ? UNPROVEN_SUPPORT_RIR : CALIBRATION_RIR)
      }
    }
  })

  it("the goal's floor applies to the proven primary compound only", () => {
    const squat = requireExercise("barbell-back-squat")
    expect(prescribeRir(squat, "strength", "advanced", "primary_compound", loaded(100))).toBe(1)
    expect(prescribeRir(squat, "strength", "advanced", "secondary_compound", loaded(100))).toBe(2)
    expect(prescribeRir(squat, "strength", "advanced", "accessory", loaded(100))).toBe(2)
    expect(prescribeRir(requireExercise("dumbbell-curl"), "muscle_gain", "advanced", "isolation", loaded(14))).toBe(1)
    // An estimated load, or history without a logged weight, is not proven.
    expect(prescribeRir(squat, "strength", "advanced", "primary_compound", { ...loaded(100), weightSource: "estimate" })).toBe(CALIBRATION_RIR)
    expect(prescribeRir(squat, "strength", "advanced", "primary_compound", { last: lastOf(times(3, { reps: 5 })) })).toBe(CALIBRATION_RIR)
    // Beginners never train near failure.
    for (const role of WORK_ROLES) expect(prescribeRir(squat, "muscle_gain", "beginner", role, loaded(60))).toBe(3)
  })

  it("technique-limited lifts never go below RIR 3 and jumps get no RIR target", () => {
    // Core spec C14: this used the kettlebell windmill, which is now anti-movement trunk work with
    // no RIR target at all (a position-stop cue). A skill lift outside the trunk keeps the rule.
    const windmill: Exercise = { ...requireExercise("kettlebell-windmill"), category: "shoulders", movementPattern: "vertical_push" }
    expect(prescribeRir(requireExercise("kettlebell-windmill"), "strength", "advanced", "accessory", loaded(16))).toBeNull()
    for (const goal of GOALS) {
      for (const experience of LEVELS) {
        for (const role of WORK_ROLES) {
          expect(prescribeRir(windmill, goal, experience, role, loaded(16)), `${goal} ${experience} ${role}`).toBeGreaterThanOrEqual(3)
          // The rule is the tags, not this one entry: any skill or overhead lift is held at 3.
          const tagged: Exercise = { ...requireExercise("dumbbell-bench-press"), tags: ["overhead"] }
          expect(prescribeRir(tagged, goal, experience, role, loaded(20))).toBeGreaterThanOrEqual(3)
        }
      }
    }
    const broadJump = requireExercise("broad-jump")
    for (const role of WORK_ROLES) {
      expect(prescribeRir(broadJump, "strength", "advanced", role, { last: lastOf(times(3, { reps: 5 })) })).toBeNull()
    }
  })

  it("intermediates in conditioning goals work at the floor on isolation and accessories", () => {
    const curl = requireExercise("dumbbell-curl")
    for (const goal of ["fat_loss", "general_fitness", "endurance"] as const) {
      expect(prescribeRir(curl, goal, "intermediate", "isolation", loaded(10))).toBe(2)
      expect(prescribeRir(curl, goal, "intermediate", "accessory", loaded(10))).toBe(2)
      expect(prescribeRir(requireExercise("barbell-back-squat"), goal, "intermediate", "primary_compound", loaded(80))).toBe(3)
    }
  })
})

describe("bodyweight and timed work progress from the last session (coach review F15)", () => {
  const squat = requireExercise("bodyweight-squat")

  it("steps a bodyweight window up after a session at its top, and keeps climbing from there", () => {
    const base = prescribe(squat, "endurance", "intermediate", "primary_compound")
    expect(base.reps).toEqual([15, 20])
    const after20 = prescribe(squat, "endurance", "intermediate", "primary_compound", { last: lastOf(times(3, { reps: 20 }), [15, 20]) })
    expect(after20.reps).toEqual([18, 23])
    expect(after20.note).toContain("18–23")
    // Next time it continues from 18–23, up to the lift's ceiling of 25.
    const after23 = prescribe(squat, "endurance", "intermediate", "primary_compound", { last: lastOf(times(3, { reps: 23 }), [18, 23]) })
    expect(after23.reps).toEqual([20, 25])
  })

  it("repeats the prescription when a set missed the bottom or the top was a grind", () => {
    const missed = prescribe(squat, "endurance", "intermediate", "primary_compound", { last: lastOf([{ reps: 20 }, { reps: 20 }, { reps: 14 }], [15, 20]) })
    expect(missed.reps).toEqual([15, 20])
    expect(missed.note).toContain("Same target")
    const held = prescribe(squat, "endurance", "intermediate", "primary_compound", { last: lastOf(times(3, { reps: 21, rpe: 9 }), [18, 23]) })
    expect(held.reps).toEqual([18, 23])
    // Without a logged session nothing moves.
    expect(prescribe(squat, "endurance", "intermediate", "primary_compound", { last: null }).reps).toEqual([15, 20])
  })

  it("adds a set at the ceiling, then names the harder variation the user may do", () => {
    const knee = requireExercise("knee-push-up")
    const profile = makeProfile({ experience: "beginner", goal: "endurance", equipmentPreset: "bodyweight", equipment: EQUIPMENT_PRESETS.bodyweight })
    const ctx = (last: LastPerformance): PrescribeContext => ({ last, pool: EXERCISES, allows: (e) => passesProfileFilter(e, profile) })
    const top = prescribe(knee, "endurance", "beginner", "accessory", ctx(lastOf(times(3, { reps: 15 }), [10, 15])))
    expect(top.reps).toEqual([10, 15])
    expect(top.sets).toBe(top.maxSets)
    expect(top.note).toContain(requireExercise("push-up").name)
    // A variation the user excluded is never named.
    const excluded = { ...profile, excludedExerciseIds: ["push-up"] }
    const noPushUp = prescribe(knee, "endurance", "beginner", "accessory", {
      last: lastOf(times(3, { reps: 15 }), [10, 15]),
      pool: EXERCISES,
      allows: (e) => passesProfileFilter(e, excluded),
    })
    expect(noPushUp.note).not.toContain(requireExercise("push-up").name)
    // Room for one more set comes first.
    const twoSets = prescribe(pushUp, "fat_loss", "intermediate", "accessory", { last: lastOf(times(2, { reps: 20 }), [17, 20]) })
    expect(twoSets.sets).toBe(3)
    expect(twoSets.note).toContain("one more set")
  })

  it("strength blocks stop adding bodyweight reps at 8 (strength primaries stay low-rep)", () => {
    const pullUp = requireExercise("pull-up") // 5–10
    const base = prescribe(pullUp, "strength", "advanced", "primary_compound")
    expect(base.reps).toEqual([5, 7])
    const step = prescribe(pullUp, "strength", "advanced", "primary_compound", { last: lastOf(times(4, { reps: 7 }), [5, 7]) })
    expect(step.reps).toEqual([6, 8])
    const capped = prescribe(pullUp, "strength", "advanced", "primary_compound", { last: lastOf(times(4, { reps: 8 }), [6, 8]) })
    expect(capped.reps).toEqual([6, 8])
    // Coach round 2 (R12): with no harder variation named, the lowering slows from the prescribed
    // tempo and the card's tempo says so (it was a fixed "take 3 s" that contradicted a 4 s tempo).
    expect(capped.note).toMatch(/lower each rep over \d s \(tempo /)
    expect(capped.note).toContain(capped.tempo!)
    // A lift that already starts above 8 (push-ups 8–10) does not climb at all; sets come first.
    const pushUps = prescribe(pushUp, "strength", "advanced", "primary_compound", { last: lastOf(times(3, { reps: 10 }), [8, 10]) })
    expect(pushUps.reps).toEqual([8, 10])
    expect(pushUps.note).toContain("one more set")
  })

  it("holds grow by 5 s up to the top of their range", () => {
    const realPlank = requireExercise("plank")
    const base = prescribe(realPlank, "general_fitness", "beginner", "accessory")
    expect(base.durationSeconds).toBe(30)
    const next = prescribe(realPlank, "general_fitness", "beginner", "accessory", { last: lastOf(times(3, { durationSeconds: 30 })) })
    expect(next.durationSeconds).toBe(35)
    expect(next.note).toContain("35 s")
    // Core spec C18: a beginner's core hold tops out at 45 s (it was the plank's own 60 s), then a set.
    const top = prescribe(realPlank, "general_fitness", "beginner", "accessory", { last: lastOf(times(2, { durationSeconds: 60 })) })
    expect(top.durationSeconds).toBe(45)
    expect(top.sets).toBe(3)
    // With last session's target known, a short block repeats it (a missed core hold now names the
    // easier hold, C18; without a pool to choose from it keeps the repeat note).
    const withTarget = { ...lastOf([{ durationSeconds: 40 }, { durationSeconds: 40 }, { durationSeconds: 35 }]), prescribedDurationSeconds: 40 }
    const repeat = prescribe(realPlank, "general_fitness", "beginner", "accessory", { last: withTarget })
    expect(repeat.durationSeconds).toBe(40)
    expect(repeat.note).toContain("Same target")
  })

  it("loaded, interval, jump and finisher work is left to load progression", () => {
    const weighted = prescribe(pushUp, "fat_loss", "intermediate", "accessory", { last: lastOf(times(3, { reps: 20, weightKg: 10 }), [12, 15]) })
    expect(weighted.reps).toEqual(prescribe(pushUp, "fat_loss", "intermediate", "accessory").reps)
    const jump = requireExercise("broad-jump")
    expect(prescribe(jump, "strength", "advanced", "accessory", { last: lastOf(times(3, { reps: 5 }), [3, 5]) }).reps).toEqual([3, 5])
    const intervals = requireExercise("bike-intervals")
    expect(prescribe(intervals, "endurance", "beginner", "accessory", { last: lastOf(times(6, { durationSeconds: 60 })) }).durationSeconds).toBe(
      prescribe(intervals, "endurance", "beginner", "accessory").durationSeconds,
    )
  })
})

describe("rest follows the lift (coach review F27)", () => {
  it("heavy compounds in a hypertrophy block rest two to three minutes", () => {
    const squat = requireExercise("barbell-back-squat")
    expect(prescribeRest(squat, "muscle_gain", "primary_compound")).toBeGreaterThanOrEqual(150)
    expect(prescribeRest(squat, "muscle_gain", "secondary_compound")).toBeGreaterThanOrEqual(150)
    expect(prescribeRest(squat, "muscle_gain", "primary_compound")).toBeLessThanOrEqual(180)
    expect(restCeiling(squat, "muscle_gain", "primary_compound")).toBe(180)
    // Lifts without ramp-up sets keep the goal's 60–120 s.
    expect(prescribeRest(requireExercise("machine-chest-press"), "muscle_gain", "primary_compound")).toBeLessThanOrEqual(120)
  })

  it("spare time never stretches non-compound rest far past the exercise's own range", () => {
    for (const ex of REP_BASED) {
      for (const goal of GOALS) {
        for (const role of ["accessory", "isolation"] as const) {
          const ceiling = restCeiling(ex, goal, role)
          expect(ceiling, `${ex.id} ${goal} ${role}`).toBeLessThanOrEqual(Math.max(GOAL_PRESCRIPTIONS[goal].rest[0], ex.restRange[1] + 15))
          expect(ceiling).toBeLessThanOrEqual(GOAL_PRESCRIPTIONS[goal].rest[1])
        }
      }
    }
  })
})

describe("jumps are power primers (coach review F28)", () => {
  it("prescribes 3 × 3–5 with full rest and no RIR in strength and hypertrophy blocks", () => {
    for (const id of ["broad-jump", "skater-jump", "box-jump", "jump-squat"]) {
      const ex = requireExercise(id)
      for (const goal of ["strength", "muscle_gain"] as const) {
        for (const role of WORK_ROLES) {
          const rx = prescribe(ex, goal, "advanced", role)
          expect(rx.sets, `${id} ${goal} ${role}`).toBe(3)
          expect(rx.reps).toEqual([3, 5])
          expect(rx.restSeconds).toBeGreaterThanOrEqual(90)
          expect(rx.rir).toBeNull()
        }
      }
    }
  })

  it("conditioning goals keep the reps of higher-rep jumps; drills and finishers are never primers", () => {
    const jumpSquat = requireExercise("jump-squat")
    expect(isPlyometricPrimer(jumpSquat, "fat_loss", "accessory")).toBe(false)
    const rx = prescribe(jumpSquat, "fat_loss", "intermediate", "accessory")
    expect(rx.reps![0]).toBeGreaterThanOrEqual(10)
    expect(rx.rir).toBeNull()
    // A max-effort jump is power work in any block.
    expect(prescribe(requireExercise("box-jump"), "fat_loss", "intermediate", "accessory").reps).toEqual([3, 5])
    expect(isPlyometricPrimer(requireExercise("burpee"), "strength", "accessory")).toBe(false)
    expect(isPlyometricPrimer(requireExercise("broad-jump"), "strength", "finisher")).toBe(false)
  })
})

describe("warm-up primers and beginner finishers stay light (coach review F29)", () => {
  it("primers take the low end of their range, at most 8 per side", () => {
    const lunge = requireExercise("walking-lunge-primer")
    expect(prescribeLight(lunge, 60).reps![1]).toBeLessThanOrEqual(8)
    for (const ex of EXERCISES.filter((e) => e.category === "warmup" && e.repRange)) {
      const reps = prescribeLight(ex, 75).reps!
      expect(reps[1], ex.id).toBe(ex.isUnilateral ? Math.min(8, ex.repRange![0]) : ex.repRange![0])
    }
  })

  it("a beginner's finisher block is lengthened by 10 s at most", () => {
    const timed = EXERCISES.filter((e) => e.durationRange && isTimed(e) && e.durationRange[0] <= 300 && e.category !== "warmup" && e.category !== "cooldown")
    for (const ex of timed) {
      for (const budget of [240, 360, 480, 600]) {
        const rx = prescribeFinisher(ex, "fat_loss", "beginner", budget)
        const cap = Math.max(20, prescribeDuration(ex, "beginner")! + BEGINNER_FINISHER_EXTRA_SECONDS)
        expect(rx.durationSeconds!, `${ex.id} ${budget}`).toBeLessThanOrEqual(cap)
      }
    }
    // Intermediates may still use the whole range (bear crawl 40 s blocks).
    expect(prescribeFinisher(requireExercise("bear-crawl"), "fat_loss", "intermediate", 480).durationSeconds).toBeGreaterThan(30)
    expect(prescribeFinisher(requireExercise("bear-crawl"), "fat_loss", "beginner", 480).durationSeconds).toBeLessThanOrEqual(30)
  })
})

describe("conditioning finishers are the goal's work, not filler (coach round 2, R02)", () => {
  const CONDITIONING: Goal[] = ["fat_loss", "general_fitness", "endurance"]
  const TIMED_FINISHERS = EXERCISES.filter(
    (e) => isTimed(e) && e.durationRange && e.durationRange[0] <= 300 && (e.category === "cardio" || e.movementPattern === "conditioning"),
  )

  it("sizes the budget by goal: endurance about a quarter of the session, fat loss and general fitness 1.3×", () => {
    expect(finisherBudgetSeconds(45, "endurance")).toBeGreaterThan(finisherBudgetSeconds(45, "strength"))
    expect(finisherBudgetSeconds(30, "endurance")).toBe(450)
    expect(finisherBudgetSeconds(45, "endurance")).toBe(660)
    expect(finisherBudgetSeconds(45, "fat_loss")).toBe(480)
    expect(finisherBudgetSeconds(45, "general_fitness")).toBe(480)
    for (const minutes of [20, 30, 45, 60, 75, 90]) {
      // Without a goal (older callers) the budget is the base that strength and hypertrophy keep.
      expect(finisherBudgetSeconds(minutes, "strength")).toBe(finisherBudgetSeconds(minutes))
      expect(finisherBudgetSeconds(minutes, "muscle_gain")).toBe(finisherBudgetSeconds(minutes))
      for (const goal of CONDITIONING) expect(finisherBudgetSeconds(minutes, goal), `${goal} ${minutes}`).toBeGreaterThan(finisherBudgetSeconds(minutes))
    }
  })

  it("rowing intervals at 45 minutes for endurance keep the exercise's six rounds, protected from the time fitter", () => {
    const rowing = requireExercise("rowing-intervals") // 6–10 rounds of 30–60 s
    for (const experience of ["intermediate", "advanced"] as const) {
      const rx = prescribeFinisher(rowing, "endurance", experience, finisherBudgetSeconds(45, "endurance"))
      expect(rx.sets).toBeGreaterThanOrEqual(6)
      expect(rx.minSets).toBeGreaterThanOrEqual(6)
      expect(rx.maxSets).toBe(rowing.setsRange[1])
      expect(rx.overBudget).toBeUndefined()
    }
  })

  it("shadow boxing at 30 minutes for endurance gets at least the exercise's three rounds", () => {
    const shadow = requireExercise("shadow-boxing") // 3–6 rounds of 120–180 s
    const rx = prescribeFinisher(shadow, "endurance", "beginner", finisherBudgetSeconds(30, "endurance"))
    expect(rx.sets).toBeGreaterThanOrEqual(3)
    expect(rx.minSets).toBeGreaterThanOrEqual(3)
    expect(rx.overBudget).toBeUndefined()
  })

  it("every timed finisher stays inside its own rounds and duration, and may grow to its maximum rounds", () => {
    for (const ex of TIMED_FINISHERS) {
      for (const goal of CONDITIONING) {
        for (const experience of LEVELS) {
          for (const minutes of [30, 45, 60, 75]) {
            const label = `${ex.id} ${goal} ${experience} ${minutes}`
            const rx = prescribeFinisher(ex, goal, experience, finisherBudgetSeconds(minutes, goal))
            expect(rx.sets, label).toBeGreaterThanOrEqual(ex.setsRange[0])
            expect(rx.sets, label).toBeLessThanOrEqual(ex.setsRange[1])
            expect(rx.minSets, label).toBeGreaterThanOrEqual(ex.setsRange[0])
            expect(rx.minSets, label).toBeLessThanOrEqual(rx.sets)
            expect(rx.minSets, label).toBeGreaterThanOrEqual(Math.ceil(rx.sets * 0.75))
            expect(rx.maxSets, label).toBe(ex.setsRange[1])
            expect(rx.durationSeconds!, label).toBeGreaterThanOrEqual(ex.durationRange![0])
          }
        }
      }
    }
  })

  it("does not budget a rest after the final round", () => {
    expect(finisherBlockSeconds(4, 30, 60)).toBe(4 * 30 + 3 * 60)
    expect(finisherBlockSeconds(1, 300, 0)).toBe(300)
    // Fast feet in a 30-minute fat-loss session: seven 20 s rounds with six 30 s rests fill 300 s
    // plus half a round, where counting a seventh rest would have left six rounds.
    const rx = prescribeFinisher(requireExercise("fast-feet"), "fat_loss", "beginner", finisherBudgetSeconds(30, "fat_loss"))
    expect(rx.sets).toBe(7)
    expect(finisherBlockSeconds(rx.sets, rx.durationSeconds!, rx.restSeconds)).toBeLessThanOrEqual(finisherBudgetSeconds(30, "fat_loss") + 25)
  })

  it("never cuts a steady block below its own minimum; a budget that cannot hold it is flagged", () => {
    const march = requireExercise("march-in-place") // one steady block of 300–900 s
    const short = prescribeFinisher(march, "fat_loss", "beginner", 240)
    expect(short.durationSeconds).toBeGreaterThanOrEqual(300)
    expect(short.overBudget).toBe(true)
    expect(fitsFinisherBudget(march, "fat_loss", "beginner", 240)).toBe(false)
    const roomy = prescribeFinisher(march, "fat_loss", "beginner", 480)
    expect(roomy.durationSeconds).toBeGreaterThanOrEqual(300)
    expect(roomy.overBudget).toBeUndefined()
    expect(fitsFinisherBudget(march, "fat_loss", "beginner", 480)).toBe(true)
  })

  it("shortens each round towards the exercise's minimum before flagging a block that does not fit", () => {
    // Bike intervals (6–10 × 30–60 s, 60–90 s rest) in a 45-minute fat-loss budget: six rounds
    // fit once each block is cut from 40 s to 30 s.
    const bike = requireExercise("bike-intervals")
    const rx = prescribeFinisher(bike, "fat_loss", "intermediate", finisherBudgetSeconds(45, "fat_loss"))
    expect(rx.sets).toBe(6)
    expect(rx.durationSeconds).toBe(30)
    expect(rx.overBudget).toBeUndefined()
  })

  it("rep-based finishers keep the exercise's own minimum sets and may grow to its maximum", () => {
    const swing = requireExercise("kettlebell-swing") // 3–5 sets
    const rx = prescribeFinisher(swing, "fat_loss", "intermediate", 480)
    expect(rx.reps).not.toBeNull()
    expect(rx.sets).toBeGreaterThanOrEqual(swing.setsRange[0])
    expect(rx.minSets).toBeGreaterThanOrEqual(swing.setsRange[0])
    expect(rx.minSets).toBeLessThanOrEqual(rx.sets)
    expect(rx.maxSets).toBe(swing.setsRange[1])
    // Beginners grow to 3 sets at most.
    const sprawl = requireExercise("sprawl")
    expect(prescribeFinisher(sprawl, "fat_loss", "beginner", 480).maxSets).toBeLessThanOrEqual(3)
  })
})

describe("bodyweight presses and pulls leave their reserve inside the lift's range (coach round 2, R06)", () => {
  const CASES: [string, Goal, Experience][] = [
    ["knee-push-up", "fat_loss", "beginner"],
    ["pike-push-up", "fat_loss", "intermediate"],
    ["hands-elevated-pike-push-up", "general_fitness", "beginner"],
  ]

  it("first-exposure windows satisfy top + RIR <= the lift's own top and carry a regression note", () => {
    for (const [id, goal, experience] of CASES) {
      const ex = requireExercise(id)
      for (const role of WORK_ROLES) {
        const label = `${id} ${goal} ${experience} ${role}`
        const rx = prescribe(ex, goal, experience, role)
        expect(rx.reps![1] + rx.rir!, label).toBeLessThanOrEqual(ex.repRange![1])
        expect(rx.reps![1] - rx.reps![0], label).toBeGreaterThanOrEqual(2)
        expect(rx.note, label).toMatch(new RegExp(`^${FIRST_EXPOSURE_NOTE_PREFIX} ${rx.reps![0]} reps, switch to `))
      }
    }
    // The coach's examples: knee push-ups 9–12 for fat loss, pike push-ups 6–9, hands-elevated 7–9.
    expect(prescribeReps(requireExercise("knee-push-up"), "fat_loss", "accessory")).toEqual([9, 12])
    expect(prescribeReps(requireExercise("pike-push-up"), "fat_loss", "accessory")).toEqual([6, 9])
    expect(prescribeReps(requireExercise("hands-elevated-pike-push-up"), "general_fitness", "accessory")).toEqual([7, 9])
  })

  it("names the easier variation the user may do", () => {
    const profile = makeProfile({ goal: "fat_loss", experience: "intermediate", equipmentPreset: "bodyweight", equipment: EQUIPMENT_PRESETS.bodyweight })
    const allows = (e: Exercise) => passesProfileFilter(e, profile)
    const pike = requireExercise("pike-push-up")
    const easier = easierVariation(pike, "fat_loss", EXERCISES, allows)
    expect(easier?.id).toBe("hands-elevated-pike-push-up")
    const rx = prescribe(pike, "fat_loss", "intermediate", "accessory", { last: null, pool: EXERCISES, allows })
    expect(rx.note).toBe(`${FIRST_EXPOSURE_NOTE_PREFIX} 6 reps, switch to ${easier!.name}.`)
    // An easier option is always easier: never a harder sibling or the parent.
    const pushUpEasier = easierVariation(requireExercise("push-up"), "fat_loss", EXERCISES, () => true)
    expect(pushUpEasier?.tags).toContain("beginner_friendly")
    expect(easierVariation(requireExercise("knee-push-up"), "fat_loss", EXERCISES, () => true)?.id).not.toBe("push-up")
    // Logged history: no first-exposure note.
    const logged = prescribe(pike, "fat_loss", "intermediate", "accessory", { last: lastOf(times(3, { reps: 7 }), [6, 9]), pool: EXERCISES, allows })
    expect(logged.note ?? "").not.toContain(FIRST_EXPOSURE_NOTE_PREFIX)
  })

  it("counts a press or pull as a goal misfit when the goal's bottom rep plus its reserve is past the lift's top", () => {
    expect(repRangeFitsGoal(requireExercise("pike-push-up"), "fat_loss")).toBe(false)
    expect(repRangeFitsGoal(requireExercise("hands-elevated-pike-push-up"), "general_fitness")).toBe(false)
    expect(repRangeFitsGoal(requireExercise("knee-push-up"), "fat_loss")).toBe(true)
    expect(repRangeFitsGoal(requireExercise("push-up"), "fat_loss")).toBe(true)
    // A caller that knows the lift is proven may pass a smaller reserve.
    expect(repRangeFitsGoal(requireExercise("pike-push-up"), "fat_loss", 1)).toBe(true)
  })

  it("progression climbs from the capped window to the lift's top, then on to the next rung", () => {
    const knee = requireExercise("knee-push-up")
    const step = prescribe(knee, "fat_loss", "beginner", "accessory", { last: lastOf(times(3, { reps: 12 }), [9, 12]) })
    expect(step.reps).toEqual([12, 15])
    expect(step.note).toContain("12–15")
    const repeat = prescribe(knee, "fat_loss", "beginner", "accessory", { last: lastOf([{ reps: 12 }, { reps: 10 }, { reps: 8 }], [9, 12]) })
    expect(repeat.reps).toEqual([9, 12])
    expect(repeat.note).toContain("Same target")
  })

  it("leaves glute bridges, core drills, loaded lifts and finishers on the goal's window", () => {
    expect(prescribeReps(requireExercise("bird-dog"), "fat_loss", "accessory")).toEqual([10, 12])
    expect(prescribe(requireExercise("bird-dog"), "fat_loss", "beginner", "accessory").note).toBeUndefined()
    expect(prescribeReps(requireExercise("glute-bridge"), "endurance", "accessory")![1]).toBeGreaterThanOrEqual(18)
    // A loaded press (6–12) keeps the goal's overlap: its starting load calibrates the effort.
    expect(prescribeReps(requireExercise("dumbbell-bench-press"), "fat_loss", "accessory")).toEqual([10, 12])
    expect(prescribe(requireExercise("dumbbell-bench-press"), "fat_loss", "beginner", "accessory").note).toBeUndefined()
    // A rep-based conditioning finisher has no RIR target, so no reserve to leave.
    expect(prescribeReps(requireExercise("push-up"), "endurance", "finisher")).toEqual([15, 20])
  })

  it("caps a kettlebell lift lightened for a high-rep goal at its own top + 5", () => {
    const press = requireExercise("single-arm-kettlebell-press") // 6–10 per side
    const reps = prescribeReps(press, "endurance", "secondary_compound")!
    expect(reps[1]).toBeLessThanOrEqual(15)
    expect(reps).toEqual([12, 15])
    // Dumbbells step finely enough to be lightened to the goal's own window.
    expect(prescribeReps(requireExercise("single-arm-dumbbell-row"), "endurance", "accessory")).toEqual([15, 20])
  })
})

describe("strength rests and the primary's place (coach round 2, R20)", () => {
  const STRENGTH_HEAVY = REP_BASED.filter((e) => e.warmupRequired && (e.goalCompatibility.length === 0 || e.goalCompatibility.includes("strength")))

  it("heavy strength compounds rest 180–240 s whatever the lift's own range, and the fitter keeps 180 s", () => {
    expect(STRENGTH_HEAVY.length).toBeGreaterThan(5)
    for (const ex of STRENGTH_HEAVY) {
      if (isPlyometricPrimer(ex, "strength", "primary_compound")) continue
      for (const role of ["primary_compound", "secondary_compound"] as const) {
        const rest = prescribeRest(ex, "strength", role)
        expect(rest, `${ex.id} ${role}`).toBeGreaterThanOrEqual(180)
        expect(rest).toBeLessThanOrEqual(240)
        expect(protectedRestSeconds(ex, "strength", role)).toBe(180)
        expect(restCeiling(ex, "strength", role)).toBe(240)
      }
      expect(prescribeRest(ex, "strength", "primary_compound")).toBeGreaterThanOrEqual(prescribeRest(ex, "strength", "secondary_compound"))
    }
    // The bench used to be capped at 175 s by its own 120–180 s range.
    expect(prescribeRest(requireExercise("barbell-bench-press"), "strength", "primary_compound")).toBeGreaterThanOrEqual(180)
  })

  it("with a bench that reaches 3 reps, a strength primary bench sits at or below the overhead press secondary", () => {
    // The library change (barbell-bench-press repRange [3, 8], restRange [120, 240]) is exercise
    // data owned elsewhere; the prescription rules are checked against that entry here.
    const bench38: Exercise = { ...requireExercise("barbell-bench-press"), repRange: [3, 8], restRange: [120, 240] }
    const press = requireExercise("overhead-press")
    for (const experience of LEVELS) {
      const primary = prescribe(bench38, "strength", experience, "primary_compound")
      const secondary = prescribe(press, "strength", experience, "secondary_compound")
      expect(primary.reps![1]).toBeLessThanOrEqual(secondary.reps![1])
      expect(primary.restSeconds).toBeGreaterThanOrEqual(180)
      expect(primary.restSeconds).toBeGreaterThanOrEqual(secondary.restSeconds)
    }
  })

  it("a heavy rest band needs a load heavy enough to ramp from", () => {
    const incline = requireExercise("incline-dumbbell-press")
    expect(protectedRestSeconds(incline, "muscle_gain", "secondary_compound")).toBe(90)
    expect(protectedRestSeconds(incline, "muscle_gain", "secondary_compound", 20)).toBe(90)
    expect(protectedRestSeconds(incline, "muscle_gain", "secondary_compound", 4)).toBe(0)
    const bench = requireExercise("barbell-bench-press")
    // The bench's own range is now 120–240 s (R20 data), so an empty-bar bench gets the strength
    // goal's band (150–240 s), not the heavy band, and nothing of it is protected from the fitter.
    const light = prescribeRest(bench, "strength", "primary_compound", 20)
    expect(light).toBeGreaterThanOrEqual(GOAL_PRESCRIPTIONS.strength.rest[0])
    expect(light).toBeLessThanOrEqual(prescribeRest(bench, "strength", "primary_compound", 60))
    expect(protectedRestSeconds(bench, "strength", "primary_compound", 20)).toBe(0)
    expect(prescribeRest(bench, "strength", "primary_compound", 60)).toBeGreaterThanOrEqual(180)
    expect(protectedRestSeconds(bench, "strength", "primary_compound", 60)).toBe(180)
    expect(prescribeRest(bench, "muscle_gain", "primary_compound", 20)).toBeLessThanOrEqual(GOAL_PRESCRIPTIONS.muscle_gain.rest[1])
    expect(restCeiling(bench, "muscle_gain", "primary_compound", 20)).toBe(GOAL_PRESCRIPTIONS.muscle_gain.rest[1])
  })
})

describe("unproven support work for experienced lifters (coach round 2, R21)", () => {
  it("an experienced lifter's unproven isolation and accessory work sits at RIR 2; a beginner's stays at 3", () => {
    const curl = requireExercise("dumbbell-curl")
    expect(prescribeRir(curl, "muscle_gain", "advanced", "isolation")).toBeLessThanOrEqual(2)
    expect(prescribeRir(curl, "muscle_gain", "intermediate", "isolation")).toBe(UNPROVEN_SUPPORT_RIR)
    expect(prescribeRir(curl, "muscle_gain", "intermediate", "accessory")).toBe(UNPROVEN_SUPPORT_RIR)
    expect(prescribeRir(curl, "muscle_gain", "beginner", "isolation")).toBe(CALIBRATION_RIR)
    // A starting estimate is still unproven.
    expect(prescribeRir(curl, "muscle_gain", "advanced", "isolation", { ...loaded(14), weightSource: "estimate" })).toBe(UNPROVEN_SUPPORT_RIR)
    // A proven load keeps the role's own RIR.
    expect(prescribeRir(curl, "muscle_gain", "advanced", "isolation", loaded(14))).toBe(1)
  })

  it("compounds, heavy ramp-up lifts and technique lifts keep calibration effort", () => {
    expect(prescribeRir(requireExercise("barbell-back-squat"), "muscle_gain", "advanced", "primary_compound")).toBe(CALIBRATION_RIR)
    expect(prescribeRir(requireExercise("dumbbell-bench-press"), "muscle_gain", "advanced", "secondary_compound")).toBe(CALIBRATION_RIR)
    expect(prescribeRir(requireExercise("barbell-bench-press"), "muscle_gain", "advanced", "accessory")).toBe(CALIBRATION_RIR)
    // Core spec C14: the windmill is anti-movement trunk work, stopped on position (no RIR target).
    expect(prescribeRir(requireExercise("kettlebell-windmill"), "strength", "advanced", "accessory")).toBeNull()
  })
})

describe("bodyweight work at its ceiling with no harder variation (coach round 2, R12)", () => {
  const pushUp = requireExercise("push-up")
  const atCeiling = (extra: Partial<LastPerformance> = {}): LastPerformance => ({
    ...lastOf(times(4, { reps: pushUp.repRange![1] }), [pushUp.repRange![1] - 3, pushUp.repRange![1]]),
    ...extra,
  })
  it("a conditioning goal takes rest off first, then slows the lowering from the tempo actually prescribed", () => {
    const base = prescribe(pushUp, "general_fitness", "intermediate", "accessory")
    const restCut = prescribe(pushUp, "general_fitness", "intermediate", "accessory", { last: atCeiling() })
    expect(restCut.restSeconds).toBeLessThan(base.restSeconds)
    expect(restCut.restSeconds).toBeGreaterThanOrEqual(GOAL_PRESCRIPTIONS.general_fitness.rest[0])
    expect(restCut.note).toMatch(/s rest between sets today/)
    // At the goal's shortest rest, the lowering slows, and the shortened rest carries over.
    const floor = GOAL_PRESCRIPTIONS.general_fitness.rest[0]
    const slower = prescribe(pushUp, "general_fitness", "intermediate", "accessory", { last: atCeiling({ prescribedRestSeconds: floor }) })
    expect(slower.tempo).toBe("3-0-1-0")
    expect(slower.restSeconds).toBe(floor)
    expect(slower.note).toContain("lower each rep over 3 s (tempo 3-0-1-0)")
    // An earned tempo carries over and slows a second more, up to 6 s; then a harder option.
    const carried = prescribe(pushUp, "general_fitness", "intermediate", "accessory", { last: atCeiling({ prescribedRestSeconds: floor, prescribedTempo: "5-0-1-0" }) })
    expect(carried.tempo).toBe("6-0-1-0")
    const maxed = prescribe(pushUp, "general_fitness", "intermediate", "accessory", { last: atCeiling({ prescribedRestSeconds: floor, prescribedTempo: "6-0-1-0" }) })
    expect(maxed.tempo).toBe("6-0-1-0")
    expect(maxed.note).toMatch(/ready for a harder variation or added load/)
  })

  it("the slower-lowering helper moves one second at a time from the prescribed tempo", () => {
    expect(slowerEccentricTempo("4-0-X-0")).toBe("5-0-X-0")
    expect(slowerEccentricTempo("2-0-1-0")).toBe("3-0-1-0")
    expect(slowerEccentricTempo(null)).toBe("3-0-1-0")
    expect(slowerEccentricTempo("6-0-1-0")).toBeNull()
  })
})

describe("strength support work (coach round 2, R22)", () => {
  it("an isolation lift in a strength accessory slot rests like isolation work", () => {
    const raise = requireExercise("prone-t-raise")
    expect(prescribe(raise, "strength", "beginner", "accessory").restSeconds).toBeLessThanOrEqual(90)
  })

  it("a strength beginner's support work may start at two sets; the main lifts keep three", () => {
    const row = requireExercise("single-arm-dumbbell-row")
    expect(setBounds(row, "strength", "beginner", "accessory")[0]).toBe(2)
    expect(prescribe(row, "strength", "beginner", "accessory").sets).toBe(2)
    expect(setBounds(row, "strength", "beginner", "primary_compound")[0]).toBe(3)
  })

  it("a beginner's trunk drill keeps its own short rest in a strength block", () => {
    const birdDog = requireExercise("bird-dog")
    expect(prescribe(birdDog, "strength", "beginner", "accessory").restSeconds).toBeLessThanOrEqual(birdDog.restRange[1])
  })
})


describe("trunk prescriptions (core spec C14, C16, C17, C18)", () => {
  const filter = (profile: ReturnType<typeof makeProfile>) => (e: Exercise) => passesProfileFilter(e, profile)

  it("C14: anti-movement trunk work has no RIR target; flexion keeps the goal's (floor 1)", () => {
    expect(prescribeRir(requireExercise("pallof-press"), "strength", "advanced", "accessory")).toBeNull()
    expect(prescribeRir(requireExercise("pallof-press"), "strength", "advanced", "accessory", loaded(20))).toBeNull()
    expect(prescribeRir(requireExercise("dead-bug"), "fat_loss", "beginner", "accessory")).toBeNull()
    expect(prescribeRir(requireExercise("suitcase-carry"), "strength", "advanced", "accessory")).toBeNull()
    expect(prescribeRir(requireExercise("cable-crunch"), "muscle_gain", "advanced", "accessory")).toBeGreaterThanOrEqual(1)
    expect(prescribeRir(requireExercise("cable-crunch"), "muscle_gain", "advanced", "accessory", loaded(30))).toBeGreaterThanOrEqual(1)
    expect(prescribeRir(requireExercise("cable-woodchop"), "general_fitness", "intermediate", "accessory")).not.toBeNull()
    // A dynamic side bend is flexion work whatever pattern the data gives it.
    expect(isAntiMovementTrunk({ ...requireExercise("dumbbell-side-bend"), movementPattern: "anti_lateral_flexion", tags: ["lateral_flexion"] })).toBe(false)
  })

  it("C17: conditioning goals rest unloaded trunk drills 30-45 s; loaded ones and other goals are unchanged", () => {
    for (const goal of ["fat_loss", "general_fitness", "endurance"] as Goal[]) {
      const rest = prescribeRest(requireExercise("plank"), goal, "accessory")
      expect(rest, goal).toBeGreaterThanOrEqual(30)
      expect(rest, goal).toBeLessThanOrEqual(45)
      expect(restCeiling(requireExercise("plank"), goal, "accessory")).toBeLessThanOrEqual(45)
    }
    const crunch = requireExercise("cable-crunch")
    const goalBand = GOAL_PRESCRIPTIONS.fat_loss.rest
    const capped: [number, number] = [Math.min(crunch.restRange[0], goalBand[1]), Math.min(crunch.restRange[1], goalBand[1])]
    const band = intersectRange(capped, goalBand) ?? capped
    const crunchRest = prescribeRest(crunch, "fat_loss", "accessory")
    expect(crunchRest).toBeGreaterThanOrEqual(band[0])
    expect(crunchRest).toBeLessThanOrEqual(band[1])
    // Strength keeps its isolation band (60-90 s) for trunk work.
    expect(prescribeRest(requireExercise("plank"), "strength", "accessory")).toBeGreaterThanOrEqual(60)
    // A timed drill held with a gym implement is loaded trunk work: the goal's support band, not 30-45 s.
    for (const id of ["suitcase-carry", "weighted-plank"]) {
      const ex = requireExercise(id)
      expect(prescribeRest(ex, "fat_loss", "accessory"), id).toBeGreaterThanOrEqual(GOAL_PRESCRIPTIONS.fat_loss.rest[0])
      expect(restCeiling(ex, "fat_loss", "accessory"), id).toBeGreaterThan(CONDITIONING_TRUNK_REST[1])
    }
  })

  it("C18: core holds stop at 45 s for strength, hypertrophy and beginners, 60 s otherwise", () => {
    const realPlank = requireExercise("plank")
    expect(coreHoldCeiling(realPlank, "strength", "advanced")).toBe(45)
    expect(coreHoldCeiling(realPlank, "muscle_gain", "intermediate")).toBe(45)
    expect(coreHoldCeiling(realPlank, "fat_loss", "beginner")).toBe(45)
    expect(coreHoldCeiling(realPlank, "endurance", "advanced")).toBe(60)
    expect(coreHoldCeiling(requireExercise("side-plank"), "endurance", "advanced")).toBe(requireExercise("side-plank").durationRange![1])
    expect(coreHoldCeiling(requireExercise("suitcase-carry"), "strength", "advanced")).toBeUndefined()
    const strong = prescribe(realPlank, "strength", "advanced", "accessory")
    expect(strong.durationSeconds).toBeLessThanOrEqual(45)
    // A full 45 s hold on every set: one more set, not more seconds.
    const sets = strong.sets
    const next = prescribe(realPlank, "strength", "advanced", "accessory", { last: { ...lastOf(times(sets, { durationSeconds: 45 })), prescribedDurationSeconds: 45 } })
    expect(next.durationSeconds).toBe(45)
    expect(next.sets).toBe(sets + 1)
    expect(next.note).toContain("one more set")
  })

  it("C18: a first core hold, or a missed one, names the easier hold", () => {
    const beginnerProfile = makeProfile({ goal: "general_fitness", experience: "beginner" })
    const context = { pool: EXERCISES, allows: filter(beginnerProfile) }
    const side = prescribe(requireExercise("side-plank"), "general_fitness", "beginner", "accessory", context)
    expect(side.note).toMatch(new RegExp(`^${FIRST_HOLD_NOTE_PREFIX} \\d+ s with your hips level, switch to Knee side plank\\.$`))
    const missed = prescribe(requireExercise("plank"), "general_fitness", "beginner", "accessory", {
      ...context,
      last: { ...lastOf([{ durationSeconds: 35 }, { durationSeconds: 25 }]), prescribedDurationSeconds: 35 },
    })
    expect(missed.note).toContain("switch to Incline plank")
    expect(missed.durationSeconds).toBe(35)
    // Without a pool to choose from, a hold's first exposure has no note.
    expect(prescribe(requireExercise("side-plank"), "general_fitness", "beginner", "accessory").note ?? null).toBeNull()
  })

  it("C16: the short-session dose is 2 sets, one-sided holds at most 30 s and one-sided reps at most 6-8", () => {
    const side = prescribe(requireExercise("side-plank"), "endurance", "advanced", "accessory")
    expect(side.durationSeconds).toBeGreaterThan(SHORT_CORE_HOLD_SECONDS)
    applyShortCoreDose(side, requireExercise("side-plank"))
    expect([side.sets, side.minSets, side.maxSets]).toEqual([2, 2, 2])
    expect(side.durationSeconds).toBe(SHORT_CORE_HOLD_SECONDS)
    const pallof = prescribe(requireExercise("pallof-press"), "general_fitness", "intermediate", "accessory")
    applyShortCoreDose(pallof, requireExercise("pallof-press"))
    expect(pallof.reps![1]).toBeLessThanOrEqual(8)
    expect(pallof.reps![0]).toBeLessThanOrEqual(6)
    // Two-sided drills keep their own time and window.
    const plankRx = prescribe(requireExercise("plank"), "endurance", "advanced", "accessory")
    const before = plankRx.durationSeconds
    applyShortCoreDose(plankRx, requireExercise("plank"))
    expect(plankRx.sets).toBe(2)
    expect(plankRx.durationSeconds).toBe(before)
  })
})
