import { describe, expect, it } from "vitest"
import type { CompletedExercise, CompletedWorkout, ExerciseProgress, SetLog } from "@/lib/domain/types"
import { EQUIPMENT_PRESETS } from "@/lib/domain/types"
import { addDays } from "@/lib/dates"
import { EXERCISES, getExercise, requireExercise } from "@/lib/exercises"
import { generateWorkout } from "./generate"
import {
  FIND_WORKING_WEIGHT_PREFIX,
  e1rm,
  FIND_BAND_PREFIX,
  lastPerformance,
  loadKindOf,
  planLoad,
  progressFinisher,
  progressUnloaded,
  recommendWeight,
  slowerEccentricTempo,
  STARTING_GUESS_NOTE,
  weightForReps,
  type LastPerformance,
  type PerformanceRecord,
} from "./progression"
import { completeAtTop, FIXTURE_BY_ID, makeInput, makeProfile, progressFromHistory, trainingDayOffsets } from "./test-fixtures"

const bench = FIXTURE_BY_ID.get("barbell-bench-press")!
const squat = FIXTURE_BY_ID.get("barbell-back-squat")!
const dbPress = FIXTURE_BY_ID.get("dumbbell-bench-press")!
const pullUp = FIXTURE_BY_ID.get("pull-up")!
const plank = FIXTURE_BY_ID.get("plank")!

function perf(weight: number, reps: number[], prescribed: [number, number] | null = [8, 12]): LastPerformance {
  return {
    date: "2026-10-01",
    prescribedReps: prescribed,
    sets: reps.map((r, i) => ({ setNumber: i + 1, weightKg: weight, reps: r, completed: true })),
  }
}

describe("progression", () => {
  it("e1rm helpers", () => {
    expect(e1rm(100, 1)).toBeCloseTo(103.33, 1)
    expect(weightForReps(e1rm(80, 10), 10)).toBeCloseTo(80)
    expect(loadKindOf(bench)).toBe("barbell")
    expect(loadKindOf(dbPress)).toBe("dumbbell")
    expect(loadKindOf(FIXTURE_BY_ID.get("lat-pulldown")!)).toBe("machine")
    expect(loadKindOf(plank)).toBe("other")
  })

  it("returns null without history", () => {
    expect(recommendWeight(bench, [8, 12], null, "kg")).toEqual({ weightKg: null, note: null })
  })

  it("adds 2.5% upper / 5% lower when every set hit the top", () => {
    const upper = recommendWeight(bench, [8, 12], perf(80, [12, 12, 12]), "kg")
    expect(upper.weightKg).toBe(82.5)
    expect(upper.note).toMatch(/Up from 80 kg/)
    const lower = recommendWeight(squat, [8, 12], perf(100, [12, 12, 12]), "kg")
    expect(lower.weightKg).toBe(105)
    // Small loads still move by at least one step. Coach round 2 (R11): this used to step 10 → 12 kg
    // (+20%) after one top-of-range session; a step over 10% now waits for a second one.
    const small = recommendWeight(dbPress, [8, 12], perf(10, [12, 12]), "kg")
    expect(small.weightKg).toBe(10)
    const twice = recommendWeight(dbPress, [8, 12], { ...perf(10, [12, 12]), previous: perf(10, [12, 12]) }, "kg")
    expect(twice.weightKg).toBe(12)
  })

  it("repeats the load when a set missed the bottom or the range was not topped", () => {
    expect(recommendWeight(bench, [8, 12], perf(80, [12, 10, 7]), "kg").weightKg).toBe(80)
    expect(recommendWeight(bench, [8, 12], perf(80, [12, 11, 10]), "kg").weightKg).toBe(80)
    expect(recommendWeight(bench, [8, 12], perf(80, [12, 10, 7]), "kg").note).toMatch(/Stay at 80 kg/)
  })

  it("translates through e1RM when the prescription changed", () => {
    const rec = recommendWeight(bench, [4, 6], perf(60, [12, 12, 12], [8, 12]), "kg")
    expect(rec.weightKg).toBeGreaterThan(60)
    expect(rec.weightKg).toBeLessThan(e1rm(60, 12))
    expect(rec.note).toMatch(/Rep range changed/)
    const lighter = recommendWeight(bench, [12, 15], perf(100, [5, 5, 5], [4, 6]), "kg")
    expect(lighter.weightKg).toBeLessThan(100)
  })

  it("rounds to the user's unit steps", () => {
    const rec = recommendWeight(bench, [8, 12], perf(45.36, [12, 12, 12]), "lb") // 100 lb
    expect(rec.weightKg).toBeCloseTo(47.63, 1) // 105 lb
  })

  it("handles bodyweight and timed loads", () => {
    expect(recommendWeight(plank, null, perf(0, [0]), "kg").weightKg).toBeNull()
    expect(recommendWeight(pullUp, [6, 10], perf(0, [10, 10]), "kg").weightKg).toBeNull()
    const weighted: LastPerformance = { date: "2026-10-01", prescribedReps: [6, 10], sets: [{ setNumber: 1, weightKg: 10, reps: 10, completed: true }] }
    expect(recommendWeight(pullUp, [6, 10], weighted, "kg").weightKg).toBe(10)
  })

  it("lastPerformance prefers history over progress and skips uncompleted sets", () => {
    const history: CompletedWorkout[] = [
      {
        id: "w1",
        date: "2026-10-03",
        title: "Push",
        split: "push",
        focus: ["chest"],
        goal: "muscle_gain",
        startedAt: "",
        completedAt: "",
        durationSeconds: 0,
        exercises: [
          {
            slotId: "a",
            exerciseId: "barbell-bench-press",
            role: "primary_compound",
            phase: "main",
            status: "completed",
            sets: [
              { setNumber: 1, weightKg: 70, reps: 10, completed: true },
              { setNumber: 2, weightKg: 70, reps: 10, completed: false },
            ],
            prescribedSets: 2,
            prescribedReps: [8, 12],
            prescribedDurationSeconds: null,
            recommendedWeightKg: null,
          },
        ],
        totals: { exercisesCompleted: 1, exercisesSkipped: 0, sets: 1, reps: 10, volumeKg: 700, caloriesEstimate: null },
        personalRecords: [],
        engineVersion: 1,
        synced: true,
      },
    ]
    const progress: Record<string, ExerciseProgress> = {
      "barbell-bench-press": {
        exerciseId: "barbell-bench-press",
        bestWeightKg: 90,
        bestReps: 10,
        bestVolumeKg: 900,
        bestE1rmKg: 120,
        timesPerformed: 3,
        lastPerformedAt: "2026-09-01",
        recentSessions: [{ workoutId: "old", date: "2026-09-01", sets: [{ setNumber: 1, weightKg: 90, reps: 10, completed: true }] }],
        updatedAt: "",
      },
    }
    const fromHistory = lastPerformance("barbell-bench-press", history, progress)
    expect(fromHistory?.sets).toHaveLength(1)
    expect(fromHistory?.sets[0]?.weightKg).toBe(70)
    expect(fromHistory?.prescribedReps).toEqual([8, 12])
    const fromProgress = lastPerformance("barbell-bench-press", [], progress)
    expect(fromProgress?.sets[0]?.weightKg).toBe(90)
    expect(fromProgress?.prescribedReps).toBeNull()
    expect(lastPerformance("unknown", history, progress)).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Coach round 1 fixes.

const kbDeadlift = requireExercise("kettlebell-deadlift")
const dbBench = requireExercise("dumbbell-bench-press")
const libBench = requireExercise("barbell-bench-press")

function sets(weight: number | null, reps: (number | null)[], extra: Partial<SetLog> = {}): SetLog[] {
  return reps.map((r, i) => ({ setNumber: i + 1, weightKg: weight, reps: r, completed: true, ...extra }))
}

function session(overrides: Partial<LastPerformance> & Pick<LastPerformance, "sets">): LastPerformance {
  return { date: "2026-10-01", prescribedReps: [8, 12], ...overrides }
}

function workoutWith(id: string, date: string, entry: Partial<CompletedExercise>): CompletedWorkout {
  return {
    id,
    date,
    title: "Push",
    split: "push",
    focus: ["chest"],
    goal: "muscle_gain",
    startedAt: "",
    completedAt: "",
    durationSeconds: 0,
    exercises: [
      {
        slotId: "s",
        exerciseId: "dumbbell-bench-press",
        role: "primary_compound",
        phase: "main",
        status: "completed",
        sets: sets(20, [12, 12, 12]),
        prescribedSets: 3,
        prescribedReps: [8, 12],
        prescribedDurationSeconds: null,
        recommendedWeightKg: 20,
        ...entry,
      },
    ],
    totals: { exercisesCompleted: 1, exercisesSkipped: 0, sets: 3, reps: 36, volumeKg: 720, caloriesEstimate: null },
    personalRecords: [],
    engineVersion: 1,
    synced: false,
  }
}

describe("first-session loads (F02)", () => {
  const profile = { weightKg: 82, gender: "male" as const, experience: "intermediate" as const, units: "kg" as const }

  it("attaches a calibration note to every starting estimate", () => {
    // Coach round 2 (R10): an intermediate now finds their own load on the dumbbell bench (a
    // ramp-up lift), so a beginner carries the starting-estimate rule here.
    const planned = planLoad(dbBench, [8, 12], null, { ...profile, experience: "beginner" })
    expect(planned.weightSource).toBe("estimate")
    expect(planned.weightKg).not.toBeNull()
    expect(planned.note).toBe(STARTING_GUESS_NOTE)
    expect(planned.note).toMatch(/more than 4 reps in reserve/)
  })

  it("asks the lifter to find their working weight instead of showing the rack minimum", () => {
    const beginnerWoman = { weightKg: 58, gender: "female" as const, experience: "beginner" as const, units: "kg" as const }
    const curl = planLoad(requireExercise("dumbbell-curl"), [8, 12], null, beginnerWoman, { rir: 3 })
    expect(curl.weightKg).toBeNull()
    expect(curl.weightSource).toBeNull()
    expect(curl.note).toMatch(/^Find your working weight: start light/)
    expect(curl.note).toMatch(/8–12 reps leave about 3 in reserve/)
    const press = planLoad(requireExercise("overhead-press"), [6, 10], null, beginnerWoman)
    expect(press.weightKg).toBeNull()
    expect(press.note).toMatch(/empty bar/)
    // Coach round 2 (R04): this used to assert that a machine lift with no heuristic got no number
    // and no prompt, which left blank cards. It now asks for a working weight too.
    const pulldown = planLoad(requireExercise("lat-pulldown"), [8, 12], null, profile)
    expect(pulldown.weightKg).toBeNull()
    expect(pulldown.weightSource).toBeNull()
    expect(pulldown.note).toMatch(/^Find your working weight: start light/)
  })
})

describe("load recalibration and kettlebells (F14)", () => {
  it("steps kettlebells to the next standard bell", () => {
    expect(loadKindOf(kbDeadlift)).toBe("kettlebell")
    expect(loadKindOf(requireExercise("goblet-squat"))).toBe("dumbbell")
    // 40 → 44 kg is a 10% jump: the next bell, never a 42 kg bell that standard sets do not have.
    const heavy = recommendWeight(kbDeadlift, [10, 13], session({ prescribedReps: [10, 13], sets: sets(40, [13, 13, 13]) }), "kg")
    expect(heavy.weightKg).toBe(44)
    // In pounds the bells are 5 lb apart.
    const lb = recommendWeight(kbDeadlift, [10, 13], session({ prescribedReps: [10, 13], sets: sets(40, [13, 13, 13]) }), "lb")
    expect(lb.weightKg! / 0.45359237).toBeCloseTo(90, 1)
  })

  it("owns the top of the range twice before a big bell jump, and moves up after", () => {
    const first = session({ prescribedReps: [10, 13], sets: sets(12, [13, 13, 13]) })
    const hold = recommendWeight(kbDeadlift, [10, 13], first, "kg")
    expect(hold.weightKg).toBe(12)
    expect(hold.note).toMatch(/next bell \(16 kg\)/)
    const second = { ...first, date: "2026-10-04", previous: { ...first } }
    expect(recommendWeight(kbDeadlift, [10, 13], second, "kg").weightKg).toBe(16)
    // A previous session at a lighter bell does not count.
    const lighter = { ...first, previous: { ...first, sets: sets(8, [13, 13, 13]) } }
    expect(recommendWeight(kbDeadlift, [10, 13], lighter, "kg").weightKg).toBe(12)
  })

  it("moves a too-light kettlebell estimate up at once when the sets were logged as easy", () => {
    const last = session({ prescribedReps: [10, 13], calibration: true, sets: sets(4, [13, 13, 13], { rpe: 5 }) })
    expect(recommendWeight(kbDeadlift, [10, 13], last, "kg").weightKg).toBeGreaterThanOrEqual(8)
  })

  it("recalibrates through e1RM from logged RPE, capped at +25% per session", () => {
    // 60 kg x 12 at RPE 5 (about 17-rep max); aim at the bottom of the range with 2 in reserve.
    const easy = recommendWeight(libBench, [8, 12], session({ sets: sets(60, [12, 12, 12], { rpe: 5 }) }), "kg", { rir: 2 })
    expect(easy.weightKg).toBe(70)
    expect(easy.note).toMatch(/logged effort/)
    // Far more reps than the range at low effort: capped at +25%.
    const capped = recommendWeight(libBench, [15, 20], session({ prescribedReps: [15, 20], sets: sets(40, [30, 30, 30], { rpe: 4 }) }), "kg", { rir: 2 })
    expect(capped.weightKg).toBe(50)
  })

  it("uses moderate RPE only to recalibrate a first-session guess", () => {
    const logged = sets(100, [12, 12, 12], { rpe: 7 })
    const guess = recommendWeight(libBench, [8, 12], session({ calibration: true, sets: logged }), "kg", { rir: 2 })
    expect(guess.weightKg).toBe(112.5)
    const routine = recommendWeight(libBench, [8, 12], session({ sets: logged }), "kg", { rir: 2 })
    expect(routine.weightKg).toBe(102.5)
  })

  it("keeps the one-step rule without RPE, even after a first-session guess", () => {
    for (const calibration of [false, true]) {
      expect(recommendWeight(libBench, [8, 12], session({ calibration, sets: sets(80, [12, 12, 12]) }), "kg").weightKg).toBe(82.5)
      // Coach round 2 (R11): 10 → 12 kg is a 20% jump, which now waits for a second top session.
      expect(recommendWeight(dbBench, [8, 12], session({ calibration, sets: sets(10, [12, 12]) }), "kg").weightKg).toBe(10)
      const second = session({ calibration, sets: sets(10, [12, 12]), previous: session({ sets: sets(10, [12, 12]) }) })
      expect(recommendWeight(dbBench, [8, 12], second, "kg").weightKg).toBe(12)
    }
    // Hard sets (RPE 9) at the top of the range are not "easy": one step.
    expect(recommendWeight(libBench, [8, 12], session({ sets: sets(80, [12, 12, 12], { rpe: 9 }) }), "kg").weightKg).toBe(82.5)
  })

  it("marks the first logged session as calibration and finds the session before it", () => {
    const first = workoutWith("w1", "2026-10-01", {})
    const one = lastPerformance("dumbbell-bench-press", [first], {})
    expect(one?.calibration).toBe(true)
    expect(one?.previous).toBeNull()
    expect(one?.prescribedSets).toBe(3)

    const second = workoutWith("w2", "2026-10-05", { sets: sets(22, [10, 10, 10]) })
    const two = lastPerformance("dumbbell-bench-press", [first, second], {})
    expect(two?.sets[0]?.weightKg).toBe(22)
    expect(two?.calibration).toBe(false)
    // A session logged from a starting estimate (CompletedExercise.weightSource) is calibration too.
    const guessed = workoutWith("w2", "2026-10-05", { sets: sets(22, [10, 10, 10]), weightSource: "estimate" })
    expect(lastPerformance("dumbbell-bench-press", [first, guessed], {})?.calibration).toBe(true)
    expect(two?.previous?.sets[0]?.weightKg).toBe(20)

    // Older sessions known only from progress also count.
    const progress: Record<string, ExerciseProgress> = {
      "dumbbell-bench-press": {
        exerciseId: "dumbbell-bench-press", bestWeightKg: 22, bestReps: 12, bestVolumeKg: 264, bestE1rmKg: 30, timesPerformed: 6,
        lastPerformedAt: "2026-10-05", updatedAt: "",
        recentSessions: [
          { workoutId: "w2", date: "2026-10-05", sets: sets(22, [10, 10, 10]) },
          { workoutId: "old", date: "2026-09-20", sets: sets(18, [12, 12, 12]) },
        ],
      },
    }
    const known = lastPerformance("dumbbell-bench-press", [second], progress)
    expect(known?.calibration).toBe(false)
    expect(known?.previous?.sets[0]?.weightKg).toBe(18)

    // A session logged from a starting estimate is calibration whatever came before it.
    const flagged = { ...workoutWith("w3", "2026-10-09", {}), exercises: [{ ...second.exercises[0]!, weightSource: "estimate" } as CompletedExercise] }
    expect(lastPerformance("dumbbell-bench-press", [first, flagged], progress)?.calibration).toBe(true)
  })
})

describe("bodyweight and timed progression (F15)", () => {
  const squat = requireExercise("bodyweight-squat")
  const plankEx = requireExercise("plank")
  const kneePushUp = requireExercise("knee-push-up")
  const beginner = { equipment: ["bodyweight" as const], experience: "beginner" as const, limitations: [], excludedExerciseIds: [] }
  const rx = (reps: [number, number] | null, durationSeconds: number | null = null, sets = 3, maxSets = 3) => ({ sets, reps, durationSeconds, rir: 3, maxSets })

  it("steps a topped bodyweight window up inside the exercise's range", () => {
    const last = session({ prescribedReps: [15, 20], prescribedSets: 3, sets: sets(null, [20, 20, 20]) })
    const next = progressUnloaded(squat, rx([15, 20]), last)
    expect(next?.reps).toEqual([18, 23])
    expect(next?.reps).not.toEqual([15, 20])
    expect(next?.note).toMatch(/Top of the range last time/)
    // The earned window is kept and keeps climbing, capped at the exercise's ceiling (25).
    const again = progressUnloaded(squat, rx([15, 20]), session({ prescribedReps: [18, 23], prescribedSets: 3, sets: sets(null, [23, 23, 23]) }))
    expect(again?.reps).toEqual([20, 25])
  })

  it("repeats the prescription after a missed set or when the reserve was below target", () => {
    expect(progressUnloaded(squat, rx([15, 20]), session({ prescribedReps: [15, 20], sets: sets(null, [20, 18, 14]) }))).toBeNull()
    const earned = progressUnloaded(squat, rx([15, 20]), session({ prescribedReps: [18, 23], sets: sets(null, [23, 20, 16]) }))
    expect(earned?.reps).toEqual([18, 23])
    expect(earned?.note).toMatch(/Same 18–23 reps/)
    // Top reps logged at RPE 10 (no reserve) against a target of 3 in reserve: not progressed.
    expect(progressUnloaded(squat, rx([15, 20]), session({ prescribedReps: [15, 20], sets: sets(null, [20, 20, 20], { rpe: 10 }) }))).toBeNull()
    // Skipped sets are not "every set".
    expect(progressUnloaded(squat, rx([15, 20]), session({ prescribedReps: [15, 20], prescribedSets: 3, sets: sets(null, [20]) }))).toBeNull()
  })

  it("adds 5 s to a timed block held for the full time, up to the exercise's longest", () => {
    const next = progressUnloaded(plankEx, rx(null, 30, 2, 3), session({ prescribedReps: null, prescribedDurationSeconds: 30, prescribedSets: 2, sets: sets(null, [null, null]).map((s) => ({ ...s, durationSeconds: 30 })) }))
    expect(next?.durationSeconds).toBe(35)
    expect(next?.sets).toBe(2)
    const short = progressUnloaded(plankEx, rx(null, 30, 2, 3), session({ prescribedReps: null, prescribedDurationSeconds: 30, sets: sets(null, [null, null]).map((s, i) => ({ ...s, durationSeconds: i === 0 ? 30 : 20 })) }))
    expect(short).toBeNull()
    // At the longest hold, a set is added within bounds.
    const top = progressUnloaded(plankEx, rx(null, 30, 2, 3), session({ prescribedReps: null, prescribedDurationSeconds: 60, prescribedSets: 2, sets: sets(null, [null, null]).map((s) => ({ ...s, durationSeconds: 60 })) }))
    expect(top?.durationSeconds).toBe(60)
    expect(top?.sets).toBe(3)
  })

  it("at the ceiling adds a set, then names the harder variation", () => {
    const atTop = (prescribedSets: number) => session({ prescribedReps: [12, 15], prescribedSets, sets: sets(null, Array(prescribedSets).fill(15)) })
    const moreSets = progressUnloaded(kneePushUp, rx([12, 15], null, 3, 4), atTop(3), { profile: beginner })
    expect(moreSets?.sets).toBe(4)
    expect(moreSets?.reps).toEqual([12, 15])
    expect(moreSets?.nextExerciseId).toBeNull()
    const ready = progressUnloaded(kneePushUp, rx([12, 15]), atTop(3), { profile: beginner })
    expect(ready?.sets).toBe(3)
    expect(ready?.nextExerciseId).toBe("push-up")
    expect(ready?.note).toContain(requireExercise("push-up").name)
    // Never suggests a variation the user's limitations or exclusions rule out.
    const area = requireExercise("push-up").contraindications[0]
    if (area) expect(progressUnloaded(kneePushUp, rx([12, 15]), atTop(3), { profile: { ...beginner, limitations: [area] } })?.nextExerciseId).toBeNull()
    expect(progressUnloaded(kneePushUp, rx([12, 15]), atTop(3), { profile: { ...beginner, excludedExerciseIds: ["push-up"] } })?.nextExerciseId).toBeNull()
  })

  it("leaves loaded, explosive and finisher work alone", () => {
    const topped = session({ prescribedReps: [15, 20], sets: sets(null, [20, 20, 20]) })
    expect(progressUnloaded(squat, rx([15, 20]), topped, { role: "finisher" })).toBeNull()
    expect(progressUnloaded(requireExercise("jump-squat"), rx([6, 12]), session({ prescribedReps: [6, 12], sets: sets(null, [12, 12, 12]) }))).toBeNull()
    expect(progressUnloaded(squat, rx([15, 20]), session({ prescribedReps: [15, 20], sets: sets(10, [20, 20, 20]) }))).toBeNull()
    expect(progressUnloaded(dbBench, rx([8, 12]), session({ sets: sets(null, [12, 12, 12]) }))).toBeNull()
    expect(progressUnloaded(squat, rx([15, 20]), null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Coach round 2 fixes.

describe("rep windows that differ between templates (R03)", () => {
  const incline = requireExercise("incline-dumbbell-press")
  const windows: [number, number][] = [
    [6, 10],
    [7, 11],
  ]

  /** Every set at the top of each session's window, alternating the two windows. */
  function alternate(exercise: typeof incline, start: number, sessions: number): number[] {
    const loads: number[] = []
    let weight = start
    let previous: PerformanceRecord | null = null
    for (let i = 0; i < sessions; i++) {
      const window = windows[i % 2]!
      loads.push(weight)
      const done: LastPerformance = { date: `2026-10-${String(i + 1).padStart(2, "0")}`, prescribedReps: window, sets: sets(weight, [window[1], window[1], window[1]]), previous }
      const rec = recommendWeight(exercise, windows[(i + 1) % 2]!, done, "kg", { rir: 2 })
      expect(rec.weightKg, `session ${i + 1}`).not.toBeNull()
      previous = { date: done.date, prescribedReps: window, sets: done.sets }
      weight = rec.weightKg!
    }
    return loads
  }

  it("keeps progressing 6 kg dumbbells when the window alternates 6–10 and 7–11", () => {
    // Was flat at 6 kg for six sessions: every session hit the e1RM translation (× 0.95), which
    // rounded back to the same dumbbell.
    const loads = alternate(incline, 6, 6)
    let rises = 0
    for (let i = 1; i < loads.length; i++) {
      expect(loads[i]!, `session ${i + 1}`).toBeGreaterThanOrEqual(loads[i - 1]!)
      if (loads[i]! > loads[i - 1]!) rises++
    }
    expect(rises).toBeGreaterThanOrEqual(2)
  })

  it("steps a barbell every session across the two windows", () => {
    const loads = alternate(requireExercise("barbell-bench-press"), 60, 5)
    expect(loads).toEqual([60, 62.5, 65, 67.5, 70])
  })

  it("holds when today's window starts at more reps than the logged sets support, never going down", () => {
    // 6 kg × 10 (e1RM 8 kg) does not support 8 kg for 7 reps.
    const last = session({ prescribedReps: [6, 10], sets: sets(6, [10, 10, 10]) })
    const rec = recommendWeight(incline, [7, 11], last, "kg", { rir: 2 })
    expect(rec.weightKg).toBe(6)
    expect(rec.note).toMatch(/^Same 6 kg; today's range starts at 7 reps/)
  })

  it("translates through e1RM only when the windows share no rep or reps were missed, adding the planned RIR", () => {
    const last = perf(60, [12, 12, 12], [8, 12])
    const hard = recommendWeight(bench, [3, 5], last, "kg", { rir: 1 })
    const easy = recommendWeight(bench, [3, 5], last, "kg", { rir: 3 })
    expect(hard.note).toMatch(/^Rep range changed/)
    expect(easy.weightKg!).toBeLessThan(hard.weightKg!)
    // Missed reps in a changed window that today's window also asks for: the translation, lighter.
    const missed = recommendWeight(bench, [10, 14], perf(60, [12, 9, 7], [8, 12]), "kg", { rir: 2 })
    expect(missed.weightKg!).toBeLessThan(60)
    expect(missed.note).toMatch(/^Rep range changed/)
    // Missed last window's bottom but every set reaches today's: repeat the load.
    expect(recommendWeight(bench, [6, 10], perf(60, [12, 9, 7], [8, 12]), "kg", { rir: 2 }).weightKg).toBe(60)
    // Overlapping windows without the top: same load, no translation.
    const partial = recommendWeight(bench, [7, 11], perf(60, [10, 10, 9], [6, 10]), "kg")
    expect(partial.weightKg).toBe(60)
  })

  it("progresses goblet squat and incline press in a 29-day hypertrophy-beginner-dumbbells-3d replay", () => {
    const profile = makeProfile({
      id: "replay-hypertrophy-beginner-dumbbells-3d",
      goal: "muscle_gain",
      experience: "beginner",
      gender: "female",
      weightKg: 61,
      trainingDaysPerWeek: 3,
      equipmentPreset: "dumbbells",
      equipment: EQUIPMENT_PRESETS.dumbbells,
      durationPreferenceMinutes: 45,
    })
    const history: CompletedWorkout[] = []
    const loads = new Map<string, number[]>()
    for (const day of trainingDayOffsets(3, 29)) {
      const w = generateWorkout(makeInput(profile, addDays("2026-10-05", day), [...history].reverse(), progressFromHistory(history)))
      for (const e of w.exercises) {
        if (e.phase !== "main" || getExercise(e.exerciseId)?.loadType !== "external" || e.recommendedWeightKg === null) continue
        // A maintenance dose holds its load on purpose (capped volume).
        if (/hold the load/.test(e.note ?? "") || e.loadCheck) continue
        loads.set(e.exerciseId, [...(loads.get(e.exerciseId) ?? []), e.recommendedWeightKg])
      }
      history.push(completeAtTop(w, getExercise, 40, { loads: "calibrated", lifter: profile }))
    }
    for (const [id, list] of loads) {
      for (let i = 1; i < list.length; i++) expect(list[i]!, `${id}: ${list.join(", ")}`).toBeGreaterThanOrEqual(list[i - 1]!)
    }
    let checked = 0
    for (const id of ["goblet-squat", "incline-dumbbell-press"]) {
      const list = loads.get(id) ?? []
      if (list.length < 3) continue
      checked++
      for (let i = 0; i + 2 < list.length; i++) {
        expect(list[i + 2]!, `${id} rises within 3 exposures: ${list.join(", ")}`).toBeGreaterThan(list[i]!)
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe("first exposure of loads without a heuristic (R04)", () => {
  const profile = { weightKg: 82, gender: "male" as const, experience: "intermediate" as const, units: "kg" as const }

  it("asks for a working weight on machines, cables, landmines, bands and untabled dumbbell patterns", () => {
    for (const id of ["leg-press", "seated-cable-row", "landmine-press", "band-pushdown", "dumbbell-front-raise"]) {
      const planned = planLoad(requireExercise(id), [10, 15], null, profile, { rir: 3 })
      expect(planned.weightKg, id).toBeNull()
      expect(planned.note, id).toMatch(/working weight|band/)
      expect(planned.note, id).toMatch(/10–15 reps leave about 3 in reserve/)
    }
  })

  it("names the build-up sets as extra to the working sets", () => {
    const note = planLoad(requireExercise("seated-cable-row"), [8, 12], null, profile, { rir: 2 }).note!
    expect(note).toMatch(/^Find your working weight: start light and add weight over 1–2 build-up sets/)
    expect(note).toMatch(/then do your working sets at that load/)
  })

  it("gives band lifts a band note with how to progress", () => {
    const note = planLoad(requireExercise("band-row"), [12, 20], null, profile, { rir: 3 }).note!
    expect(note.startsWith(FIND_BAND_PREFIX)).toBe(true)
    expect(note).toMatch(/heavier band or stand farther from the anchor/)
  })

  it("never leaves a first-exposure loaded lift with neither a load nor a note", () => {
    for (const experience of ["beginner", "intermediate", "advanced"] as const) {
      for (const exercise of EXERCISES) {
        if (exercise.loadType !== "external" || !exercise.repRange) continue
        const planned = planLoad(exercise, exercise.repRange, null, { ...profile, experience }, { rir: 3 })
        expect(planned.weightKg !== null || planned.note !== null, `${exercise.id} ${experience}`).toBe(true)
      }
    }
  })
})

describe("starting loads for trained lifters (R10)", () => {
  const advanced = { weightKg: 95, gender: "male" as const, experience: "advanced" as const, units: "kg" as const }

  it("lets an advanced lifter's ramp-up sets find the bench instead of a light guess", () => {
    const planned = planLoad(requireExercise("barbell-bench-press"), [5, 7], null, advanced, { rir: 3 })
    expect(planned.weightKg).toBeNull()
    expect(planned.note).toMatch(/^Find your working weight: start with the empty bar and add weight over 3–4 build-up sets/)
    // A beginner keeps the conservative estimate.
    expect(planLoad(requireExercise("barbell-back-squat"), [6, 8], null, { ...advanced, experience: "beginner" }).weightSource).toBe("estimate")
  })

  it("does not flag a genuine logged load of a trained lifter as a slip", () => {
    // Logged 60 kg after a 45 kg estimate: no check note.
    const bench = planLoad(requireExercise("barbell-bench-press"), [5, 7], session({ prescribedReps: [5, 7], sets: sets(60, [7, 7, 7]) }), advanced, { rir: 1 })
    expect(bench.loadCheck).toBeUndefined()
    expect(bench.weightKg).toBeGreaterThan(60)
    // A 12 kg lateral raise (raw estimate about 3 kg) was flagged above about 9 kg.
    const raise = planLoad(requireExercise("dumbbell-lateral-raise"), [12, 15], session({ prescribedReps: [12, 15], sets: sets(12, [15, 15, 15]) }), advanced, { rir: 1 })
    expect(raise.loadCheck).toBeUndefined()
    // A real slip is still caught: 40 kg "per hand" on a beginner woman's seated dumbbell press.
    const beginnerWoman = { weightKg: 58, gender: "female" as const, experience: "beginner" as const, units: "kg" as const }
    const slip = planLoad(requireExercise("seated-dumbbell-shoulder-press"), [8, 12], session({ sets: sets(40, [12, 12, 12]) }), beginnerWoman)
    expect(slip.loadCheck).toBe(true)
    expect(slip.note).toMatch(/^Check your logged weight/)
  })

  it("lets a first session logged as easy recalibrate past the 25% cap", () => {
    const easyGuess = session({ prescribedReps: [15, 20], calibration: true, sets: sets(40, [30, 30, 30], { rpe: 4 }) })
    expect(recommendWeight(libBench, [15, 20], easyGuess, "kg", { rir: 2 }).weightKg).toBeGreaterThan(50)
    // A routine session keeps the +25% cap (see F14 above).
    expect(recommendWeight(libBench, [15, 20], { ...easyGuess, calibration: false }, "kg", { rir: 2 }).weightKg).toBe(50)
  })

  it("says how far to move a starting guess that is far too light", () => {
    expect(STARTING_GUESS_NOTE).toMatch(/more than 4 reps in reserve, go up about 10–20%/)
  })
})

describe("big load jumps on any implement (R11)", () => {
  const curl = requireExercise("dumbbell-curl")

  it("holds a 4 kg dumbbell after one top-of-range session and steps after two", () => {
    const once = session({ prescribedReps: [10, 12], sets: sets(4, [12, 12, 12]) })
    const hold = recommendWeight(curl, [10, 12], once, "kg")
    expect(hold.weightKg).toBe(4)
    expect(hold.note).toBe("Stay at 4 kg: the next step (6 kg) is a big jump. Hit 12 reps on every set once more, then move up.")
    const twice = { ...once, previous: { ...once } }
    expect(recommendWeight(curl, [10, 12], twice, "kg").weightKg).toBe(6)
  })

  it("still steps a 40 kg barbell (2.5 kg = 6%) after one top session", () => {
    expect(recommendWeight(libBench, [8, 12], session({ sets: sets(40, [12, 12, 12]) }), "kg").weightKg).toBe(42.5)
  })

  it("lets logged effort that supports the jump through", () => {
    const easy = session({ prescribedReps: [10, 12], sets: sets(4, [12, 12, 12], { rpe: 5 }) })
    expect(recommendWeight(curl, [10, 12], easy, "kg").weightKg).toBeGreaterThan(4)
  })
})

describe("unloaded and conditioning work at its ceiling (R12)", () => {
  it("slows the lowering one second at a time from the prescribed tempo", () => {
    expect(slowerEccentricTempo("4-0-X-0")).toBe("5-0-X-0")
    expect(slowerEccentricTempo("2-0-1-0")).toBe("3-0-1-0")
    expect(slowerEccentricTempo(null)).toBe("3-0-1-0")
    expect(slowerEccentricTempo("6-0-1-0")).toBeNull()
  })

  it("writes the slower tempo on the card and names it in the note", () => {
    // Negative pull-ups (4 s lowering) at 3 × 6 for a beginner: no harder variation passes the
    // filter, and the old note asked for a 3 s lowering against the prescribed 4 s.
    const negative = requireExercise("negative-pull-up")
    const profile = { equipment: ["bodyweight" as const, "pull_up_bar" as const], experience: "beginner" as const, limitations: [], excludedExerciseIds: [] }
    const last = session({ prescribedReps: [3, 6], prescribedSets: 3, sets: sets(null, [6, 6, 6]) })
    const next = progressUnloaded(negative, { sets: 3, reps: [3, 6], durationSeconds: null, rir: 3, maxSets: 3 }, last, { profile })
    expect(next?.nextExerciseId).toBeNull()
    expect(next?.tempo).toBe("5-0-0-1")
    expect(next?.note).toMatch(/lower each rep over 5 s \(tempo 5-0-0-1\)/)
    // A slower tempo earned last time keeps slowing.
    const again = progressUnloaded(negative, { sets: 3, reps: [3, 6], durationSeconds: null, rir: 3, maxSets: 3 }, { ...last, prescribedTempo: "5-0-0-1" }, { profile })
    expect(again?.tempo).toBe("6-0-0-1")
    // At a 6 s lowering there is no slower tempo: the note names a harder variation instead.
    const slowest = progressUnloaded(negative, { sets: 3, reps: [3, 6], durationSeconds: null, rir: 3, maxSets: 3 }, { ...last, prescribedTempo: "6-0-0-1" }, { profile })
    expect(slowest?.tempo).toBeUndefined()
    expect(slowest?.note).toMatch(/ready for a harder variation/)
  })

  it("reads a recorded tempo and rest from history once completed workouts carry them", () => {
    const recorded = { prescribedTempo: "5-0-0-1", prescribedRestSeconds: 70 } as Partial<CompletedExercise>
    const last = lastPerformance("dumbbell-bench-press", [workoutWith("w1", "2026-10-01", recorded)], {})
    expect(last?.prescribedTempo).toBe("5-0-0-1")
    expect(last?.prescribedRestSeconds).toBe(70)
    expect(lastPerformance("dumbbell-bench-press", [workoutWith("w1", "2026-10-01", {})], {})?.prescribedTempo).toBeNull()
  })

  it("moves one finisher lever per session once every round was completed", () => {
    const rowing = requireExercise("rowing-intervals") // 30–60 s, 6–10 rounds, 60–90 s rest
    const rx = { sets: 6, reps: null, durationSeconds: 30, restSeconds: 60 }
    const done = (rounds: number, seconds: number, extra: Partial<LastPerformance> = {}): LastPerformance =>
      session({ prescribedReps: null, prescribedSets: rounds, prescribedDurationSeconds: seconds, sets: sets(null, Array(rounds).fill(null)).map((s) => ({ ...s, durationSeconds: seconds })), ...extra })
    const longer = progressFinisher(rowing, rx, done(6, 30))
    expect(longer).toMatchObject({ sets: 6, durationSeconds: 35, restSeconds: 60 })
    expect(longer?.note).toMatch(/^Held the full 30 s every round last time: 35 s per round today\./)
    // Work at its longest: one more round.
    expect(progressFinisher(rowing, rx, done(6, 60))).toMatchObject({ sets: 7, durationSeconds: 60 })
    // Rounds and work at their ceiling: shorter rest, down to the exercise's own minimum.
    expect(progressFinisher(rowing, { ...rx, restSeconds: 75 }, done(10, 60))).toMatchObject({ sets: 10, durationSeconds: 60, restSeconds: 70 })
    // A round cut short or skipped: no progression.
    const short = done(6, 30)
    short.sets[2] = { ...short.sets[2]!, durationSeconds: 20 }
    expect(progressFinisher(rowing, rx, short)).toBeNull()
    expect(progressFinisher(rowing, rx, { ...done(6, 30), sets: done(6, 30).sets.slice(0, 4) })).toBeNull()
    expect(progressFinisher(rowing, rx, null)).toBeNull()
  })
})

describe("finding a trunk drill's load (core spec C15)", () => {
  const profile = makeProfile({ goal: "strength", experience: "intermediate" })

  it("the first set sets the weight: no empty bar, no build-up sets", () => {
    const pallof = requireExercise("pallof-press")
    const held = planLoad(pallof, [8, 10], null, profile, { rir: null })
    expect(held.weightKg).toBeNull()
    expect(held.note!.startsWith(FIND_WORKING_WEIGHT_PREFIX)).toBe(true)
    expect(held.note).toContain("the first set sets the weight")
    expect(held.note).toContain("without losing position")
    expect(held.note).not.toMatch(/empty bar|build-up sets/)
    // With an RIR target (flexion work) the reserve clause stays, as lib/coach/apply.ts rewrites it.
    const crunch = planLoad(requireExercise("cable-crunch"), [10, 12], null, profile, { rir: 2 })
    expect(crunch.note!.startsWith(FIND_WORKING_WEIGHT_PREFIX)).toBe(true)
    expect(crunch.note).toContain("until 10–12 reps leave about 2 in reserve")
    expect(crunch.note).not.toMatch(/empty bar|build-up sets/)
    // Other lifts keep their build-up sets.
    expect(planLoad(requireExercise("seated-cable-row"), [8, 12], null, profile, { rir: 2 }).note).toContain("build-up sets")
  })
})
