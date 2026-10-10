import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  EngineInput,
  ReplaceOptions,
  Workout,
  WorkoutExercise,
} from "@/lib/engine/types"
import type { UserProfile } from "@/lib/domain/types"

const ALTERNATIVES: Record<string, string[]> = {
  "bench-press": ["db-bench", "machine-press"],
  "cable-fly": ["pec-deck"],
}

vi.mock("@/lib/engine", () => {
  const slot = (
    overrides: Partial<WorkoutExercise> &
      Pick<WorkoutExercise, "slotId" | "exerciseId" | "phase" | "role">
  ): WorkoutExercise => ({
    sets: 3,
    reps: [8, 12],
    durationSeconds: null,
    restSeconds: 90,
    tempo: null,
    rir: 2,
    recommendedWeightKg: null,
    note: null,
    replacedFromExerciseId: null,
    ...overrides,
  })
  const generateWorkout = (input: EngineInput): Workout => ({
    id: `w-${input.seed ?? 0}`,
    date: input.date,
    title: "Push",
    split: "push",
    focus: ["chest", "triceps"],
    goal: input.profile.goal,
    estimatedMinutes: 45,
    exercises: [
      slot({
        slotId: "s1",
        exerciseId: "arm-circles",
        phase: "warmup",
        role: "warmup",
        sets: 1,
        reps: null,
        durationSeconds: 30,
        restSeconds: 0,
        rir: null,
      }),
      slot({
        slotId: "s2",
        exerciseId: "bench-press",
        phase: "main",
        role: "primary_compound",
        restSeconds: 120,
      }),
      slot({
        slotId: "s3",
        exerciseId: "cable-fly",
        phase: "main",
        role: "isolation",
        restSeconds: 60,
      }),
      slot({
        slotId: "s4",
        exerciseId: "chest-stretch",
        phase: "cooldown",
        role: "cooldown",
        sets: 1,
        reps: null,
        durationSeconds: 30,
        restSeconds: 0,
        rir: null,
      }),
    ],
    generatedAt: input.now,
    seed: input.seed ?? 0,
    engineVersion: 1,
  })
  const replaceExercise = (
    workout: Workout,
    slotId: string,
    _input: EngineInput,
    options?: ReplaceOptions
  ): Workout | null => {
    const current = workout.exercises.find((e) => e.slotId === slotId)
    if (!current) return null
    const original = current.replacedFromExerciseId ?? current.exerciseId
    const exclude = new Set([...(options?.exclude ?? []), current.exerciseId])
    const pick =
      options?.withExerciseId ??
      (ALTERNATIVES[original] ?? []).find((id) => !exclude.has(id))
    if (!pick) return null
    return {
      ...workout,
      exercises: workout.exercises.map((e) =>
        e.slotId === slotId
          ? { ...e, exerciseId: pick, replacedFromExerciseId: original }
          : e
      ),
    }
  }
  return {
    generateWorkout,
    replaceExercise,
    replacementCandidates: () => [
      { exerciseId: "db-bench", score: 90, reason: "Same muscle group" },
    ],
    estimateDurationMinutes: () => 45,
    explainWorkout: () => [],
    ENGINE_VERSION: 1,
  }
})

import {
  useWorkoutStore,
  IDLE_TIMER,
  PERSISTED_UNDO_CAP,
  STALE_WORKOUT_MS,
} from "./workout-store"
import type { ActiveWorkout } from "./types"
import { useProfileStore } from "./profile-store"
import { useHistoryStore } from "./history-store"
import { useSyncStore } from "@/lib/sync/sync-store"
import { todayKey, addDays } from "@/lib/dates"

const profile: UserProfile = {
  id: "p1",
  goal: "muscle_gain",
  gender: "unspecified",
  weightKg: 80,
  experience: "intermediate",
  trainingDaysPerWeek: 4,
  equipmentPreset: "full_gym",
  equipment: ["barbell", "dumbbell"],
  durationPreferenceMinutes: 45,
  units: "kg",
  limitations: [],
  excludedExerciseIds: [],
  preferredExerciseIds: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
}

const sets = [
  { setNumber: 1, weightKg: 60, reps: 10, completed: true },
  { setNumber: 2, weightKg: 60, reps: 10, completed: true },
]

function store() {
  return useWorkoutStore.getState()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-07T10:00:00.000Z"))
  useProfileStore.setState({ profile })
  useHistoryStore.setState({ workouts: [], progress: {} })
  useSyncStore.setState({ signedIn: false, status: "signed_out" })
  useWorkoutStore.setState({ active: null, timer: IDLE_TIMER })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("ensureToday", () => {
  it("is a no-op without a profile", () => {
    useProfileStore.setState({ profile: null })
    store().ensureToday()
    expect(store().active).toBeNull()
  })

  it("generates today's workout with history and progress from the stores", () => {
    store().ensureToday()
    const active = store().active
    expect(active?.workout.date).toBe(todayKey())
    expect(active?.status).toBe("ready")
    expect(active?.currentIndex).toBe(0)
    expect(Object.keys(active?.logs ?? {})).toEqual(["s1", "s2", "s3", "s4"])
    expect(active?.logs.s2.status).toBe("pending")
  })

  it("keeps today's workout and keeps an in-progress one from yesterday", () => {
    store().ensureToday()
    const first = store().active
    store().ensureToday()
    expect(store().active).toBe(first)

    const yesterday = addDays(todayKey(), -1)
    useWorkoutStore.setState({
      active: {
        ...first!,
        status: "active",
        startedAt: new Date().toISOString(),
        workout: { ...first!.workout, date: yesterday },
      },
    })
    store().ensureToday()
    expect(store().active?.workout.date).toBe(yesterday)
  })

  it("replaces a ready or completed workout from an earlier day", () => {
    store().ensureToday()
    const first = store().active!
    useWorkoutStore.setState({
      active: {
        ...first,
        status: "completed",
        workout: { ...first.workout, date: addDays(todayKey(), -1) },
      },
    })
    store().ensureToday()
    expect(store().active?.workout.date).toBe(todayKey())
    expect(store().active?.status).toBe("ready")
  })

  it("regenerate bumps the seed and is only allowed while ready", () => {
    store().ensureToday()
    const seed = store().active!.workout.seed
    store().regenerate()
    expect(store().active!.workout.seed).toBe(seed + 1)
    store().start()
    store().regenerate()
    expect(store().active!.workout.seed).toBe(seed + 1)
  })
})

describe("complete / skip / replace / undo", () => {
  beforeEach(() => {
    store().ensureToday()
    store().start()
  })

  it("completes the current slot, advances, and starts the rest timer when there is a next slot", () => {
    store().goTo(1)
    store().completeCurrent(sets)
    const active = store().active!
    expect(active.logs.s2.status).toBe("completed")
    expect(active.logs.s2.sets).toEqual(sets)
    expect(active.logs.s2.completedAt).toBe(new Date().toISOString())
    expect(active.currentIndex).toBe(2)
    expect(store().timer.running).toBe(true)
    expect(store().timer.totalSeconds).toBe(120)
    expect(store().timer.endsAt).toBe(Date.now() + 120_000)
    expect(store().canUndo()).toBe(true)
  })

  it("does not start a rest timer when restSeconds is 0", () => {
    store().completeCurrent([])
    expect(store().timer).toEqual(IDLE_TIMER)
    expect(store().active?.currentIndex).toBe(1)
  })

  it("does not start a rest timer after the last slot and reports isAtEnd", () => {
    store().goTo(3)
    store().completeCurrent([])
    expect(store().timer).toEqual(IDLE_TIMER)
    expect(store().isAtEnd()).toBe(true)
    expect(store().currentExercise()).toBeNull()
  })

  it("skipCurrent replaces with an engine alternative, keeps the slot id and tracks tried ids", () => {
    store().goTo(1)
    store().skipCurrent()
    let active = store().active!
    expect(active.currentIndex).toBe(1)
    expect(active.workout.exercises[1].slotId).toBe("s2")
    expect(active.workout.exercises[1].exerciseId).toBe("db-bench")
    expect(active.workout.exercises[1].replacedFromExerciseId).toBe(
      "bench-press"
    )
    expect(active.logs.s2).toMatchObject({
      status: "pending",
      exerciseId: "db-bench",
      triedExerciseIds: ["bench-press", "db-bench"],
    })

    store().skipCurrent()
    active = store().active!
    expect(active.workout.exercises[1].exerciseId).toBe("machine-press")

    // No alternatives left: mark skipped and advance.
    store().skipCurrent()
    active = store().active!
    expect(active.logs.s2.status).toBe("skipped")
    expect(active.currentIndex).toBe(2)
    expect(active.undoStack).toHaveLength(3)
  })

  it("skipWithoutReplace marks skipped and advances", () => {
    store().goTo(2)
    store().skipWithoutReplace()
    expect(store().active?.logs.s3.status).toBe("skipped")
    expect(store().active?.currentIndex).toBe(3)
  })

  it("replaceCurrent applies a manual pick", () => {
    store().goTo(1)
    store().replaceCurrent("incline-press")
    expect(store().active?.workout.exercises[1].exerciseId).toBe(
      "incline-press"
    )
    expect(store().active?.logs.s2.exerciseId).toBe("incline-press")
    expect(store().candidatesForCurrent(3)).toHaveLength(1)
  })

  it("undo restores workout, logs and index, clears the timer, and caps the stack at 20", () => {
    store().goTo(1)
    store().skipCurrent()
    store().completeCurrent(sets)
    expect(store().active?.currentIndex).toBe(2)
    expect(store().timer.running).toBe(true)

    store().undo()
    expect(store().active?.currentIndex).toBe(1)
    expect(store().active?.logs.s2.status).toBe("pending")
    expect(store().active?.workout.exercises[1].exerciseId).toBe("db-bench")
    expect(store().timer).toEqual(IDLE_TIMER)

    store().undo()
    expect(store().active?.workout.exercises[1].exerciseId).toBe("bench-press")
    expect(store().canUndo()).toBe(false)
    store().undo()
    expect(store().active?.currentIndex).toBe(1)

    for (let i = 0; i < 25; i++) {
      store().updateCurrentPrescription({ sets: 3 })
      store().completeCurrent([])
      store().goTo(1)
    }
    expect(store().active?.undoStack.length).toBe(20)
  })

  it("undoing a replace or skip keeps a running rest; undoing a complete cancels it", () => {
    store().goTo(1)
    store().completeCurrent(sets)
    vi.advanceTimersByTime(30_000)
    const resting = store().timer
    expect(resting.running).toBe(true)

    store().skipCurrent()
    expect(store().active?.workout.exercises[2].exerciseId).toBe("pec-deck")
    expect(store().timer).toEqual(resting)
    store().undo()
    expect(store().active?.workout.exercises[2].exerciseId).toBe("cable-fly")
    expect(store().timer).toEqual(resting)

    store().skipWithoutReplace()
    store().undo()
    expect(store().active?.logs.s3.status).toBe("pending")
    expect(store().timer).toEqual(resting)

    store().undo()
    expect(store().active?.currentIndex).toBe(1)
    expect(store().timer).toEqual(IDLE_TIMER)
  })

  it("persists only the last few undo entries while memory keeps the full stack", () => {
    for (let i = 0; i < 6; i++) {
      store().goTo(1)
      store().completeCurrent(sets)
    }
    const inMemory = store().active!.undoStack
    expect(inMemory.length).toBeGreaterThan(PERSISTED_UNDO_CAP)
    const partialize = useWorkoutStore.persist.getOptions().partialize!
    const persisted = partialize(useWorkoutStore.getState()) as {
      active: ActiveWorkout | null
    }
    expect(persisted.active?.undoStack).toHaveLength(PERSISTED_UNDO_CAP)
    expect(persisted.active?.undoStack.at(-1)).toBe(inMemory.at(-1))
    expect(persisted.active?.logs).toBe(store().active?.logs)
  })

  it("updateCurrentPrescription edits only the current slot", () => {
    store().goTo(1)
    store().updateCurrentPrescription({ sets: 5, recommendedWeightKg: 70 })
    expect(store().active?.workout.exercises[1]).toMatchObject({
      sets: 5,
      recommendedWeightKg: 70,
    })
    expect(store().active?.workout.exercises[2].sets).toBe(3)
  })

  it("auto-starts a ready workout when the user acts on it", () => {
    useWorkoutStore.setState({ active: null })
    store().ensureToday()
    store().completeCurrent([])
    expect(store().active?.status).toBe("active")
    expect(store().active?.startedAt).toBe(new Date().toISOString())
  })
})

describe("paused and cool-down guards", () => {
  it("ignores complete and skip while the workout is paused", () => {
    store().ensureToday()
    store().start()
    store().pause()
    const before = store().active
    store().completeCurrent(sets)
    store().skipCurrent()
    store().skipWithoutReplace()
    expect(store().active).toBe(before)
    expect(store().timer).toEqual(IDLE_TIMER)
  })

  it("does not start a rest after a cool-down slot", () => {
    store().ensureToday()
    store().start()
    store().goTo(3)
    useWorkoutStore.setState((st) => ({
      active: st.active && {
        ...st.active,
        workout: {
          ...st.active.workout,
          exercises: [
            ...st.active.workout.exercises,
            { ...st.active.workout.exercises[3]!, slotId: "s5", restSeconds: 30 },
          ].map((e) => (e.slotId === "s4" ? { ...e, restSeconds: 30 } : e)),
        },
      },
    }))
    store().completeCurrent([])
    expect(store().active?.currentIndex).toBe(4)
    expect(store().timer).toEqual(IDLE_TIMER)
  })
})

describe("timing", () => {
  it("elapsedSeconds excludes paused time and survives pause/resume", () => {
    store().ensureToday()
    store().start()
    vi.advanceTimersByTime(60_000)
    expect(store().elapsedSeconds()).toBe(60)
    store().pause()
    vi.advanceTimersByTime(30_000)
    expect(store().elapsedSeconds()).toBe(60)
    store().resume()
    vi.advanceTimersByTime(15_000)
    expect(store().elapsedSeconds()).toBe(75)
    expect(store().active?.pausedTotalMs).toBe(30_000)
  })

  it("rest timer is endsAt based, pausable, adjustable and clamped at zero", () => {
    store().startRest(90)
    vi.advanceTimersByTime(10_000)
    store().pauseRest()
    expect(store().timer.running).toBe(false)
    expect(store().timer.pausedRemaining).toBe(80)
    expect(store().timer.endsAt).toBeNull()
    store().adjustRest(-100)
    expect(store().timer.pausedRemaining).toBe(0)
    expect(store().timer.totalSeconds).toBe(0)
    store().adjustRest(30)
    store().resumeRest()
    expect(store().timer.running).toBe(true)
    expect(store().timer.endsAt).toBe(Date.now() + 30_000)
    store().adjustRest(15)
    expect(store().timer.endsAt).toBe(Date.now() + 45_000)
    store().skipRest()
    expect(store().timer).toEqual(IDLE_TIMER)
  })

  it("pausing the workout pauses a running rest timer", () => {
    store().ensureToday()
    store().start()
    store().startRest(60)
    vi.advanceTimersByTime(20_000)
    store().pause()
    expect(store().timer.pausedRemaining).toBe(40)
    vi.advanceTimersByTime(20_000)
    store().resume()
    expect(store().timer.endsAt).toBe(Date.now() + 40_000)
  })

  it("progress reports index/total/completed and the current phase", () => {
    store().ensureToday()
    store().start()
    expect(store().progress()).toEqual({
      index: 0,
      total: 4,
      completed: 0,
      phase: "warmup",
    })
    store().completeCurrent([])
    expect(store().progress()).toEqual({
      index: 1,
      total: 4,
      completed: 1,
      phase: "main",
    })
  })
})

describe("finish", () => {
  it("returns null when only the cool-down was completed", () => {
    store().ensureToday()
    store().start()
    store().goTo(3)
    store().completeCurrent([])
    expect(store().finish()).toBeNull()
    expect(useHistoryStore.getState().workouts).toHaveLength(0)
  })

  it("returns null when only the warm-up was completed (no main work, nothing saved)", () => {
    store().ensureToday()
    store().start()
    store().completeCurrent([])
    expect(store().active?.logs.s1.status).toBe("completed")
    store().pause()
    expect(store().finish()).toBeNull()
    expect(useHistoryStore.getState().workouts).toHaveLength(0)
    expect(store().active?.status).toBe("paused")
  })

  it("saves a CompletedWorkout to history, marks the session completed and kicks sync", () => {
    const flush = vi.spyOn(useSyncStore.getState(), "flush")
    store().ensureToday()
    store().start()
    store().completeCurrent([])
    vi.advanceTimersByTime(600_000)
    store().completeCurrent(sets)
    store().skipWithoutReplace()

    const preview = store().previewSummary()
    // Totals count main-phase work only: the completed warm-up is not a training exercise.
    expect(preview?.totals.exercisesCompleted).toBe(1)
    expect(preview?.totals.volumeKg).toBe(1200)
    expect(preview?.durationSeconds).toBe(600)

    const saved = store().finish()
    expect(saved).not.toBeNull()
    expect(saved?.date).toBe(todayKey())
    expect(saved?.durationSeconds).toBe(600)
    expect(saved?.exercises).toHaveLength(4)
    expect(saved?.exercises.map((e) => e.status)).toEqual([
      "completed",
      "completed",
      "skipped",
      "skipped",
    ])
    expect(saved?.exercises[1]).toMatchObject({
      prescribedSets: 3,
      prescribedReps: [8, 12],
      recommendedWeightKg: null,
    })
    expect(saved?.totals.caloriesEstimate).toBe(80)
    expect(saved?.personalRecords).toEqual([])
    expect(saved?.synced).toBe(false)
    expect(saved?.engineVersion).toBe(1)

    const active = store().active!
    expect(active.status).toBe("completed")
    expect(active.savedWorkoutId).toBe(saved?.id)
    expect(active.completedAt).toBe(new Date().toISOString())
    expect(store().timer).toEqual(IDLE_TIMER)
    expect(store().isAtEnd()).toBe(false)

    const history = useHistoryStore.getState()
    expect(history.workouts[0]?.id).toBe(saved?.id)
    expect(history.progress["bench-press"]?.timesPerformed).toBe(1)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(store().finish()).toBeNull()
  })

  it("detects personal records against existing history progress", () => {
    store().ensureToday()
    store().start()
    store().goTo(1)
    store().completeCurrent(sets)
    const first = store().finish()!
    expect(first.personalRecords).toEqual([])

    useWorkoutStore.setState({ active: null })
    store().ensureToday()
    store().start()
    store().goTo(1)
    store().completeCurrent([
      { setNumber: 1, weightKg: 70, reps: 10, completed: true },
    ])
    const second = store().finish()!
    expect(second.personalRecords.map((p) => p.kind).sort()).toEqual([
      "e1rm",
      "volume",
      "weight",
    ])
    expect(useHistoryStore.getState().workouts).toHaveLength(2)
  })
})

describe("day boundaries and stale sessions", () => {
  /** Local wall-clock time on a given October 2026 day. */
  function at(day: number, hours: number, minutes = 0): Date {
    return new Date(2026, 9, day, hours, minutes)
  }

  it("resume makes an active session from an earlier day today's; the record keeps its start day", () => {
    vi.setSystemTime(at(7, 23, 40))
    store().ensureToday()
    store().start()
    store().goTo(1)
    store().completeCurrent(sets)

    vi.setSystemTime(at(8, 0, 5))
    expect(store().active?.workout.date).toBe("2026-10-07")
    store().resume()
    expect(store().active?.status).toBe("active")
    expect(store().active?.workout.date).toBe("2026-10-08")

    const saved = store().finish()
    expect(saved?.date).toBe("2026-10-07")
    // The session belonged to the 7th, so the 8th still gets its own workout.
    store().ensureToday()
    expect(store().active?.status).toBe("ready")
    expect(store().active?.workout.date).toBe("2026-10-08")
  })

  it("acting on the deck after midnight carries the session over without a prompt", () => {
    vi.setSystemTime(at(7, 23, 40))
    store().ensureToday()
    store().start()
    store().completeCurrent([])

    vi.setSystemTime(at(8, 0, 5))
    store().completeCurrent(sets)
    expect(store().active?.workout.date).toBe("2026-10-08")
    expect(store().active?.currentIndex).toBe(2)

    // Undo restores an older snapshot but stays on today.
    store().undo()
    expect(store().active?.workout.date).toBe("2026-10-08")
  })

  it("resume un-pauses a paused session from an earlier day and makes it today's", () => {
    vi.setSystemTime(at(7, 23, 0))
    store().ensureToday()
    store().start()
    store().pause()

    vi.setSystemTime(at(8, 1, 0))
    store().resume()
    expect(store().active?.status).toBe("active")
    expect(store().active?.workout.date).toBe("2026-10-08")
    expect(store().active?.pausedTotalMs).toBe(2 * 60 * 60 * 1000)
  })

  it("start makes a plan left open overnight today's", () => {
    vi.setSystemTime(at(7, 20, 0))
    store().ensureToday()
    expect(store().active?.workout.date).toBe("2026-10-07")

    vi.setSystemTime(at(8, 7, 0))
    store().start()
    expect(store().active?.status).toBe("active")
    expect(store().active?.workout.date).toBe("2026-10-08")
    store().goTo(1)
    store().completeCurrent(sets)
    expect(store().finish()?.date).toBe("2026-10-08")
  })

  it("ensureToday closes an abandoned session: saves the logged main work and plans today", () => {
    vi.setSystemTime(at(7, 18, 0))
    store().ensureToday()
    store().start()
    store().goTo(1)
    vi.setSystemTime(at(7, 18, 10))
    store().completeCurrent(sets)

    vi.setSystemTime(new Date(at(7, 18, 10).getTime() + STALE_WORKOUT_MS + 1))
    store().ensureToday()

    const saved = useHistoryStore.getState().workouts
    expect(saved).toHaveLength(1)
    expect(saved[0].date).toBe("2026-10-07")
    expect(saved[0].completedAt).toBe(at(7, 18, 10).toISOString())
    expect(saved[0].durationSeconds).toBe(600)
    expect(saved[0].totals.exercisesCompleted).toBe(1)
    expect(store().active?.status).toBe("ready")
    expect(store().active?.workout.date).toBe("2026-10-08")
  })

  it("saving a session from an earlier day the next morning ends it at its last activity", () => {
    vi.setSystemTime(at(7, 22, 0))
    store().ensureToday()
    store().start()
    store().goTo(1)
    vi.setSystemTime(at(7, 22, 20))
    store().completeCurrent(sets)

    // Back at 03:00 (under the stale limit): the preview and the save must not count the night.
    vi.setSystemTime(at(8, 3, 0))
    expect(store().previewSummary()?.durationSeconds).toBe(20 * 60)
    const saved = store().finish()
    expect(saved?.durationSeconds).toBe(20 * 60)
    expect(saved?.completedAt).toBe(at(7, 22, 20).toISOString())
    expect(saved?.date).toBe("2026-10-07")
  })

  it("ensureToday drops an abandoned session with no main work and keeps a recent one", () => {
    vi.setSystemTime(at(7, 21, 0))
    store().ensureToday()
    store().start()
    store().completeCurrent([])

    vi.setSystemTime(at(7, 23, 0))
    store().ensureToday()
    expect(store().active?.status).toBe("active")

    // Five hours idle, from yesterday: kept so the user can resume it.
    vi.setSystemTime(at(8, 2, 0))
    store().ensureToday()
    expect(store().active?.workout.date).toBe("2026-10-07")
    expect(store().active?.status).toBe("active")

    vi.setSystemTime(at(8, 4, 0))
    store().ensureToday()
    expect(useHistoryStore.getState().workouts).toHaveLength(0)
    expect(store().active?.status).toBe("ready")
    expect(store().active?.workout.date).toBe("2026-10-08")
  })
})
