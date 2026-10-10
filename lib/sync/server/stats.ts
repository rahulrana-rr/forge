/**
 * Pure aggregation helpers for per-exercise progress. No I/O, so they are unit-tested directly.
 */
import type { ExerciseSession, SetLog } from "@/lib/domain/types"

/* ------------------------------------------------------------------ */
/* Bests                                                               */
/* ------------------------------------------------------------------ */

export interface PerformanceStatsRow {
  workoutId: string
  weightKg: number | null
  reps: number | null
  completedAt: Date
}

export interface ProgressStats {
  bestWeightKg: number | null
  bestReps: number | null
  /** Best single-set volume, weight * reps. */
  bestVolumeKg: number | null
  /** Best estimated 1RM (Epley). */
  bestE1rmKg: number | null
  /** Distinct workouts containing at least one logged set. */
  timesPerformed: number
  lastPerformedAt: Date | null
}

/** Epley estimate: w * (1 + reps / 30). */
export function epleyE1rm(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function maxOf(current: number | null, candidate: number): number {
  return current == null || candidate > current ? candidate : current
}

/** Returns null when there are no rows (the progress record should then be removed). */
export function computeProgressStats(
  rows: readonly PerformanceStatsRow[]
): ProgressStats | null {
  if (rows.length === 0) return null

  let bestWeightKg: number | null = null
  let bestReps: number | null = null
  let bestVolumeKg: number | null = null
  let bestE1rmKg: number | null = null
  let lastPerformedAt: Date | null = null
  const workouts = new Set<string>()

  for (const row of rows) {
    workouts.add(row.workoutId)
    if (lastPerformedAt == null || row.completedAt > lastPerformedAt)
      lastPerformedAt = row.completedAt

    // Assistance is logged as a negative weight; it is not a "best weight".
    const weight =
      row.weightKg != null && row.weightKg > 0 ? row.weightKg : null
    const reps = row.reps != null && row.reps > 0 ? row.reps : null
    if (weight != null) bestWeightKg = maxOf(bestWeightKg, weight)
    if (reps != null) bestReps = maxOf(bestReps, reps)
    if (weight != null && reps != null) {
      bestVolumeKg = maxOf(bestVolumeKg, round2(weight * reps))
      bestE1rmKg = maxOf(bestE1rmKg, round2(epleyE1rm(weight, reps)))
    }
  }

  return {
    bestWeightKg,
    bestReps,
    bestVolumeKg,
    bestE1rmKg,
    timesPerformed: workouts.size,
    lastPerformedAt,
  }
}

/* ------------------------------------------------------------------ */
/* Recent sessions                                                     */
/* ------------------------------------------------------------------ */

/** One logged set of a recent session, as returned by the recent-sessions query (already ordered). */
export interface SessionSetRow {
  exerciseId: string
  workoutId: string
  date: string
  setNumber: number
  weightKg: number | null
  reps: number | null
  durationSeconds: number | null
  rpe: number | null
}

/**
 * Groups ordered rows (by exercise, newest session first, then set order) into up to `limit`
 * sessions per exercise.
 */
export function groupRecentSessions(
  rows: readonly SessionSetRow[],
  limit = 5
): Map<string, ExerciseSession[]> {
  const byExercise = new Map<string, ExerciseSession[]>()
  for (const row of rows) {
    let sessions = byExercise.get(row.exerciseId)
    if (!sessions) {
      sessions = []
      byExercise.set(row.exerciseId, sessions)
    }
    let session = sessions.find((s) => s.workoutId === row.workoutId)
    if (!session) {
      if (sessions.length >= limit) continue
      session = { workoutId: row.workoutId, date: row.date, sets: [] }
      sessions.push(session)
    }
    const set: SetLog = {
      setNumber: row.setNumber,
      weightKg: row.weightKg,
      reps: row.reps,
      durationSeconds: row.durationSeconds,
      rpe: row.rpe,
      completed: true,
    }
    session.sets.push(set)
  }
  return byExercise
}
