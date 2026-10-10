import { describe, expect, it } from "vitest"

import { SYNC_BATCH_SIZE } from "@/lib/sync/sync-store"

import { workoutInputToColumns } from "./mappers"
import {
  completedWorkoutSchema,
  putMeSchema,
  SYNC_MAX_PUSH_BATCH,
  syncRequestSchema,
} from "./validation"

function rawWorkout(): Record<string, unknown> {
  return {
    id: "w1",
    date: "2026-10-01",
    title: "Push",
    split: "push",
    focus: ["chest"],
    goal: "muscle_gain",
    startedAt: "2026-10-01T09:00:00.000Z",
    completedAt: "2026-10-01T10:00:00.000Z",
    durationSeconds: 3600,
    engineVersion: 1,
    totals: {
      exercisesCompleted: 1,
      exercisesSkipped: 0,
      sets: 1,
      reps: 10,
      volumeKg: 800,
      caloriesEstimate: null,
    },
    personalRecords: [
      {
        exerciseId: "barbell-bench-press",
        kind: "weight",
        value: 80,
        achievedAt: "2026-10-01T10:00:00.000Z",
      },
    ],
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
        sets: [{ setNumber: 1, weightKg: 80, reps: 10, completed: true }],
      },
    ],
  }
}

type Patch = (w: Record<string, unknown>) => void

function withPatch(patch: Patch): Record<string, unknown> {
  const w = rawWorkout()
  patch(w)
  return w
}

function exercise0(w: Record<string, unknown>): Record<string, unknown> {
  return (w.exercises as Record<string, unknown>[])[0]!
}

function set0(w: Record<string, unknown>): Record<string, unknown> {
  return (exercise0(w).sets as Record<string, unknown>[])[0]!
}

describe("completedWorkoutSchema: JSON columns keep only known keys", () => {
  it("strips unknown keys from sets, exercises, totals and personal records", () => {
    const raw = withPatch((w) => {
      set0(w).pad = "x".repeat(10_000)
      exercise0(w).junk = { nested: true }
      ;(w.totals as Record<string, unknown>).junk = 1
      ;(w.personalRecords as Record<string, unknown>[])[0]!.junk = "y"
    })
    const parsed = completedWorkoutSchema.parse(raw)
    const columns = workoutInputToColumns("u1", parsed)

    const stored = JSON.stringify([
      columns.exercises,
      columns.totals,
      columns.personalRecords,
    ])
    expect(stored).not.toContain("pad")
    expect(stored).not.toContain("junk")
    expect(columns.exercises).toEqual(rawWorkout().exercises)
    expect(columns.totals).toEqual(rawWorkout().totals)
  })

  it("keeps the optional fields the client does send", () => {
    const raw = withPatch((w) => {
      Object.assign(set0(w), { durationSeconds: null, rpe: 8 })
    })
    const parsed = completedWorkoutSchema.parse(raw)
    expect(parsed.exercises[0]!.sets[0]).toEqual({
      setNumber: 1,
      weightKg: 80,
      reps: 10,
      durationSeconds: null,
      rpe: 8,
      completed: true,
    })
  })
})

describe("completedWorkoutSchema: integers stay inside Postgres INTEGER", () => {
  const cases: [string, Patch][] = [
    ["setNumber", (w) => (set0(w).setNumber = 3_000_000_000)],
    ["reps", (w) => (set0(w).reps = 3_000_000_000)],
    ["set durationSeconds", (w) => (set0(w).durationSeconds = 3_000_000_000)],
    ["workout durationSeconds", (w) => (w.durationSeconds = 3_000_000_000)],
    ["engineVersion", (w) => (w.engineVersion = 9_999_999_999)],
    ["weightKg", (w) => (set0(w).weightKg = 1e12)],
  ]
  for (const [field, patch] of cases) {
    it(`rejects an out-of-range ${field}`, () => {
      expect(completedWorkoutSchema.safeParse(withPatch(patch)).success).toBe(
        false
      )
    })
  }

  it("accepts assisted (negative) weights and realistic maxima", () => {
    const raw = withPatch((w) => {
      Object.assign(set0(w), {
        weightKg: -40,
        reps: 100,
        durationSeconds: 3600,
      })
      w.durationSeconds = 3 * 24 * 60 * 60
    })
    expect(completedWorkoutSchema.safeParse(raw).success).toBe(true)
  })
})

describe("syncRequestSchema", () => {
  it("allows the client's batch size and refuses oversized batches", () => {
    expect(SYNC_MAX_PUSH_BATCH).toBeGreaterThanOrEqual(SYNC_BATCH_SIZE)
    const batch = (n: number) => ({
      workouts: Array.from({ length: n }, () => ({})),
    })
    expect(
      syncRequestSchema.safeParse(batch(SYNC_MAX_PUSH_BATCH)).success
    ).toBe(true)
    expect(
      syncRequestSchema.safeParse(batch(SYNC_MAX_PUSH_BATCH + 1)).success
    ).toBe(false)
  })
})

describe("putMeSchema", () => {
  it("accepts a far-future updatedAt (the server clamps it, see profile.ts)", () => {
    const profile = {
      goal: "strength",
      gender: "unspecified",
      weightKg: 80,
      experience: "beginner",
      trainingDaysPerWeek: 3,
      equipmentPreset: "dumbbells",
      equipment: ["dumbbell"],
      durationPreferenceMinutes: 45,
      units: "kg",
      limitations: [],
      excludedExerciseIds: [],
      preferredExerciseIds: [],
      updatedAt: "9999-12-31T23:59:59.999Z",
    }
    expect(putMeSchema.safeParse(profile).success).toBe(true)
  })
})
