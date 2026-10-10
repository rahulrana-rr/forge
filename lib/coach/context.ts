/**
 * Client side: turn today's workout and the local history into the minimal CoachRequest.
 * Only ids, numbers and enums leave the device; exercise text stays in the frontend bundle and is
 * looked up again on the server from the same static library, and engine notes travel as codes
 * (notes.ts). Weekly volume uses the engine's own window and counts (computeRecovery), so the
 * coach sees the numbers the caps were checked against. Main slots with logged history carry the
 * last session's sets and how long the load has held (coach round 2, R23), so a stall is visible.
 */
import { daysBetween } from "@/lib/dates"
import type { CompletedExercise, CompletedWorkout, ExerciseProgress, SetLog, UserProfile } from "@/lib/domain/types"
import { replacementCandidates, type EngineInput, type Workout, type WorkoutExercise } from "@/lib/engine"
import { SECONDS_PER_REP } from "@/lib/engine/duration"
import { computeRecovery, type RecoveryMap } from "@/lib/engine/recovery"
import { getExercise, muscleGroupOf } from "@/lib/exercises"
import { engineNoteCode, engineNoteCodes, workoutNoteCode, type WorkoutNoteCode } from "./notes"
import type { CoachLastSession, CoachRequest } from "./schema"

const ALTERNATIVES_PER_SLOT = 6
/** The engine's weekly window: computeRecovery counts sessions 0–6 days before the workout day. */
const WINDOW_DAYS = 7
const MAX_IDS_PER_SESSION = 20
const MAX_WORKOUT_NOTES = 10
/** Schema bounds (schema.ts): a slot's last session lists at most this many sets. */
const MAX_LOGGED_SETS = 12
const MAX_DAYS_AGO = 365
const MAX_SAME_LOAD_SESSIONS = 50
const MAX_NOTE_CODES = 8

export function buildCoachRequest(workout: Workout, input: EngineInput): CoachRequest {
  const { profile } = input
  const history = input.history.filter((w) => w.id !== workout.id)
  const recent = history
    .filter((w) => {
      const ago = daysBetween(w.date, workout.date)
      return ago >= 0 && ago < WINDOW_DAYS
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  // The same counts the engine checked its weekly caps against (finishers excluded).
  const recovery = computeRecovery(history, workout.date)

  return {
    workout: {
      id: workout.id,
      date: workout.date,
      title: workout.title.slice(0, 80),
      split: workout.split,
      focus: workout.focus,
      estimatedMinutes: Math.max(1, Math.min(240, Math.round(workout.estimatedMinutes))),
      exercises: workout.exercises.map((slot) => slotContext(slot, workout, input, history)),
      notes: (workout.notes ?? [])
        .map(workoutNoteCode)
        .filter((c): c is WorkoutNoteCode => c !== null)
        .slice(0, MAX_WORKOUT_NOTES),
    },
    profile: profileContext(profile),
    recentTraining: recent.slice(0, 14).map((w) => ({
      daysAgo: daysBetween(w.date, workout.date),
      title: w.title.slice(0, 80),
      focus: w.focus,
      workingSets: workingSets(w),
      mainExerciseIds: mainEntries(w)
        .map((e) => e.exerciseId)
        .slice(0, MAX_IDS_PER_SESSION),
      conditioningMinutes: Math.min(600, toMinutes(conditioningSeconds(w))),
    })),
    weeklySetsByGroup: weeklySets(recovery),
    conditioningMinutesLast7: Math.min(3000, toMinutes(recent.reduce((s, w) => s + conditioningSeconds(w), 0))),
  }
}

type SlotContext = CoachRequest["workout"]["exercises"][number]

function slotContext(slot: WorkoutExercise, workout: Workout, input: EngineInput, history: readonly CompletedWorkout[]): SlotContext {
  const codes = engineNoteCodes(slot.note).slice(0, MAX_NOTE_CODES)
  const last = slot.phase === "main" ? lastSessionOf(slot.exerciseId, history, input.progress, workout.date) : null
  return {
    slotId: slot.slotId,
    exerciseId: slot.exerciseId,
    phase: slot.phase,
    role: slot.role,
    sets: slot.sets,
    reps: slot.reps,
    durationSeconds: slot.durationSeconds,
    restSeconds: slot.restSeconds,
    tempo: slot.tempo,
    rir: slot.rir,
    recommendedWeightKg: slot.recommendedWeightKg,
    weightSource: slot.recommendedWeightKg != null ? (slot.weightSource ?? "history") : null,
    ...alternativesFor(workout, slot.slotId, input),
    // The leading code for older servers; every sentence's code for newer ones (R23).
    engineNote: engineNoteCode(slot.note),
    ...(codes.length > 0 ? { engineNotes: codes } : {}),
    ...(last ? { lastSession: last } : {}),
  }
}

/** Engine-vetted alternatives, and which of them restore a planned lift over the weekly cap. */
function alternativesFor(workout: Workout, slotId: string, input: EngineInput): { alternatives: string[]; overCapAlternatives?: string[] } {
  try {
    const candidates = replacementCandidates(workout, slotId, input, ALTERNATIVES_PER_SLOT)
    const overCap = candidates.filter((c) => c.overCap).map((c) => c.exerciseId)
    return { alternatives: candidates.map((c) => c.exerciseId), ...(overCap.length > 0 ? { overCapAlternatives: overCap } : {}) }
  } catch {
    return { alternatives: [] }
  }
}

interface LoggedSession {
  workoutId: string
  date: string
  /** Completed sets only. */
  sets: SetLog[]
  prescribedReps: [number, number] | null
  prescribedDurationSeconds: number | null
}

const byDateDesc = (a: { date: string }, b: { date: string }) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)

/**
 * Every completed session of an exercise on or before `day`, newest first: the history the device
 * sends (with the prescription at the time), then older sessions from the progress map (sets only),
 * the same sources the engine's lastPerformance reads.
 */
function loggedSessions(
  exerciseId: string,
  history: readonly CompletedWorkout[],
  progress: Record<string, ExerciseProgress>,
  day: string,
): LoggedSession[] {
  const out = new Map<string, LoggedSession>()
  for (const w of history) {
    if (w.date > day || out.has(w.id)) continue
    const entry = w.exercises.find((e) => e.exerciseId === exerciseId && e.status === "completed" && e.sets.some((s) => s.completed))
    if (!entry) continue
    out.set(w.id, {
      workoutId: w.id,
      date: w.date,
      sets: entry.sets.filter((s) => s.completed),
      prescribedReps: entry.prescribedReps,
      prescribedDurationSeconds: entry.prescribedDurationSeconds,
    })
  }
  for (const session of progress[exerciseId]?.recentSessions ?? []) {
    if (session.date > day || out.has(session.workoutId)) continue
    const sets = session.sets.filter((s) => s.completed)
    if (sets.length > 0) out.set(session.workoutId, { workoutId: session.workoutId, date: session.date, sets, prescribedReps: null, prescribedDurationSeconds: null })
  }
  return [...out.values()].sort(byDateDesc)
}

/**
 * The session's working load: its heaviest logged set (for an assisted lift, the least assistance),
 * or null when no set logged a load. A logged 0 is no load.
 */
function workingLoadKg(sets: readonly SetLog[]): number | null {
  const loads = sets.map((s) => s.weightKg).filter((w): w is number => w != null && Number.isFinite(w) && w !== 0)
  return loads.length > 0 ? Math.max(...loads) : null
}

const SAME_LOAD_KG = 0.01

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

function loggedSet(s: SetLog): CoachLastSession["sets"][number] {
  const rpe = s.rpe != null && s.rpe >= 1 && s.rpe <= 10 ? Math.round(s.rpe * 2) / 2 : null
  return {
    weightKg: s.weightKg != null && Number.isFinite(s.weightKg) ? Math.min(500, Math.max(-500, Math.round(s.weightKg * 100) / 100)) : null,
    reps: s.reps != null && Number.isFinite(s.reps) ? clampInt(s.reps, 0, 100) : null,
    ...(s.durationSeconds != null && Number.isFinite(s.durationSeconds) ? { durationSeconds: clampInt(s.durationSeconds, 0, 3600) } : {}),
    ...(rpe != null ? { rpe } : {}),
  }
}

function validWindow(reps: [number, number] | null): [number, number] | null {
  if (!reps) return null
  const [lo, hi] = reps
  return Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1 && hi <= 100 && lo <= hi ? [lo, hi] : null
}

/**
 * The last completed session of a main slot's exercise (coach round 2, R23): the prescription then,
 * each completed set's load and reps (RPE when logged), and how many sessions in a row, newest
 * first, were logged at that same working load. Null without history.
 */
export function lastSessionOf(
  exerciseId: string,
  history: readonly CompletedWorkout[],
  progress: Record<string, ExerciseProgress>,
  day: string,
): CoachLastSession | null {
  const sessions = loggedSessions(exerciseId, history, progress, day)
  const last = sessions[0]
  if (!last) return null
  const load = workingLoadKg(last.sets)
  let same = 0
  if (load !== null) {
    for (const s of sessions) {
      const l = workingLoadKg(s.sets)
      if (l === null || Math.abs(l - load) > SAME_LOAD_KG) break
      same++
    }
  }
  const duration = last.prescribedDurationSeconds
  return {
    daysAgo: clampInt(daysBetween(last.date, day), 0, MAX_DAYS_AGO),
    prescribedReps: validWindow(last.prescribedReps),
    prescribedDurationSeconds: duration != null && Number.isFinite(duration) && duration >= 1 ? clampInt(duration, 1, 3600) : null,
    sets: last.sets.slice(0, MAX_LOGGED_SETS).map(loggedSet),
    ...(same > 0 ? { sameLoadSessions: Math.min(MAX_SAME_LOAD_SESSIONS, same) } : {}),
  }
}

function profileContext(p: UserProfile): CoachRequest["profile"] {
  return {
    goal: p.goal,
    experience: p.experience,
    gender: p.gender,
    weightKg: Math.round(p.weightKg * 10) / 10,
    trainingDaysPerWeek: p.trainingDaysPerWeek,
    durationPreferenceMinutes: p.durationPreferenceMinutes,
    equipment: p.equipment,
    limitations: p.limitations,
  }
}

function mainEntries(w: CompletedWorkout): CompletedExercise[] {
  return w.exercises.filter((ex) => ex.phase === "main" && ex.status === "completed")
}

/**
 * Conditioning is time, not a muscle group's working sets: finishers (the engine never counts
 * them as direct volume) and cardio work.
 */
function isConditioning(ex: CompletedExercise): boolean {
  if (ex.role === "finisher") return true
  const exercise = getExercise(ex.exerciseId)
  return !!exercise && muscleGroupOf(exercise) === "cardio"
}

function workingSets(w: CompletedWorkout): number {
  let n = 0
  for (const ex of mainEntries(w)) {
    if (isConditioning(ex)) continue
    n += ex.sets.filter((s) => s.completed).length
  }
  return Math.min(200, n)
}

/** Seconds of conditioning work: logged durations, or reps at the engine's default rep time. */
function conditioningSeconds(w: CompletedWorkout): number {
  let seconds = 0
  for (const ex of mainEntries(w)) {
    if (!isConditioning(ex)) continue
    for (const s of ex.sets) {
      if (!s.completed) continue
      seconds += s.durationSeconds ?? (s.reps ?? 0) * SECONDS_PER_REP
    }
  }
  return seconds
}

function toMinutes(seconds: number): number {
  return Math.max(0, Math.round(seconds / 60))
}

/** computeRecovery().setsLast7 for every group with sets, without the cardio "group". */
function weeklySets(recovery: RecoveryMap): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [group, rec] of Object.entries(recovery)) {
    if (group === "cardio" || rec.setsLast7 <= 0) continue
    out[group] = Math.min(200, rec.setsLast7)
  }
  return out
}

/**
 * Stable key for a workout plan: a review applies to exactly this list of slots and prescriptions.
 * Any change (regenerate, manual swap, prescription edit) produces a different key.
 */
export function workoutReviewKey(workout: Workout): string {
  const parts = workout.exercises.map((e) =>
    [e.slotId, e.exerciseId, e.sets, e.reps?.join("-") ?? "", e.durationSeconds ?? "", e.restSeconds, e.rir ?? ""].join(":"),
  )
  let hash = 2166136261
  const text = `${workout.id}|${parts.join("|")}`
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${workout.id}:${(hash >>> 0).toString(36)}`
}
