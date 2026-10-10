import { describe, expect, it } from "vitest"

import type { CompletedWorkout } from "@/lib/domain/types"
import { addDays } from "@/lib/dates"

import { goalMetricFor, goalTrend } from "./aggregate"

const TODAY = "2026-10-08"

function workout(
  daysAgo: number,
  opts: { sets?: number; minutes?: number; kg?: number; reps?: number } = {}
): CompletedWorkout {
  const date = addDays(TODAY, -daysAgo)
  return {
    id: `w${daysAgo}`,
    date,
    title: "Full body",
    split: "full_body",
    focus: ["full_body"],
    goal: "strength",
    startedAt: `${date}T09:00:00.000Z`,
    completedAt: `${date}T10:00:00.000Z`,
    durationSeconds: (opts.minutes ?? 60) * 60,
    exercises: [
      {
        slotId: "s1",
        exerciseId: "barbell-back-squat",
        role: "primary_compound",
        phase: "main",
        status: "completed",
        sets: [
          {
            setNumber: 1,
            weightKg: opts.kg ?? 100,
            reps: opts.reps ?? 5,
            completed: true,
          },
        ],
        prescribedSets: 3,
        prescribedReps: [3, 6],
        prescribedDurationSeconds: null,
        recommendedWeightKg: null,
      },
    ],
    totals: {
      exercisesCompleted: 1,
      exercisesSkipped: 0,
      sets: opts.sets ?? 10,
      reps: 50,
      volumeKg: 1000,
      caloriesEstimate: null,
    },
    personalRecords: [],
    engineVersion: 1,
    synced: false,
  }
}

describe("goalMetricFor", () => {
  it("maps each goal to the measure that shows progress toward it", () => {
    expect(goalMetricFor("strength")).toBe("e1rm")
    expect(goalMetricFor("muscle_gain")).toBe("sets")
    expect(goalMetricFor("fat_loss")).toBe("minutes")
    expect(goalMetricFor("endurance")).toBe("minutes")
  })
})

describe("goalTrend", () => {
  it("averages weekly sets over the last four weeks against the four before", () => {
    const trend = goalTrend(
      [
        workout(1, { sets: 20 }),
        workout(10, { sets: 8 }),
        workout(40, { sets: 12 }),
      ],
      "muscle_gain",
      TODAY
    )
    expect(trend.recent).toBe(7)
    expect(trend.previous).toBe(3)
  })

  it("reports no previous window when nothing was logged in it", () => {
    expect(
      goalTrend([workout(2, { minutes: 40 })], "fat_loss", TODAY).previous
    ).toBeNull()
  })

  it("compares best estimated 1RM per lift across the two windows", () => {
    const trend = goalTrend(
      [workout(3, { kg: 110, reps: 5 }), workout(35, { kg: 100, reps: 5 })],
      "strength",
      TODAY
    )
    expect(trend.lifts).toBe(1)
    // Epley e1RM scales with the load, so +10% load is close to +10% e1RM.
    expect(trend.changePct).toBeCloseTo(10, 0)
  })
})
