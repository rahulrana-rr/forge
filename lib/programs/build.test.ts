import { describe, expect, it } from "vitest"

import { addDays } from "@/lib/dates"
import type { CompletedWorkout, ExerciseProgress } from "@/lib/domain/types"
import { getExercise } from "@/lib/exercises"
import { generateWorkout } from "@/lib/engine"
import { makeInput, makeProfile } from "@/lib/engine/test-fixtures"
import type { Workout, WorkoutExercise } from "@/lib/engine/types"
import { getProgram, parseAssignment, PROGRAMS } from "./index"
import {
  buildProgramWorkout,
  programPlanKey,
  programReplacementCandidates,
  programSwapOptions,
  programWeek,
  replaceProgramExercise,
  workoutPlanKey,
} from "./build"
import { RETURNING_LIFTER_CALISTHENICS_ID, returningLifterCalisthenics as program } from "./returning-lifter-calisthenics"
import type { ProgramAssignment } from "./types"

/** A Monday, so day offsets 0-6 are Monday-Sunday. */
const START = "2026-10-12"
const assignment: ProgramAssignment = { programId: RETURNING_LIFTER_CALISTHENICS_ID, startDate: START }
const profile = makeProfile({ experience: "advanced", gender: "male", weightKg: 72 })

/** The workout for program week `week` (1-based calendar week) and weekday offset from Monday. */
function day(week: number, mondayOffset: number, history: CompletedWorkout[] = [], progress: Record<string, ExerciseProgress> = {}): Workout {
  const date = addDays(START, (week - 1) * 7 + mondayOffset)
  const workout = buildProgramWorkout(program, assignment, makeInput(profile, date, history, progress))
  if (!workout) throw new Error(`no workout for week ${week} day ${mondayOffset}`)
  return workout
}

/** Weeks 3-7 of the second block (the plan as written, without the first block's holds). */
function repeat(week: number, mondayOffset: number): Workout {
  return day(week + 5, mondayOffset)
}

const MON = 0
const TUE = 1
const WED = 2
const THU = 3
const FRI = 4
const SAT = 5
const SUN = 6

function slot(workout: Workout, exerciseId: string): WorkoutExercise | undefined {
  return workout.exercises.find((e) => e.exerciseId === exerciseId)
}

function must(workout: Workout, exerciseId: string): WorkoutExercise {
  const found = slot(workout, exerciseId)
  if (!found) throw new Error(`${exerciseId} missing from ${workout.title}`)
  return found
}

describe("programWeek", () => {
  it("counts weeks from the start date and repeats from week 3 after week 7", () => {
    expect(programWeek(START, addDays(START, -1))).toBeNull()
    expect(programWeek(START, START)).toBe(1)
    expect(programWeek(START, addDays(START, 6))).toBe(1)
    expect(programWeek(START, addDays(START, 7))).toBe(2)
    expect(programWeek(START, addDays(START, 48))).toBe(7)
    expect(programWeek(START, addDays(START, 49))).toBe(3)
    expect(programWeek(START, addDays(START, 11 * 7))).toBe(7)
    expect(programWeek(START, addDays(START, 12 * 7))).toBe(3)
  })
})

describe("buildProgramWorkout", () => {
  it("builds every weekday of weeks 1-8 from library exercises only", () => {
    for (let week = 1; week <= 8; week++) {
      for (let d = 0; d < 7; d++) {
        const workout = day(week, d)
        expect(workout.exercises.length, workout.title).toBeGreaterThan(0)
        expect(workout.program?.id).toBe(RETURNING_LIFTER_CALISTHENICS_ID)
        expect(workout.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(new Set(workout.exercises.map((e) => e.slotId)).size).toBe(workout.exercises.length)
        // A rest day plans no session time (its walk is optional).
        if (d === SUN) expect(workout.estimatedMinutes).toBe(0)
        else expect(workout.estimatedMinutes).toBeGreaterThan(0)
        for (const e of workout.exercises) {
          expect(getExercise(e.exerciseId), e.exerciseId).toBeDefined()
          expect(e.sets).toBeGreaterThanOrEqual(1)
          expect(e.reps === null).toBe(e.durationSeconds !== null)
          if (e.recommendedWeightKg !== null) expect(e.recommendedWeightKg).toBeGreaterThan(0)
        }
        // Week 8 is week 3 of block 2.
        expect(workout.title).toContain(week === 8 ? "Block 2, week 3" : `Week ${week} of 7`)
      }
    }
  })

  it("follows the weekly schedule", () => {
    expect(day(3, MON).title).toBe("Upper A · Week 3 of 7")
    expect(day(3, TUE).title).toBe("Lower A · Week 3 of 7")
    expect(day(3, WED).title).toBe("Zone 2 · Week 3 of 7")
    expect(day(3, THU).title).toBe("Upper B · Week 3 of 7")
    expect(day(3, FRI).title).toBe("Lower B · Week 3 of 7")
    expect(day(3, SAT).title).toBe("Conditioning · Week 3 of 7")
    expect(day(3, SUN).title).toBe("Rest day · Week 3 of 7")
  })

  it("weeks 1-2: 2 working sets per lift at RIR 3, no overhead press, deadlift 2 × 5 at RIR 4", () => {
    for (const week of [1, 2]) {
      const mon = day(week, MON)
      expect(slot(mon, "seated-dumbbell-shoulder-press")).toBeUndefined()
      for (const id of ["barbell-bench-press", "pull-up", "chest-supported-dumbbell-row", "triceps-dip", "face-pull"]) {
        expect(must(mon, id).sets, id).toBe(2)
        expect(must(mon, id).rir, id).toBe(3)
      }
      const fri = day(week, FRI)
      expect(must(fri, "conventional-deadlift")).toMatchObject({ sets: 2, reps: [5, 5], rir: 4 })
      expect(slot(fri, "medicine-ball-scoop-toss")?.sets).toBe(3)
      expect(slot(fri, "broad-jump")).toBeUndefined()
      // Skill holds stay 3 sets.
      expect(must(day(week, THU), "box-pike-hold").sets).toBe(3)
    }
    // Box pistols start in week 2.
    expect(slot(day(1, FRI), "box-pistol-squat")).toBeUndefined()
    expect(must(day(2, FRI), "box-pistol-squat")).toMatchObject({ sets: 2, reps: [3, 5], rir: 3 })
    expect(day(1, MON).notes?.[0]).toMatch(/^Weeks 1-2, re-entry.*No overhead press yet; skill holds are 3 easy sets\.$/)
    expect(must(day(1, MON), "triceps-dip").note).toMatch(/swipe left for assisted/)
    expect(day(1, MON).notes?.join(" ")).toMatch(/PAR-Q\+/)
    expect(day(2, MON).notes?.join(" ")).not.toMatch(/PAR-Q\+/)
  })

  it("week 3 as written (repeat blocks): full sets, compounds at RIR 3, isolation at RIR 2, overhead press joins", () => {
    const mon = repeat(3, MON)
    expect(must(mon, "barbell-bench-press")).toMatchObject({ sets: 3, reps: [5, 8], rir: 3 })
    expect(must(mon, "incline-dumbbell-curl")).toMatchObject({ sets: 2, rir: 2 })
    expect(must(mon, "seated-dumbbell-shoulder-press")).toMatchObject({ sets: 2, reps: [8, 12], rir: 3 })
    expect(must(repeat(3, FRI), "conventional-deadlift")).toMatchObject({ sets: 3, reps: [4, 6], rir: 3 })
    expect(must(repeat(3, TUE), "seated-leg-curl")).toMatchObject({ sets: 3, rir: 2 })
    expect(must(repeat(3, WED), "stationary-bike").durationSeconds).toBe(35 * 60)
    // The first block's week notes stay in the first block.
    expect(mon.notes?.join(" ")).not.toMatch(/were not done in weeks 1-2/)
  })

  it("weeks 4-6 as written (repeat blocks): the listed prescription, compounds at RIR 2", () => {
    for (const week of [4, 5, 6]) {
      const day = (_week: number, offset: number) => repeat(week, offset)
      const mon = day(week, MON)
      expect(must(mon, "barbell-bench-press")).toMatchObject({ sets: 3, reps: [5, 8], rir: 2, restSeconds: 150 })
      expect(must(mon, "pull-up")).toMatchObject({ sets: 3, reps: [6, 10], rir: 2 })
      expect(must(mon, "dumbbell-lateral-raise")).toMatchObject({ sets: 2, reps: [12, 20], rir: 1 })
      expect(must(day(week, TUE), "barbell-back-squat")).toMatchObject({ sets: 3, reps: [5, 8], rir: 2, restSeconds: 180 })
      expect(must(day(week, THU), "lat-pulldown")).toMatchObject({ sets: 3, reps: [8, 12], rir: 2 })
      expect(must(day(week, FRI), "conventional-deadlift")).toMatchObject({ sets: 3, reps: [4, 6], rir: 2 })
      // Scoop toss weeks 1-3, broad jump from week 4.
      expect(slot(day(week, FRI), "medicine-ball-scoop-toss")).toBeUndefined()
      expect(must(day(week, FRI), "broad-jump")).toMatchObject({ sets: 3, reps: [3, 3] })
    }
  })

  it("week 7 deload: 3-set lifts to 2, 2-set lifts to 1, RIR 4; sprints 3, jumps 2 × 3, intervals 4; skill unchanged", () => {
    const mon = day(7, MON)
    expect(must(mon, "barbell-bench-press")).toMatchObject({ sets: 2, rir: 4 })
    expect(must(mon, "seated-dumbbell-shoulder-press")).toMatchObject({ sets: 1, rir: 4 })
    expect(must(mon, "face-pull")).toMatchObject({ sets: 1, rir: 4 })
    const tue = day(7, TUE)
    expect(must(tue, "acceleration-sprint").sets).toBe(3)
    expect(must(tue, "acceleration-sprint").note).toMatch(/80%/)
    expect(must(tue, "box-jump")).toMatchObject({ sets: 2, reps: [3, 3] })
    expect(must(day(7, FRI), "broad-jump")).toMatchObject({ sets: 2, reps: [3, 3] })
    expect(must(day(7, FRI), "box-pistol-squat")).toMatchObject({ sets: 1, rir: 4 })
    expect(must(day(7, SAT), "bike-intervals").sets).toBe(4)
    expect(must(day(7, THU), "box-pike-hold").sets).toBe(3)
    expect(day(7, MON).notes?.[0]).toMatch(/^Week 7, deload/)
    expect(must(day(7, THU), "box-pike-hold").note).toMatch(/^Deload: stay at your current step/)
    expect(must(day(7, THU), "tuck-l-sit").note).toMatch(/^Deload: stay at your current step/)
    expect(must(day(7, FRI), "box-pistol-squat").note).toMatch(/^Deload: keep your current box height/)
  })

  it("sprint dose table and acceleration notes", () => {
    const expected: [number, number, string][] = [
      [1, 4, "70%"],
      [2, 4, "80%"],
      [3, 5, "85%"],
      [4, 6, "90%"],
      [5, 6, "90–95%"],
      [6, 6, "90–95%"],
      [7, 3, "80%"],
    ]
    for (const [week, sets, effort] of expected) {
      const sprint = must(week <= 2 ? day(week, TUE) : repeat(week, TUE), "acceleration-sprint")
      expect(sprint.sets, `week ${week}`).toBe(sets)
      expect(sprint.reps).toEqual([1, 1])
      expect(sprint.note).toContain(`20 m at ${effort}.`)
      expect(sprint.recommendedWeightKg).toBeNull()
    }
  })

  it("Zone 2 minutes and Saturday conditioning", () => {
    const minutes: [number, number][] = [[1, 30], [2, 30], [3, 35], [4, 40], [5, 40], [6, 40], [7, 30]]
    for (const [week, m] of minutes) {
      const wed = week <= 2 ? day(week, WED) : repeat(week, WED)
      expect(wed.exercises.filter((e) => e.phase === "main")).toHaveLength(1)
      expect(wed.exercises[0]).toMatchObject({ exerciseId: "stationary-bike", sets: 1, durationSeconds: m * 60 })
    }
    for (const week of [1, 2]) {
      const sat = day(week, SAT)
      expect(sat.exercises.filter((e) => e.phase === "main").map((e) => e.exerciseId)).toEqual(["stationary-bike"])
      expect(sat.exercises[0].durationSeconds).toBe(30 * 60)
    }
    const rounds: [number, number][] = [[3, 5], [4, 6], [5, 7], [6, 8]]
    for (const [week, n] of rounds) {
      const sat = day(week, SAT)
      expect(sat.exercises.filter((e) => e.phase !== "cooldown" || e.exerciseId === "bike-cooldown").map((e) => e.exerciseId)).toEqual(["warmup-bike", "bike-intervals", "bike-cooldown"])
      expect(must(sat, "bike-intervals")).toMatchObject({ sets: n, durationSeconds: 60, restSeconds: 120 })
    }
  })

  it("revision 1, first block: Upper A and Lower A run one week behind from week 3", () => {
    const mon3 = day(3, MON)
    for (const id of ["barbell-bench-press", "pull-up", "chest-supported-dumbbell-row", "triceps-dip", "incline-dumbbell-curl", "face-pull"]) {
      expect(must(mon3, id), id).toMatchObject({ sets: 2, rir: 3 })
    }
    expect(slot(mon3, "seated-dumbbell-shoulder-press")).toBeUndefined()
    expect(must(mon3, "triceps-dip").note).toMatch(/Shoulders no lower than elbows/)
    expect(must(day(3, TUE), "barbell-back-squat")).toMatchObject({ sets: 2, reps: [5, 8], rir: 3 })
    expect(must(day(3, TUE), "romanian-deadlift")).toMatchObject({ sets: 2, rir: 3 })
    expect(must(day(3, TUE), "box-jump").note).toMatch(/well short of your maximum/)
    // Week 4 gets week 3's prescription, and overhead press joins.
    const mon4 = day(4, MON)
    expect(must(mon4, "barbell-bench-press")).toMatchObject({ sets: 3, reps: [5, 8], rir: 3 })
    expect(must(mon4, "seated-dumbbell-shoulder-press")).toMatchObject({ sets: 2, reps: [8, 12], rir: 3 })
    expect(must(day(4, TUE), "seated-leg-curl")).toMatchObject({ sets: 3, rir: 2 })
    // Weeks 5-6 and the deload are as written.
    expect(must(day(5, MON), "barbell-bench-press")).toMatchObject({ sets: 3, rir: 2 })
    expect(must(day(7, MON), "barbell-bench-press")).toMatchObject({ sets: 2, rir: 4 })
    expect(mon3.notes?.join(" ")).toMatch(/were not done in weeks 1-2/)
    expect(mon4.notes?.join(" ")).toMatch(/one week behind/)
  })

  it("revision 1, first block: sprints restart at the week-1 dose and step up one column a week", () => {
    const expected: [number, number, string][] = [[3, 4, "70%"], [4, 4, "80%"], [5, 5, "85%"], [6, 6, "90%"], [7, 3, "80%"]]
    for (const [week, sets, effort] of expected) {
      const sprint = must(day(week, TUE), "acceleration-sprint")
      expect(sprint.sets, `week ${week}`).toBe(sets)
      expect(sprint.note).toContain(`20 m at ${effort}.`)
      if (week < 7) expect(sprint.note).toMatch(/Move up only after a clean session/)
    }
  })

  it("revision 1, first block: Zone 2 stays at 30 min and the first intervals are capped; Upper B and Lower B as written", () => {
    expect(must(day(3, WED), "stationary-bike").durationSeconds).toBe(30 * 60)
    expect(must(day(4, WED), "stationary-bike").durationSeconds).toBe(40 * 60)
    expect(must(day(3, SAT), "bike-intervals")).toMatchObject({ sets: 5 })
    expect(must(day(3, SAT), "bike-intervals").note).toMatch(/7–8\/10, not harder/)
    expect(must(day(4, SAT), "bike-intervals").note).toMatch(/about 8\/10/)
    expect(must(day(3, THU), "lat-pulldown")).toMatchObject({ sets: 3, rir: 3 })
    expect(must(day(3, FRI), "leg-press")).toMatchObject({ sets: 3, rir: 3 })
    // The deadlift was a different variation in each of weeks 1-2: it also runs a week behind.
    expect(must(day(3, FRI), "conventional-deadlift")).toMatchObject({ sets: 2, reps: [5, 5], rir: 4 })
    expect(must(day(4, FRI), "conventional-deadlift")).toMatchObject({ sets: 3, reps: [4, 6], rir: 3 })
  })

  it("revision 1: conventional deadlift and cable pull-through replace the trap bar and hip thrust in every block", () => {
    for (const workout of [day(3, FRI), repeat(3, FRI), repeat(6, FRI)]) {
      expect(slot(workout, "trap-bar-deadlift")).toBeUndefined()
      expect(slot(workout, "barbell-hip-thrust")).toBeUndefined()
      expect(must(workout, "conventional-deadlift").note).toMatch(/total load including the bar/)
      expect(must(workout, "cable-pull-through")).toMatchObject({ sets: 2, reps: [10, 12] })
    }
    expect(must(day(3, FRI), "medicine-ball-scoop-toss").note).toMatch(/jump squats/)
  })

  it("every training day ends with the coach-approved stretches, then optional breathing", () => {
    const expected: Record<number, string[]> = {
      [MON]: ["chest-doorway-stretch", "lat-stretch", "overhead-triceps-stretch", "wrist-flexor-stretch", "child-pose"],
      [WED]: ["kneeling-hip-flexor-stretch", "bent-knee-calf-stretch", "downward-dog-hold"],
      [SAT]: ["kneeling-hip-flexor-stretch", "standing-quad-stretch", "child-pose"],
    }
    for (const week of [1, 4, 7]) {
      for (const [weekday, ids] of Object.entries(expected)) {
        const cooldown = day(week, Number(weekday)).exercises.filter((e) => e.phase === "cooldown" && e.exerciseId !== "bike-cooldown")
        expect(cooldown.map((e) => e.exerciseId)).toEqual([...ids, "box-breathing"])
        for (const e of cooldown) expect(e).toMatchObject({ sets: 1, reps: null, rir: null, restSeconds: 0 })
      }
    }
    for (const weekday of [TUE, THU, FRI]) {
      const cooldown = day(3, weekday).exercises.filter((e) => e.phase === "cooldown")
      expect(cooldown.length).toBeGreaterThanOrEqual(5)
      expect(cooldown.at(-1)?.exerciseId).toBe("box-breathing")
      expect(cooldown.slice(0, -1).every((e) => /mild stretch/.test(e.note ?? ""))).toBe(true)
    }
  })

  it("rest day: one optional easy walk", () => {
    const sun = day(4, SUN)
    expect(sun.exercises).toHaveLength(1)
    expect(sun.exercises[0]).toMatchObject({ exerciseId: "outdoor-walk", phase: "main" })
    expect(sun.exercises[0].note).toMatch(/^Optional walk/)
    expect(sun.estimatedMinutes).toBe(0)
  })

  it("loads external lifts from history or a starting estimate, never bodyweight, assisted, timed or explosive work", () => {
    const mon = day(4, MON)
    expect(must(mon, "barbell-bench-press").weightSource).not.toBeUndefined()
    const fri = day(4, FRI)
    for (const id of ["broad-jump", "box-pistol-squat"]) expect(must(fri, id).recommendedWeightKg, id).toBeNull()
    expect(must(day(4, THU), "box-pike-hold").recommendedWeightKg).toBeNull()
    expect(must(mon, "pull-up").recommendedWeightKg).toBeNull()
    expect(must(day(1, FRI), "medicine-ball-scoop-toss").recommendedWeightKg).toBeNull()
  })

  it("names the later target when a new load is found above the slot's RIR, and prints a fixed rep count once", () => {
    const raise = must(repeat(4, MON), "dumbbell-lateral-raise")
    expect(raise.rir).toBe(1)
    expect(raise.note).toContain("leave about 2 in reserve this first time, then do your working sets at that load and log it; from next session work at RIR 1.")
    const fri = day(4, FRI)
    expect(must(fri, "pallof-press").note).not.toMatch(/10–10/)
  })

  it("progresses a logged lift through the engine's progression", () => {
    const history: CompletedWorkout[] = [
      {
        id: "w1",
        date: addDays(START, 21),
        title: "Upper A · Week 4 of 7",
        split: "upper",
        focus: ["chest"],
        goal: "muscle_gain",
        startedAt: `${addDays(START, 21)}T07:00:00.000Z`,
        completedAt: `${addDays(START, 21)}T08:00:00.000Z`,
        durationSeconds: 3600,
        exercises: [
          {
            slotId: "s1",
            exerciseId: "barbell-bench-press",
            role: "primary_compound",
            phase: "main",
            status: "completed",
            sets: [1, 2, 3].map((n) => ({ setNumber: n, weightKg: 80, reps: 8, completed: true })),
            prescribedSets: 3,
            prescribedReps: [5, 8],
            prescribedDurationSeconds: null,
            recommendedWeightKg: 80,
            weightSource: "history",
          },
        ],
        totals: { exercisesCompleted: 1, exercisesSkipped: 0, sets: 3, reps: 24, volumeKg: 1920, caloriesEstimate: null },
        personalRecords: [],
        engineVersion: 1,
        synced: false,
      },
    ]
    const bench = must(day(5, MON, history), "barbell-bench-press")
    expect(bench.weightSource).toBe("history")
    expect(bench.recommendedWeightKg).toBeGreaterThan(80)
  })

  it("starts a gated item on the step completed most recently", () => {
    const progress: Record<string, ExerciseProgress> = {
      "wall-walk-hold": {
        exerciseId: "wall-walk-hold",
        bestWeightKg: null,
        bestReps: null,
        bestVolumeKg: null,
        bestE1rmKg: null,
        timesPerformed: 2,
        lastPerformedAt: `${addDays(START, 24)}T08:00:00.000Z`,
        recentSessions: [],
        updatedAt: `${addDays(START, 24)}T08:00:00.000Z`,
      },
    }
    const thu = day(5, THU, [], progress)
    expect(slot(thu, "box-pike-hold")).toBeUndefined()
    expect(must(thu, "wall-walk-hold")).toMatchObject({ sets: 3, durationSeconds: 20, rir: null })
  })

  it("returns null before the start date", () => {
    expect(buildProgramWorkout(program, assignment, makeInput(profile, addDays(START, -1)))).toBeNull()
  })

  it("ships no personal data in program definitions", () => {
    const text = JSON.stringify(PROGRAMS)
    expect(text).not.toMatch(/@/)
    expect(text).not.toMatch(/\bRon\b/i)
    expect(text).not.toMatch(/\b\d{2,3}\s?kg\b/)
    expect(text).not.toMatch(/\b\d{3}\s?cm\b/)
  })

  it("references library ids only, and every step and alternative exists", () => {
    for (const p of PROGRAMS) {
      for (const d of Object.values(p.days)) {
        for (const item of d.items) {
          expect(getExercise(item.exerciseId), item.exerciseId).toBeDefined()
          for (const step of item.steps ?? []) expect(getExercise(step.exerciseId), step.exerciseId).toBeDefined()
        }
      }
      for (const key of Object.values(p.schedule)) if (key) expect(p.days[key], key).toBeDefined()
    }
  })
})

describe("program swaps", () => {
  it("a left swipe takes the next step and keeps the program's dose", () => {
    const thu = day(4, THU)
    const pike = must(thu, "box-pike-hold")
    expect(programSwapOptions(thu, pike.slotId)[0]).toBe("wall-walk-hold")
    const input = makeInput(profile, thu.date)
    const swapped = replaceProgramExercise(thu, pike.slotId, input, { exclude: ["box-pike-hold"] })
    const next = swapped?.exercises.find((e) => e.slotId === pike.slotId)
    expect(next).toMatchObject({ exerciseId: "wall-walk-hold", sets: 3, durationSeconds: 20, restSeconds: 60, replacedFromExerciseId: "box-pike-hold" })

    const tue = day(4, TUE)
    const raise = must(tue, "hanging-knee-raise")
    const leg = replaceProgramExercise(tue, raise.slotId, makeInput(profile, tue.date), {})?.exercises.find((e) => e.slotId === raise.slotId)
    expect(leg).toMatchObject({ exerciseId: "hanging-leg-raise", sets: 2, reps: [6, 10] })
  })

  it("a sprint without a lane swaps to the sled push at the plan's sled dose", () => {
    for (const [week, sets] of [[1, 6], [4, 6], [7, 3]] as const) {
      const tue = day(week, TUE)
      const sprint = must(tue, "acceleration-sprint")
      const swapped = replaceProgramExercise(tue, sprint.slotId, makeInput(profile, tue.date), {})
      const sled = swapped?.exercises.find((e) => e.slotId === sprint.slotId)
      expect(sled, `week ${week}`).toMatchObject({ exerciseId: "sled-push", sets, reps: null, durationSeconds: 15, restSeconds: 120 })
      expect(sled?.note).toMatch(/^No lane: sled push 5–6 × 15 m/)
    }
  })

  it("keeps the plan's fallbacks reachable and never carries step text onto a substitute", () => {
    const tue = day(4, TUE)
    const raise = must(tue, "hanging-knee-raise")
    expect(raise.note).toMatch(/captain's chair leg raise or the ab-wheel rollout/)
    const options = programSwapOptions(tue, raise.slotId)
    expect(options.slice(0, 3)).toEqual(["hanging-leg-raise", "captains-chair-leg-raise", "ab-wheel-rollout"])
    const wheel = replaceProgramExercise(tue, raise.slotId, makeInput(profile, tue.date), { withExerciseId: "ab-wheel-rollout" })?.exercises.find((e) => e.slotId === raise.slotId)
    expect(wheel).toMatchObject({ exerciseId: "ab-wheel-rollout", sets: 2, reps: [8, 10], note: null })
  })

  it("lists the program's own options first in the picker", () => {
    const mon = day(4, MON)
    const pull = must(mon, "pull-up")
    const candidates = programReplacementCandidates(mon, pull.slotId, makeInput(profile, mon.date))
    expect(candidates[0]).toMatchObject({ exerciseId: "assisted-pull-up", reason: "A step in your program" })
  })

  it("keeps program-only steps out of generated workouts", () => {
    for (let d = 0; d < 14; d++) {
      const workout = generateWorkout(makeInput(profile, addDays(START, d)))
      for (const e of workout.exercises) expect(getExercise(e.exerciseId)?.tags ?? [], e.exerciseId).not.toContain("program_only")
    }
  })
})

describe("assignment helpers", () => {
  it("parses only known programs and real dates", () => {
    expect(parseAssignment({ programId: RETURNING_LIFTER_CALISTHENICS_ID, startDate: START })).toEqual(assignment)
    expect(parseAssignment({ programId: "nope", startDate: START })).toBeNull()
    expect(parseAssignment({ programId: RETURNING_LIFTER_CALISTHENICS_ID, startDate: "2026-02-30" })).toBeNull()
    expect(parseAssignment("x")).toBeNull()
    expect(getProgram(RETURNING_LIFTER_CALISTHENICS_ID)).toBe(program)
  })

  it("keys a plan by program and start date, so a changed assignment replaces an unstarted plan", () => {
    const mon = day(1, MON)
    expect(workoutPlanKey(mon)).toBe(programPlanKey(assignment, mon.date))
    expect(programPlanKey(null, mon.date)).toBeNull()
    expect(programPlanKey(assignment, addDays(START, -1))).toBeNull()
    expect(programPlanKey({ ...assignment, startDate: addDays(START, 7) }, mon.date)).toBeNull()
  })

  it("keys a plan by the program's revision, so a revised program replaces an unstarted plan", () => {
    const mon = day(3, MON)
    expect(mon.program?.revision).toBe(program.revision)
    const before = { ...mon, program: mon.program ? { ...mon.program, revision: undefined } : undefined }
    expect(workoutPlanKey(before)).not.toBe(programPlanKey(assignment, mon.date))
  })
})
