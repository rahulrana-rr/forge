import { describe, expect, it } from "vitest"
import type {
  CompletedExercise,
  CompletedWorkout,
  ExerciseProgress,
  SetLog,
} from "./types"
import {
  applyWorkoutToProgress,
  computeStreak,
  computeTotals,
  detectPersonalRecords,
  epley1rm,
  estimateCalories,
  rebuildProgress,
  STREAK_MAX_GAP_DAYS,
  streakMaxGapDays,
  weeklyVolume,
  weekStartKey,
} from "./progress"

function set(
  weightKg: number | null,
  reps: number | null,
  completed = true
): SetLog {
  return { setNumber: 1, weightKg, reps, completed }
}

function exercise(
  exerciseId: string,
  sets: SetLog[],
  status: CompletedExercise["status"] = "completed"
): CompletedExercise {
  return {
    slotId: `slot-${exerciseId}`,
    exerciseId,
    role: "primary_compound",
    phase: "main",
    status,
    sets,
    prescribedSets: sets.length,
    prescribedReps: [8, 12],
    prescribedDurationSeconds: null,
    recommendedWeightKg: null,
  }
}

function workout(
  id: string,
  date: string,
  exercises: CompletedExercise[],
  completedAt = `${date}T10:00:00.000Z`
): CompletedWorkout {
  return {
    id,
    date,
    title: "Push",
    split: "push",
    focus: ["chest"],
    goal: "muscle_gain",
    startedAt: `${date}T09:00:00.000Z`,
    completedAt,
    durationSeconds: 3600,
    exercises,
    totals: computeTotals(exercises),
    personalRecords: [],
    engineVersion: 1,
    synced: false,
  }
}

describe("epley1rm", () => {
  it("returns the weight for a single rep", () => {
    expect(epley1rm(100, 1)).toBe(100)
  })
  it("applies w * (1 + reps/30)", () => {
    expect(epley1rm(100, 10)).toBeCloseTo(133.3, 1)
  })
  it("is zero for invalid input", () => {
    expect(epley1rm(0, 5)).toBe(0)
    expect(epley1rm(50, 0)).toBe(0)
  })
})

describe("computeTotals", () => {
  it("sums completed sets, reps and loaded volume only", () => {
    const totals = computeTotals([
      exercise("bench", [set(60, 10), set(60, 8), set(60, 8, false)]),
      exercise("plank", [
        {
          setNumber: 1,
          weightKg: null,
          reps: null,
          durationSeconds: 60,
          completed: true,
        },
      ]),
      exercise("skipped", [], "skipped"),
    ])
    expect(totals.exercisesCompleted).toBe(2)
    expect(totals.exercisesSkipped).toBe(1)
    expect(totals.sets).toBe(3)
    expect(totals.reps).toBe(18)
    expect(totals.volumeKg).toBe(1080)
    expect(totals.caloriesEstimate).toBeNull()
  })
  it("estimates calories only when weight and duration are known", () => {
    expect(estimateCalories(80, 3600)).toBe(480)
    expect(estimateCalories(null, 3600)).toBeNull()
    expect(
      computeTotals([], { weightKg: 80, durationSeconds: 1800 })
        .caloriesEstimate
    ).toBe(240)
  })
  it("ignores assisted (negative) weight for volume", () => {
    expect(computeTotals([exercise("pullup", [set(-20, 8)])]).volumeKg).toBe(0)
  })
})

describe("progress + personal records", () => {
  const first = workout("w1", "2026-10-01", [
    exercise("bench", [set(60, 10), set(60, 8)]),
  ])

  it("seeds a baseline on the first session and never flags PRs for it", () => {
    expect(
      detectPersonalRecords(first.exercises, {}, first.completedAt)
    ).toEqual([])
    const progress = applyWorkoutToProgress({}, first)
    const bench = progress.bench
    expect(bench.timesPerformed).toBe(1)
    expect(bench.bestWeightKg).toBe(60)
    expect(bench.bestReps).toBe(10)
    expect(bench.bestVolumeKg).toBe(600)
    expect(bench.bestE1rmKg).toBe(80)
    expect(bench.lastPerformedAt).toBe(first.completedAt)
    expect(bench.recentSessions).toHaveLength(1)
  })

  it("flags weight, e1rm and volume records against the previous progress", () => {
    const progress = applyWorkoutToProgress({}, first)
    const second = workout("w2", "2026-10-03", [
      exercise("bench", [set(65, 10)]),
    ])
    const prs = detectPersonalRecords(
      second.exercises,
      progress,
      second.completedAt
    )
    expect(prs.map((p) => p.kind).sort()).toEqual(["e1rm", "volume", "weight"])
    const weight = prs.find((p) => p.kind === "weight")
    expect(weight?.value).toBe(65)
    expect(weight?.previousValue).toBe(60)
    expect(weight?.achievedAt).toBe(second.completedAt)
  })

  it("flags reps_at_weight when more reps are done at the standing best weight", () => {
    const progress = applyWorkoutToProgress({}, first)
    const second = workout("w2", "2026-10-03", [
      exercise("bench", [set(60, 12)]),
    ])
    const prs = detectPersonalRecords(
      second.exercises,
      progress,
      second.completedAt
    )
    const reps = prs.find((p) => p.kind === "reps_at_weight")
    expect(reps?.value).toBe(12)
    expect(reps?.previousValue).toBe(10)
    expect(prs.some((p) => p.kind === "weight")).toBe(false)
  })

  it("does not flag anything when the session matches or falls short", () => {
    const progress = applyWorkoutToProgress({}, first)
    const second = workout("w2", "2026-10-03", [
      exercise("bench", [set(60, 10), set(55, 8)]),
    ])
    expect(
      detectPersonalRecords(second.exercises, progress, second.completedAt)
    ).toEqual([])
  })

  it("ignores timed and bodyweight-only sets", () => {
    const base: Record<string, ExerciseProgress> = {
      plank: {
        exerciseId: "plank",
        bestWeightKg: null,
        bestReps: null,
        bestVolumeKg: null,
        bestE1rmKg: null,
        timesPerformed: 3,
        lastPerformedAt: "2026-10-01T10:00:00.000Z",
        recentSessions: [],
        updatedAt: "2026-10-01T10:00:00.000Z",
      },
    }
    const ex = exercise("plank", [
      {
        setNumber: 1,
        weightKg: null,
        reps: null,
        durationSeconds: 90,
        completed: true,
      },
    ])
    expect(
      detectPersonalRecords([ex], base, "2026-10-03T10:00:00.000Z")
    ).toEqual([])
  })

  it("caps recentSessions at 5 newest first and rebuilds deterministically", () => {
    const workouts: CompletedWorkout[] = []
    for (let i = 1; i <= 7; i++) {
      const day = String(i).padStart(2, "0")
      workouts.push(
        workout(`w${i}`, `2026-10-${day}`, [
          exercise("bench", [set(50 + i, 8)]),
        ])
      )
    }
    const built = rebuildProgress([...workouts].reverse())
    expect(built.bench.timesPerformed).toBe(7)
    expect(built.bench.bestWeightKg).toBe(57)
    expect(built.bench.recentSessions.map((s) => s.workoutId)).toEqual([
      "w7",
      "w6",
      "w5",
      "w4",
      "w3",
    ])
    const incremental = workouts.reduce(
      (acc, w) => applyWorkoutToProgress(acc, w),
      {} as Record<string, ExerciseProgress>
    )
    expect(incremental).toEqual(built)
  })

  it("compares reps_at_weight against the all-time best at that weight, not only recent sessions", () => {
    // 100 kg x 8 long ago, then five sessions of 100 kg x 5 push it out of recentSessions.
    const history = [
      workout("w0", "2026-09-01", [exercise("squat", [set(100, 8)])]),
      ...[2, 3, 4, 5, 6].map((d) =>
        workout(`w${d}`, `2026-09-0${d}`, [exercise("squat", [set(100, 5)])])
      ),
    ]
    const progress = rebuildProgress(history)
    expect(progress.squat.recentSessions.map((s) => s.workoutId)).not.toContain(
      "w0"
    )
    expect(progress.squat.repsAtBestWeight).toBe(8)

    const six = [exercise("squat", [set(100, 6)])]
    expect(
      detectPersonalRecords(six, progress, "2026-09-10T10:00:00.000Z")
    ).toEqual([])

    const nine = [exercise("squat", [set(100, 9)])]
    const prs = detectPersonalRecords(
      nine,
      progress,
      "2026-09-10T10:00:00.000Z"
    )
    expect(prs.find((p) => p.kind === "reps_at_weight")).toMatchObject({
      value: 9,
      previousValue: 8,
      weightKg: 100,
    })
  })

  it("tracks reps at the best weight: a heavier best starts over, an equal one keeps the max", () => {
    let progress = applyWorkoutToProgress(
      {},
      workout("a", "2026-10-01", [exercise("bench", [set(60, 10)])])
    )
    expect(progress.bench.repsAtBestWeight).toBe(10)
    progress = applyWorkoutToProgress(
      progress,
      workout("b", "2026-10-02", [exercise("bench", [set(60, 7), set(55, 12)])])
    )
    expect(progress.bench.repsAtBestWeight).toBe(10)
    progress = applyWorkoutToProgress(
      progress,
      workout("c", "2026-10-03", [exercise("bench", [set(62.5, 4)])])
    )
    expect(progress.bench.bestWeightKg).toBe(62.5)
    expect(progress.bench.repsAtBestWeight).toBe(4)
  })

  it("falls back to recent sessions for progress stored before repsAtBestWeight existed", () => {
    const legacy: Record<string, ExerciseProgress> = {
      bench: {
        exerciseId: "bench",
        bestWeightKg: 60,
        bestReps: 10,
        bestVolumeKg: 600,
        bestE1rmKg: 80,
        timesPerformed: 1,
        lastPerformedAt: "2026-10-01T10:00:00.000Z",
        recentSessions: [
          { workoutId: "w1", date: "2026-10-01", sets: [set(60, 10)] },
        ],
        updatedAt: "2026-10-01T10:00:00.000Z",
      },
    }
    const prs = detectPersonalRecords(
      [exercise("bench", [set(60, 11)])],
      legacy,
      "2026-10-03T10:00:00.000Z"
    )
    expect(prs.find((p) => p.kind === "reps_at_weight")?.previousValue).toBe(10)
  })

  it("does not mutate the input map", () => {
    const base = applyWorkoutToProgress({}, first)
    const frozen = { ...base }
    applyWorkoutToProgress(
      base,
      workout("w2", "2026-10-03", [exercise("bench", [set(70, 5)])])
    )
    expect(base).toEqual(frozen)
  })
})

describe("computeStreak", () => {
  const w = (id: string, date: string) =>
    workout(id, date, [exercise("bench", [set(60, 8)])])

  it("allows a single rest day between sessions", () => {
    const streak = computeStreak(
      [w("a", "2026-10-01"), w("b", "2026-10-03"), w("c", "2026-10-05")],
      "2026-10-05"
    )
    expect(streak.current).toBe(3)
    expect(streak.longest).toBe(3)
  })

  it("breaks on a gap of three or more days", () => {
    const streak = computeStreak(
      [
        w("a", "2026-10-01"),
        w("b", "2026-10-02"),
        w("c", "2026-10-06"),
        w("d", "2026-10-07"),
      ],
      "2026-10-07"
    )
    expect(streak.current).toBe(2)
    expect(streak.longest).toBe(2)
  })

  it("current is zero when the last session is more than two days ago", () => {
    const streak = computeStreak(
      [w("a", "2026-10-01"), w("b", "2026-10-02")],
      "2026-10-06"
    )
    expect(streak.current).toBe(0)
    expect(streak.longest).toBe(2)
  })

  it("counts the same day once and lists the last seven days", () => {
    const streak = computeStreak(
      [w("a", "2026-10-05"), w("b", "2026-10-05"), w("c", "2026-09-28")],
      "2026-10-05"
    )
    expect(streak.current).toBe(1)
    expect(streak.lastSevenDays).toEqual(["2026-10-05"])
  })

  it("handles no workouts", () => {
    expect(computeStreak([], "2026-10-05")).toEqual({
      current: 0,
      longest: 0,
      lastSevenDays: [],
    })
  })

  it("derives the allowed gap from the plan: 8 minus days per week, never below two", () => {
    expect(streakMaxGapDays()).toBe(STREAK_MAX_GAP_DAYS)
    expect(streakMaxGapDays(null)).toBe(2)
    expect(streakMaxGapDays(2)).toBe(6)
    expect(streakMaxGapDays(3)).toBe(5)
    expect(streakMaxGapDays(4)).toBe(4)
    expect(streakMaxGapDays(5)).toBe(3)
    expect(streakMaxGapDays(6)).toBe(2)
  })

  it("keeps a Mon/Wed/Fri streak across the weekend on a 3-day plan", () => {
    // 2026-10-05 is a Monday.
    const days = [
      "2026-09-21",
      "2026-09-23",
      "2026-09-25",
      "2026-09-28",
      "2026-09-30",
      "2026-10-02",
    ]
    const sessions = days.map((d, i) => w(`s${i}`, d))
    const mondayMorning = computeStreak(sessions, "2026-10-05", 3)
    expect(mondayMorning.current).toBe(6)
    expect(mondayMorning.longest).toBe(6)
    const afterMonday = computeStreak(
      [...sessions, w("s6", "2026-10-05")],
      "2026-10-05",
      3
    )
    expect(afterMonday.current).toBe(7)
    // Without a plan the old one-rest-day rule still applies.
    expect(computeStreak(sessions, "2026-10-05").current).toBe(0)
  })

  it("keeps a weekend-only 2-day plan and breaks when a whole week is missed", () => {
    const weekend = [
      w("a", "2026-09-19"),
      w("b", "2026-09-20"),
      w("c", "2026-09-26"),
      w("d", "2026-09-27"),
    ]
    expect(computeStreak(weekend, "2026-09-27", 2).current).toBe(4)
    const missedWeek = [...weekend, w("e", "2026-10-10")]
    const streak = computeStreak(missedWeek, "2026-10-10", 2)
    expect(streak.current).toBe(1)
    expect(streak.longest).toBe(4)
    expect(computeStreak(weekend, "2026-10-05", 2).current).toBe(0)
  })
})

describe("weeklyVolume", () => {
  it("starts weeks on Monday", () => {
    expect(weekStartKey("2026-10-07")).toBe("2026-10-05")
    expect(weekStartKey("2026-10-05")).toBe("2026-10-05")
    expect(weekStartKey("2026-10-04")).toBe("2026-09-28")
  })

  it("buckets workouts into the last N weeks oldest first, including empty weeks", () => {
    const workouts = [
      workout("a", "2026-10-06", [exercise("bench", [set(60, 10)])]),
      workout("b", "2026-09-30", [exercise("bench", [set(50, 10)])]),
      workout("c", "2026-09-01", [exercise("bench", [set(40, 10)])]),
    ]
    const weeks = weeklyVolume(workouts, 3, "2026-10-07")
    expect(weeks.map((w) => w.weekStart)).toEqual([
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
    ])
    expect(weeks.map((w) => w.workouts)).toEqual([0, 1, 1])
    expect(weeks[2].volumeKg).toBe(600)
    expect(weeks[1].sets).toBe(1)
  })
})

describe("main-phase only accounting", () => {
  const base = {
    prescribedSets: 1,
    prescribedReps: [8, 12] as [number, number],
    prescribedDurationSeconds: null,
    recommendedWeightKg: null,
  }
  const warm = {
    ...base,
    slotId: "w",
    exerciseId: "arm-circles",
    role: "warmup" as const,
    phase: "warmup" as const,
    status: "completed" as const,
    sets: [{ setNumber: 1, weightKg: null, reps: 15, completed: true }],
  }
  const main = {
    ...base,
    slotId: "m",
    exerciseId: "barbell-bench-press",
    role: "primary_compound" as const,
    phase: "main" as const,
    status: "completed" as const,
    sets: [
      { setNumber: 1, weightKg: 60, reps: 8, completed: true },
      { setNumber: 2, weightKg: 60, reps: 8, completed: true },
    ],
  }

  it("excludes warm-up and cool-down items from totals", () => {
    const totals = computeTotals([warm, main])
    expect(totals.exercisesCompleted).toBe(1)
    expect(totals.sets).toBe(2)
    expect(totals.reps).toBe(16)
    expect(totals.volumeKg).toBe(960)
  })

  it("never tracks progress for warm-up items", () => {
    const workout = {
      id: "w1",
      date: "2026-10-01",
      title: "Push",
      split: "push" as const,
      focus: ["chest" as const],
      goal: "muscle_gain" as const,
      startedAt: "2026-10-01T10:00:00.000Z",
      completedAt: "2026-10-01T11:00:00.000Z",
      durationSeconds: 3600,
      exercises: [warm, main],
      totals: computeTotals([warm, main]),
      personalRecords: [],
      engineVersion: 1,
      synced: false,
    }
    const progress = rebuildProgress([workout])
    expect(Object.keys(progress)).toEqual(["barbell-bench-press"])
  })
})
