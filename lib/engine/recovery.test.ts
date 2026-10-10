import { describe, expect, it } from "vitest"
import type { CompletedWorkout } from "@/lib/domain/types"
import {
  cappedGroupsOf,
  computeRecovery,
  CORE_WEEKLY_SETS,
  coreExposure,
  coreWeeklyCap,
  freshnessScore,
  heavyGroupsOfWorkout,
  isFresh,
  recentSplits,
  trainingFrequency,
  weeklyCap,
  weeklySoftCeiling,
} from "./recovery"
import { DEFAULT_LIBRARY, libraryFrom } from "./library"
import { FIXTURE_LIBRARY, makeExercise } from "./test-fixtures"

const lib = libraryFrom(FIXTURE_LIBRARY)

function workout(date: string, entries: { id: string; role: CompletedWorkout["exercises"][number]["role"]; sets: number }[]): CompletedWorkout {
  return {
    id: `w-${date}`,
    date,
    title: "Push",
    split: "push",
    focus: ["chest"],
    goal: "muscle_gain",
    startedAt: `${date}T07:00:00.000Z`,
    completedAt: `${date}T08:00:00.000Z`,
    durationSeconds: 3600,
    exercises: entries.map((e, i) => ({
      slotId: `s${i}`,
      exerciseId: e.id,
      role: e.role,
      phase: "main",
      status: "completed",
      sets: Array.from({ length: e.sets }, (_, n) => ({ setNumber: n + 1, weightKg: 50, reps: 10, completed: true })),
      prescribedSets: e.sets,
      prescribedReps: [8, 12],
      prescribedDurationSeconds: null,
      recommendedWeightKg: null,
    })),
    totals: { exercisesCompleted: entries.length, exercisesSkipped: 0, sets: 0, reps: 0, volumeKg: 0, caloriesEstimate: null },
    personalRecords: [],
    engineVersion: 1,
    synced: true,
  }
}

describe("recovery", () => {
  it("empty history means everything is fresh", () => {
    const rec = computeRecovery([], "2026-10-07", lib)
    expect(rec.chest.daysSinceHeavy).toBeNull()
    expect(rec.chest.setsLast7).toBe(0)
    expect(isFresh(rec, "chest")).toBe(true)
    expect(freshnessScore(rec, ["chest", "back"])).toBe(Number.POSITIVE_INFINITY)
  })

  it("tracks last heavy session per group and sets in the last 7 days", () => {
    const history = [
      workout("2026-10-06", [
        { id: "barbell-bench-press", role: "primary_compound", sets: 4 },
        { id: "dumbbell-lateral-raise", role: "isolation", sets: 3 },
      ]),
      workout("2026-09-29", [{ id: "barbell-bench-press", role: "primary_compound", sets: 4 }]),
      workout("2026-10-02", [{ id: "dumbbell-curl", role: "isolation", sets: 3 }]),
    ]
    const rec = computeRecovery(history, "2026-10-07", lib)
    expect(rec.chest.lastHeavyDate).toBe("2026-10-06")
    expect(rec.chest.daysSinceHeavy).toBe(1)
    expect(isFresh(rec, "chest")).toBe(false)
    expect(rec.chest.setsLast7).toBe(4) // the 09-29 session is 8 days old
    expect(rec.triceps.setsLast7).toBe(0) // secondary muscles do not count towards caps
    expect(rec.triceps.daysSinceTrained).toBe(1) // but they do count as trained
    expect(rec.shoulders.daysSinceHeavy).toBeNull()
    expect(rec.shoulders.setsLast7).toBe(3)
    expect(rec.biceps.daysSinceHeavy).toBeNull()
    expect(rec.biceps.daysSinceTrained).toBe(5)
    expect(heavyGroupsOfWorkout(history[0]!, lib)).toEqual(["chest"])
  })

  it("six or more sets on a group counts as heavy even without a compound role", () => {
    const history = [workout("2026-10-05", [{ id: "dumbbell-curl", role: "isolation", sets: 6 }])]
    const rec = computeRecovery(history, "2026-10-07", lib)
    expect(rec.biceps.daysSinceHeavy).toBe(2)
    expect(isFresh(rec, "biceps")).toBe(true)
  })

  it("ignores future workouts and unknown exercise ids", () => {
    const history = [workout("2026-10-08", [{ id: "barbell-bench-press", role: "primary_compound", sets: 4 }]), workout("2026-10-06", [{ id: "nope", role: "primary_compound", sets: 4 }])]
    const rec = computeRecovery(history, "2026-10-07", lib)
    expect(rec.chest.daysSinceHeavy).toBeNull()
  })

  it("this week's budget counts only the plan's other sessions, the raw 7-day count everything (F06)", () => {
    // A 3-day plan trained every other day: sessions 6, 4 and 2 days ago are all inside 7 days,
    // but the week the cap is about is the last two of them plus today.
    const history = [
      workout("2026-10-05", [{ id: "barbell-bench-press", role: "primary_compound", sets: 3 }]),
      workout("2026-10-03", [{ id: "barbell-bench-press", role: "primary_compound", sets: 3 }]),
      workout("2026-10-01", [{ id: "barbell-bench-press", role: "primary_compound", sets: 4 }]),
    ]
    const rec = computeRecovery(history, "2026-10-07", lib, 2)
    expect(rec.chest.setsLast7).toBe(10)
    expect(rec.chest.setsBudget).toBe(6)
    // Without a session count every session in the window counts, as before.
    expect(computeRecovery(history, "2026-10-07", lib).chest.setsBudget).toBe(10)
    // A workout with nothing completed is not a session and does not use up the window.
    const skipped = workout("2026-10-06", [{ id: "barbell-bench-press", role: "primary_compound", sets: 0 }])
    expect(computeRecovery([skipped, ...history], "2026-10-07", lib, 2).chest.setsBudget).toBe(6)
    expect(weeklySoftCeiling("beginner")).toBe(13)
    expect(weeklySoftCeiling("advanced")).toBeGreaterThan(weeklyCap("advanced"))
  })

  it("core-category work whose primary muscle maps elsewhere also counts against the trunk (F13)", () => {
    const copenhagen = makeExercise({ id: "copenhagen-plank", category: "core", primary: "adductors", pattern: "anti_lateral_flexion", mechanics: "isolation", equipment: ["bench"], loadType: "timed", duration: [15, 30] })
    expect(cappedGroupsOf(copenhagen, "glutes")).toEqual(["glutes", "core"])
    expect(cappedGroupsOf(FIXTURE_LIBRARY.find((e) => e.id === "plank")!, "core")).toEqual(["core"])
    const withCopenhagen = libraryFrom([...FIXTURE_LIBRARY, copenhagen])
    const rec = computeRecovery([workout("2026-10-06", [{ id: "copenhagen-plank", role: "accessory", sets: 3 }])], "2026-10-07", withCopenhagen)
    expect(rec.glutes.setsLast7).toBe(3)
    expect(rec.core.setsLast7).toBe(3)
  })

  it("trainingFrequency counts sessions in the last 7 days and the run of consecutive days (F17)", () => {
    const session = (date: string) => workout(date, [{ id: "dumbbell-curl", role: "isolation", sets: 3 }])
    const daily = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"].map(session)
    expect(trainingFrequency(daily, "2026-10-07")).toEqual({ sessionsLast7: 6, streak: 6 })
    // A day off breaks the streak; sessions older than 7 days do not count.
    const gap = [session("2026-10-06"), session("2026-10-05"), session("2026-10-03"), session("2026-09-29")]
    expect(trainingFrequency(gap, "2026-10-07")).toEqual({ sessionsLast7: 3, streak: 2 })
    // A session already done today is part of the run; an empty workout is not a session.
    expect(trainingFrequency([session("2026-10-07"), session("2026-10-06")], "2026-10-07")).toEqual({ sessionsLast7: 2, streak: 2 })
    expect(trainingFrequency([workout("2026-10-06", [])], "2026-10-07")).toEqual({ sessionsLast7: 0, streak: 0 })
  })

  it("recentSplits and caps", () => {
    const history = [workout("2026-10-01", []), workout("2026-10-06", []), workout("2026-09-20", [])]
    expect(recentSplits(history, "2026-10-07").map((s) => s.date)).toEqual(["2026-10-06", "2026-10-01"])
    expect(weeklyCap("beginner")).toBe(10)
    expect(weeklyCap("intermediate")).toBe(14)
    expect(weeklyCap("advanced")).toBe(18)
  })
})

describe("trunk exposure and the core cap (core spec C02, C04)", () => {
  const squatWithAbs = makeExercise({ id: "abs-squat", category: "legs", primary: "quads", secondary: ["abs", "obliques", "lower_back"], pattern: "squat", equipment: ["barbell"], loadType: "external", reps: [5, 8] })
  const real = libraryFrom([...DEFAULT_LIBRARY.all, squatWithAbs])

  it("coreExposure counts a Pallof press session and ignores a mountain-climber finisher and a squat with the abs as a secondary muscle", () => {
    const history = [
      workout("2026-10-06", [{ id: "abs-squat", role: "primary_compound", sets: 4 }, { id: "mountain-climber", role: "finisher", sets: 4 }]),
      workout("2026-10-04", [{ id: "abs-squat", role: "primary_compound", sets: 4 }, { id: "pallof-press", role: "accessory", sets: 3 }]),
      workout("2026-10-02", [{ id: "abs-squat", role: "primary_compound", sets: 4 }]),
    ]
    const exposure = coreExposure(history, "2026-10-07", real)
    expect(exposure.sessionsLast7).toBe(1)
    expect(exposure.sessionsInWindow).toBe(3)
    expect(exposure.daysSinceCore).toBe(3)
    expect([...exposure.familiesLast7]).toEqual(["anti_rotation"])
    expect(exposure.lastFamily).toBe("anti_rotation")
    expect(exposure.flexionLast7).toBe(0)
    // A mountain climber in a main slot is conditioning too (C13), never trunk work.
    const climber = coreExposure([workout("2026-10-06", [{ id: "mountain-climber", role: "accessory", sets: 3 }])], "2026-10-07", real)
    expect(climber.sessionsLast7).toBe(0)
    expect(climber.daysSinceCore).toBeNull()
  })

  it("counts flexion sessions, the latest family, designated days and the window", () => {
    const history = [
      workout("2026-10-06", [{ id: "cable-crunch", role: "accessory", sets: 2 }]),
      workout("2026-10-05", [{ id: "dead-bug", role: "accessory", sets: 2 }, { id: "cable-woodchop", role: "accessory", sets: 2 }]),
      // Outside the 7-day window: families and counts ignore it.
      workout("2026-09-29", [{ id: "side-plank", role: "accessory", sets: 2 }]),
    ]
    const designated = (w: CompletedWorkout) => w.date === "2026-10-05"
    const exposure = coreExposure(history, "2026-10-07", real, designated)
    expect(exposure.sessionsLast7).toBe(2)
    expect(exposure.flexionLast7).toBe(2)
    expect([...exposure.familiesLast7].sort()).toEqual(["anti_extension", "flexion_rotation"])
    expect(exposure.lastFamily).toBe("flexion_rotation")
    expect(exposure.daysSinceCore).toBe(1)
    expect(exposure.extraLast7).toBe(1)
    expect(coreExposure(history, "2026-10-07", real).extraLast7).toBe(2)
  })

  it("coreWeeklyCap returns the goal and experience table", () => {
    expect(CORE_WEEKLY_SETS).toEqual({
      strength: { beginner: [4, 6], intermediate: [4, 8], advanced: [6, 10] },
      muscle_gain: { beginner: [4, 6], intermediate: [6, 10], advanced: [8, 12] },
      fat_loss: { beginner: [4, 8], intermediate: [6, 10], advanced: [6, 10] },
      general_fitness: { beginner: [4, 8], intermediate: [6, 10], advanced: [6, 10] },
      endurance: { beginner: [4, 8], intermediate: [6, 10], advanced: [8, 12] },
    })
    expect(coreWeeklyCap("muscle_gain", "advanced")).toBe(12)
    expect(coreWeeklyCap("strength", "beginner")).toBe(6)
    expect(coreWeeklyCap("fat_loss", "intermediate")).toBe(10)
  })
})
