/**
 * Server side: render a validated CoachRequest as the coach's user message. Exercise details come
 * from the static library on the server, never from the client, so the prompt contains no free
 * text supplied by the caller: engine notes arrive as codes and are rendered from notes.ts.
 */
import { loadKindOf } from "@/lib/engine/progression"
import { coreWeeklyCap, weeklyCap } from "@/lib/engine/recovery"
import { isSingleImplementLift } from "@/lib/engine/starting-load"
import { getExercise } from "@/lib/exercises"
import { unilateralSide, type Exercise } from "@/lib/exercises/types"
import { ENGINE_NOTE_TEXT, isEngineNoteCode, isWorkoutNoteCode, WORKOUT_NOTE_TEXT, type EngineNoteCode } from "./notes"
import type { CoachLastSession, CoachRequest } from "./schema"

function describe(ex: Exercise) {
  return {
    exercise_id: ex.id,
    name: ex.name,
    category: ex.category,
    pattern: ex.movementPattern,
    mechanics: ex.mechanics,
    load_type: ex.loadType,
    unilateral: ex.isUnilateral ?? false,
    difficulty: ex.difficulty,
    equipment: ex.equipment,
    primary_muscle: ex.primaryMuscle,
    secondary_muscles: ex.secondaryMuscles,
    stresses_areas: ex.contraindications,
    warmup_required: ex.warmupRequired,
    default_sets: ex.setsRange,
    default_reps: ex.repRange ?? null,
    default_duration_seconds: ex.durationRange ?? null,
  }
}

function brief(ex: Exercise) {
  return {
    exercise_id: ex.id,
    name: ex.name,
    pattern: ex.movementPattern,
    mechanics: ex.mechanics,
    difficulty: ex.difficulty,
    equipment: ex.equipment,
    primary_muscle: ex.primaryMuscle,
    stresses_areas: ex.contraindications,
  }
}

/** "8-12", or a single number when the range is one rep wide ("6", never "6-6"). */
export function formatReps(reps: readonly [number, number] | null): string | null {
  if (!reps) return null
  return reps[0] === reps[1] ? `${reps[0]}` : `${reps[0]}-${reps[1]}`
}

/**
 * How to read a load on this exercise. Dumbbell loads are per dumbbell (starting-load.ts), so a
 * two-dumbbell lift or a single-arm lift is "per_hand"; a barbell, machine, or one implement held
 * in both hands (goblet squat, kettlebell swing) is "total". null without an external load.
 */
export function loadBasis(ex: Exercise): "per_hand" | "total" | null {
  if (ex.loadType !== "external") return null
  const kind = loadKindOf(ex)
  if (kind === "dumbbell") return isSingleImplementLift(ex) ? "total" : "per_hand"
  // Every kettlebell lift in the library uses one bell: in the working hand, or in both hands.
  if (kind === "kettlebell") return ex.isUnilateral ? "per_hand" : "total"
  return "total"
}

type RequestSlot = CoachRequest["workout"]["exercises"][number]

/**
 * The card note as the coach reads it: every known code's description, leading sentence first
 * (coach round 2, R23). Older clients send only the leading code; unknown codes are not rendered.
 */
export function engineNoteText(slot: Pick<RequestSlot, "engineNote" | "engineNotes">): string | null {
  const codes = slot.engineNotes ?? (slot.engineNote ? [slot.engineNote] : [])
  const known = [...new Set(codes)].filter(isEngineNoteCode) as EngineNoteCode[]
  return known.length > 0 ? known.map((c) => ENGINE_NOTE_TEXT[c]).join(" ") : null
}

/**
 * The last session of a slot's exercise (R23): the prescription then, each completed set, and how
 * many sessions in a row the working load has held. Null fields are left out to keep it short.
 */
function lastSessionView(last: CoachLastSession, ex: Exercise) {
  const loaded = last.sets.some((s) => s.weightKg != null)
  return {
    days_ago: last.daysAgo,
    ...(last.prescribedReps ? { prescribed_reps: formatReps(last.prescribedReps) } : {}),
    ...(last.prescribedDurationSeconds != null ? { prescribed_duration_seconds: last.prescribedDurationSeconds } : {}),
    ...(loaded ? { load_basis: loadBasis(ex) } : {}),
    sets: last.sets.map((s) => ({
      ...(s.weightKg != null ? { load_kg: s.weightKg } : {}),
      ...(s.reps != null ? { reps: s.reps } : {}),
      ...(s.durationSeconds != null ? { duration_seconds: s.durationSeconds } : {}),
      ...(s.rpe != null ? { rpe: s.rpe } : {}),
    })),
    ...(last.sameLoadSessions != null ? { sessions_at_this_load: last.sameLoadSessions } : {}),
  }
}

/** Throws if the request references an exercise the library does not know. */
export function buildCoachMessage(req: CoachRequest): string {
  const slots = req.workout.exercises.map((slot) => {
    const ex = getExercise(slot.exerciseId)
    if (!ex) throw new Error(`Unknown exercise id: ${slot.exerciseId}`)
    const overCap = new Set(slot.overCapAlternatives ?? [])
    const alternatives = slot.alternatives
      .map((id) => getExercise(id))
      .filter((a): a is Exercise => !!a)
      .map((a) => (overCap.has(a.id) ? { ...brief(a), over_weekly_set_cap: true } : brief(a)))
    return {
      slot_id: slot.slotId,
      phase: slot.phase,
      role: slot.role,
      exercise: describe(ex),
      prescription: {
        sets: slot.sets,
        reps: formatReps(slot.reps),
        duration_seconds: slot.durationSeconds,
        // Unilateral work: the reps or hold are for each leg or side (F29).
        ...(unilateralSide(ex) && (slot.reps || slot.durationSeconds != null) ? { target_per: unilateralSide(ex) } : {}),
        rest_seconds: slot.restSeconds,
        tempo: slot.tempo,
        rir: slot.rir,
        load_kg: slot.recommendedWeightKg,
        load_source: slot.weightSource,
        load_basis: slot.recommendedWeightKg != null ? loadBasis(ex) : null,
        engine_note: engineNoteText(slot),
      },
      ...(slot.lastSession ? { last_session: lastSessionView(slot.lastSession, ex) } : {}),
      allowed_alternatives: alternatives,
    }
  })

  const workoutNotes = (req.workout.notes ?? []).filter(isWorkoutNoteCode).map((c) => WORKOUT_NOTE_TEXT[c])

  const payload = {
    user_profile: {
      goal: req.profile.goal,
      experience: req.profile.experience,
      gender: req.profile.gender,
      body_weight_kg: req.profile.weightKg,
      training_days_per_week: req.profile.trainingDaysPerWeek,
      preferred_session_minutes: req.profile.durationPreferenceMinutes,
      equipment_available: req.profile.equipment,
      limitations_protect_areas: req.profile.limitations,
    },
    recent_training_last_7_days: req.recentTraining.map((r) => ({
      days_ago: r.daysAgo,
      title: r.title,
      focus: r.focus,
      working_sets: r.workingSets,
      ...(r.conditioningMinutes != null ? { conditioning_minutes: r.conditioningMinutes } : {}),
      ...(r.mainExerciseIds
        ? {
            main_exercises: r.mainExerciseIds
              .map((id) => getExercise(id))
              .filter((e): e is Exercise => !!e)
              .map((e) => ({ exercise_id: e.id, name: e.name })),
          }
        : {}),
    })),
    weekly_working_sets_by_muscle_group: req.weeklySetsByGroup,
    weekly_set_cap_per_muscle_group: weeklyCap(req.profile.experience),
    // Core has its own cap by goal and experience (core spec C04), in place of the general one.
    weekly_set_cap_core: coreWeeklyCap(req.profile.goal, req.profile.experience),
    ...(req.conditioningMinutesLast7 != null ? { conditioning_minutes_last_7_days: req.conditioningMinutesLast7 } : {}),
    workout: {
      title: req.workout.title,
      split: req.workout.split,
      focus: req.workout.focus,
      engine_estimated_minutes: req.workout.estimatedMinutes,
      ...(workoutNotes.length > 0 ? { engine_notes: workoutNotes } : {}),
      slots: slots,
    },
  }

  return `Review this generated workout before it is shown to the user. Return the review as JSON in the required schema.

${JSON.stringify(payload, null, 1)}`
}
