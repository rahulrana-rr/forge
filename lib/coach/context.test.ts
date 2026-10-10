/**
 * Coach round 2 (R23): the coach payload carries the whole card note (every sentence as a code)
 * and, for main slots with logged history, the last session and how long its load has held.
 */
import { describe, expect, it } from "vitest"

import { addDays } from "@/lib/dates"
import type { CompletedExercise, CompletedWorkout, ExerciseProgress, SetLog } from "@/lib/domain/types"
import { generateWorkout, type Workout } from "@/lib/engine"
import { RAMP_UP_NOTE } from "@/lib/engine/duration"
import { STARTING_GUESS_NOTE } from "@/lib/engine/progression"
import { makeInput, makeProfile } from "@/lib/engine/test-fixtures"
import { getExercise } from "@/lib/exercises"
import { buildCoachRequest, lastSessionOf } from "./context"
import { buildCoachMessage, engineNoteText, loadBasis } from "./message"
import { ENGINE_NOTE_TEXT } from "./notes"
import { CoachRequestSchema } from "./schema"

const TODAY = "2026-10-19"
const profile = makeProfile({ id: "coach-r23", goal: "muscle_gain", experience: "beginner", trainingDaysPerWeek: 3, gender: "female", weightKg: 61, equipmentPreset: "dumbbells" })
const input = makeInput(profile, TODAY)
const workout: Workout = generateWorkout(input)
const lifted = workout.exercises.find((e) => e.phase === "main" && e.role !== "finisher" && e.reps && getExercise(e.exerciseId)?.loadType === "external")!

function payloadOf(message: string) {
  return JSON.parse(message.slice(message.indexOf("{")))
}

function sets(weightKg: number | null, reps: number, extra: Partial<SetLog> = {}): SetLog[] {
  return [1, 2, 3].map((setNumber) => ({ setNumber, weightKg, reps, completed: true, ...extra }))
}

function entry(exerciseId: string, logged: SetLog[], prescribedReps: [number, number] | null = [8, 12]): CompletedExercise {
  return {
    slotId: `slot-${exerciseId}`,
    exerciseId,
    role: "secondary_compound",
    phase: "main",
    status: "completed",
    sets: logged,
    prescribedSets: logged.length,
    prescribedReps,
    prescribedDurationSeconds: null,
    recommendedWeightKg: logged[0]?.weightKg ?? null,
    weightSource: "history",
  }
}

function session(daysAgo: number, exercises: CompletedExercise[]): CompletedWorkout {
  const date = addDays(TODAY, -daysAgo)
  return {
    id: `done-${date}`,
    date,
    title: "Full body A",
    split: "full_body",
    focus: ["quads", "chest", "back"],
    goal: "muscle_gain",
    startedAt: `${date}T07:00:00.000Z`,
    completedAt: `${date}T08:00:00.000Z`,
    durationSeconds: 3600,
    exercises,
    totals: { exercisesCompleted: exercises.length, exercisesSkipped: 0, sets: 0, reps: 0, volumeKg: 0, caloriesEstimate: null },
    personalRecords: [],
    engineVersion: 1,
    synced: false,
  }
}

const slotOf = (req: ReturnType<typeof buildCoachRequest>, slotId: string) => req.workout.exercises.find((s) => s.slotId === slotId)!

describe("engine notes: every sentence travels as a code (R23)", () => {
  const noted: Workout = {
    ...workout,
    exercises: workout.exercises.map((e) => (e.slotId === lifted.slotId ? { ...e, note: `${RAMP_UP_NOTE} ${STARTING_GUESS_NOTE}` } : e)),
  }
  const req = buildCoachRequest(noted, input)
  const slot = slotOf(req, lifted.slotId)

  it("sends both the ramp-up and the starting-guess codes, the leading one first", () => {
    expect(CoachRequestSchema.safeParse(req).success).toBe(true)
    expect(slot.engineNotes).toEqual(["ramp_up", "starting_guess"])
    // Older servers read the leading code only.
    expect(slot.engineNote).toBe("ramp_up")
  })

  it("renders every sentence for the coach, and only the lead for an older client", () => {
    const rendered = payloadOf(buildCoachMessage(req)).workout.slots.find((s: { slot_id: string }) => s.slot_id === lifted.slotId)
    expect(rendered.prescription.engine_note).toBe(`${ENGINE_NOTE_TEXT.ramp_up} ${ENGINE_NOTE_TEXT.starting_guess}`)
    expect(engineNoteText({ engineNote: "ramp_up" })).toBe(ENGINE_NOTE_TEXT.ramp_up)
    expect(engineNoteText({ engineNote: "ramp_up", engineNotes: ["ramp_up", "some_new_code", "ramp_up"] })).toBe(ENGINE_NOTE_TEXT.ramp_up)
    expect(engineNoteText({ engineNote: null })).toBeNull()
  })

  it("sends no engineNotes for a slot without a note it knows", () => {
    const quiet: Workout = { ...workout, exercises: workout.exercises.map((e) => ({ ...e, note: e.slotId === lifted.slotId ? "Something the engine never says." : e.note })) }
    expect(slotOf(buildCoachRequest(quiet, input), lifted.slotId).engineNotes).toBeUndefined()
  })
})

describe("last session on main slots (R23)", () => {
  // Three sessions in a row at 20 kg, the one before at 17.5 kg; the newest logged RPE.
  const history = [
    session(2, [entry(lifted.exerciseId, sets(20, 12, { rpe: 8 }))]),
    session(5, [entry(lifted.exerciseId, sets(20, 12))]),
    session(9, [entry(lifted.exerciseId, sets(20, 12))]),
    session(12, [entry(lifted.exerciseId, sets(17.5, 12))]),
  ]
  const withHistory = { ...input, history }
  const req = buildCoachRequest(workout, withHistory)
  const slot = slotOf(req, lifted.slotId)

  it("reports the last prescription, every logged set and the sessions held at the same load", () => {
    expect(CoachRequestSchema.safeParse(req).success).toBe(true)
    expect(slot.lastSession).toEqual({
      daysAgo: 2,
      prescribedReps: [8, 12],
      prescribedDurationSeconds: null,
      sets: [1, 2, 3].map(() => ({ weightKg: 20, reps: 12, rpe: 8 })),
      sameLoadSessions: 3,
    })
  })

  it("renders it for the coach with the load basis and the stall count", () => {
    const rendered = payloadOf(buildCoachMessage(req)).workout.slots.find((s: { slot_id: string }) => s.slot_id === lifted.slotId)
    expect(rendered.last_session).toEqual({
      days_ago: 2,
      prescribed_reps: "8-12",
      load_basis: loadBasis(getExercise(lifted.exerciseId)!),
      sets: [1, 2, 3].map(() => ({ load_kg: 20, reps: 12, rpe: 8 })),
      sessions_at_this_load: 3,
    })
  })

  it("leaves it off warm-up, cool-down and never-logged slots", () => {
    for (const s of req.workout.exercises) {
      if (s.slotId === lifted.slotId) continue
      expect(s.lastSession, `${s.phase} ${s.exerciseId}`).toBeUndefined()
    }
    expect(slotOf(buildCoachRequest(workout, input), lifted.slotId).lastSession).toBeUndefined()
  })

  it("counts older sessions from the progress map without double counting", () => {
    // History holds the newest two sessions; progress repeats them and adds two older ones.
    const recentSessions = history.map((w) => ({ workoutId: w.id, date: w.date, sets: w.exercises[0]!.sets }))
    const progress: Record<string, ExerciseProgress> = {
      [lifted.exerciseId]: {
        exerciseId: lifted.exerciseId,
        bestWeightKg: 20,
        bestReps: 12,
        bestVolumeKg: 240,
        bestE1rmKg: 28,
        timesPerformed: 4,
        lastPerformedAt: history[0]!.completedAt,
        recentSessions,
        updatedAt: history[0]!.completedAt,
      },
    }
    const last = lastSessionOf(lifted.exerciseId, history.slice(0, 2), progress, TODAY)
    expect(last?.sameLoadSessions).toBe(3)
    expect(last?.daysAgo).toBe(2)
  })

  it("has no same-load count without a logged load, and keeps logged values inside the schema", () => {
    const bodyweight = lastSessionOf("push-up", [session(1, [entry("push-up", sets(null, 15))])], {}, TODAY)
    expect(bodyweight?.sameLoadSessions).toBeUndefined()
    expect(bodyweight?.sets[0]).toEqual({ weightKg: null, reps: 15 })

    const odd = [session(1, [entry(lifted.exerciseId, sets(20, 150, { rpe: 11, durationSeconds: 5000 }), [0, 200])])]
    const oddReq = buildCoachRequest(workout, { ...input, history: odd })
    expect(CoachRequestSchema.safeParse(oddReq).success).toBe(true)
    const last = slotOf(oddReq, lifted.slotId).lastSession!
    expect(last.prescribedReps).toBeNull()
    expect(last.sets[0]).toEqual({ weightKg: 20, reps: 100, durationSeconds: 3600 })
  })

  it("ignores sessions dated after the workout and skipped entries", () => {
    const skipped = { ...entry(lifted.exerciseId, sets(25, 12)), status: "skipped" as const }
    const later = [session(-1, [entry(lifted.exerciseId, sets(30, 12))]), session(3, [skipped])]
    expect(lastSessionOf(lifted.exerciseId, later, {}, TODAY)).toBeNull()
  })
})
