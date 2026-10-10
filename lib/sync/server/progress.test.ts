import { describe, expect, it } from "vitest"

import { isLoggableSet, performanceRowsFromWorkout } from "./mappers"
import {
  computeProgressStats,
  epleyE1rm,
  groupRecentSessions,
  type SessionSetRow,
} from "./stats"
import type { CompletedWorkoutInput } from "./validation"

const t1 = new Date("2026-10-01T10:00:00.000Z")
const t2 = new Date("2026-10-03T10:00:00.000Z")

describe("computeProgressStats", () => {
  it("returns null for no rows", () => {
    expect(computeProgressStats([])).toBeNull()
  })

  it("aggregates bests, distinct workouts and last performed", () => {
    const stats = computeProgressStats([
      { workoutId: "w1", weightKg: 80, reps: 8, completedAt: t1 },
      { workoutId: "w1", weightKg: 80, reps: 6, completedAt: t1 },
      { workoutId: "w2", weightKg: 60, reps: 12, completedAt: t2 },
      { workoutId: "w2", weightKg: null, reps: 15, completedAt: t2 },
    ])
    expect(stats).toEqual({
      bestWeightKg: 80,
      bestReps: 15,
      bestVolumeKg: 720,
      bestE1rmKg: Math.round(epleyE1rm(80, 8) * 100) / 100,
      timesPerformed: 2,
      lastPerformedAt: t2,
    })
  })

  it("ignores assistance (negative) weight for weight-based bests", () => {
    const stats = computeProgressStats([
      { workoutId: "w1", weightKg: -20, reps: 10, completedAt: t1 },
    ])
    expect(stats?.bestWeightKg).toBeNull()
    expect(stats?.bestVolumeKg).toBeNull()
    expect(stats?.bestE1rmKg).toBeNull()
    expect(stats?.bestReps).toBe(10)
    expect(stats?.timesPerformed).toBe(1)
  })
})

describe("isLoggableSet / performanceRowsFromWorkout", () => {
  it("keeps completed sets with reps or duration only", () => {
    expect(
      isLoggableSet({ setNumber: 1, weightKg: 50, reps: 10, completed: true })
    ).toBe(true)
    expect(
      isLoggableSet({
        setNumber: 1,
        weightKg: null,
        reps: null,
        durationSeconds: 45,
        completed: true,
      })
    ).toBe(true)
    expect(
      isLoggableSet({ setNumber: 1, weightKg: 50, reps: 10, completed: false })
    ).toBe(false)
    expect(
      isLoggableSet({ setNumber: 1, weightKg: 50, reps: 0, completed: true })
    ).toBe(false)
    expect(
      isLoggableSet({
        setNumber: 1,
        weightKg: null,
        reps: null,
        completed: true,
      })
    ).toBe(false)
  })

  it("flattens a workout into one row per loggable set", () => {
    const workout: CompletedWorkoutInput = {
      id: "w1",
      date: "2026-10-01",
      title: "Push",
      split: "push",
      focus: ["chest"],
      goal: "muscle_gain",
      startedAt: "2026-10-01T09:00:00.000Z",
      completedAt: t1.toISOString(),
      durationSeconds: 3600,
      engineVersion: 1,
      totals: {
        exercisesCompleted: 1,
        exercisesSkipped: 0,
        sets: 2,
        reps: 18,
        volumeKg: 1440,
        caloriesEstimate: null,
      },
      personalRecords: [],
      exercises: [
        {
          slotId: "s1",
          exerciseId: "barbell-bench-press",
          role: "primary_compound",
          phase: "main",
          status: "completed",
          prescribedSets: 3,
          prescribedReps: [6, 10],
          prescribedDurationSeconds: null,
          recommendedWeightKg: 80,
          sets: [
            { setNumber: 1, weightKg: 80, reps: 10, completed: true },
            { setNumber: 2, weightKg: 80, reps: 8, rpe: 8.5, completed: true },
            { setNumber: 3, weightKg: 80, reps: null, completed: false },
          ],
        },
      ],
    }
    const rows = performanceRowsFromWorkout("u1", workout)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual({
      userId: "u1",
      workoutId: "w1",
      exerciseId: "barbell-bench-press",
      setNumber: 2,
      weightKg: 80,
      reps: 8,
      durationSeconds: null,
      rpe: 8.5,
      completedAt: t1,
    })
  })
})

describe("groupRecentSessions", () => {
  it("groups ordered rows into sessions per exercise and caps the session count", () => {
    const row = (
      workoutId: string,
      setNumber: number,
      exerciseId = "squat"
    ): SessionSetRow => ({
      exerciseId,
      workoutId,
      date: "2026-10-01",
      setNumber,
      weightKg: 100,
      reps: 5,
      durationSeconds: null,
      rpe: null,
    })
    const rows = [
      row("w3", 1),
      row("w3", 2),
      row("w2", 1),
      row("w1", 1),
      row("w9", 1, "deadlift"),
    ]
    const grouped = groupRecentSessions(rows, 2)
    expect(grouped.get("squat")?.map((s) => s.workoutId)).toEqual(["w3", "w2"])
    expect(grouped.get("squat")?.[0].sets).toHaveLength(2)
    expect(grouped.get("squat")?.[0].sets[0].completed).toBe(true)
    expect(grouped.get("deadlift")?.map((s) => s.workoutId)).toEqual(["w9"])
  })
})
