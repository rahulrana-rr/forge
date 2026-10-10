/**
 * Pure progress maths: totals, personal records, per-exercise progress, streaks and weekly
 * volume. No I/O, no Date.now(); every function takes the timestamps it needs.
 *
 * Weights are kilograms throughout. "Loaded" sets are completed sets with a positive weight and
 * at least one rep (external load, or bodyweight with added load). Assisted sets carry a negative
 * weight and timed sets carry no reps, so neither is eligible for load-based records.
 */
import type {
  CompletedExercise,
  CompletedWorkout,
  ExerciseProgress,
  ExerciseSession,
  PersonalRecord,
  SetLog,
  StreakInfo,
  WorkoutTotals,
} from "./types"
import { addDays, daysBetween, parseDateKey, dateKey } from "@/lib/dates"

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Epley estimated one-rep max: w × (1 + reps / 30). A single rep is the lift itself. */
export function epley1rm(weightKg: number, reps: number): number {
  if (!(weightKg > 0) || !(reps > 0)) return 0
  if (reps === 1) return weightKg
  return round1(weightKg * (1 + reps / 30))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function isLoadedSet(
  set: SetLog
): set is SetLog & { weightKg: number; reps: number } {
  return (
    set.completed &&
    set.weightKg != null &&
    set.weightKg > 0 &&
    set.reps != null &&
    set.reps > 0
  )
}

function completedSets(sets: SetLog[]): SetLog[] {
  return sets.filter((s) => s.completed)
}

function maxOrNull(values: number[]): number | null {
  return values.length ? Math.max(...values) : null
}

interface SessionBests {
  weight: number | null
  reps: number | null
  volume: number | null
  e1rm: number | null
}

function sessionBests(sets: SetLog[]): SessionBests {
  const loaded = sets.filter(isLoadedSet)
  const done = completedSets(sets)
  return {
    weight: maxOrNull(loaded.map((s) => s.weightKg)),
    reps: maxOrNull(
      done.flatMap((s) => (s.reps != null && s.reps > 0 ? [s.reps] : []))
    ),
    volume: maxOrNull(loaded.map((s) => round1(s.weightKg * s.reps))),
    e1rm: maxOrNull(loaded.map((s) => epley1rm(s.weightKg, s.reps))),
  }
}

/* ------------------------------------------------------------------ */
/* Totals                                                              */
/* ------------------------------------------------------------------ */

export interface CalorieInputs {
  /** Body weight in kg; null/undefined means unknown → no estimate. */
  weightKg?: number | null
  /** Active workout seconds. */
  durationSeconds?: number | null
}

/**
 * Rough calorie estimate for resistance training, clearly a heuristic: roughly 6 METs, i.e.
 * minutes × bodyweightKg × 0.1. Returns null when the body weight or duration is unknown.
 */
export function estimateCalories(
  weightKg: number | null | undefined,
  durationSeconds: number | null | undefined
): number | null {
  if (weightKg == null || !(weightKg > 0)) return null
  if (durationSeconds == null || !(durationSeconds >= 0)) return null
  return Math.round((durationSeconds / 60) * weightKg * 0.1)
}

export function computeTotals(
  exercises: CompletedExercise[],
  calories: CalorieInputs = {}
): WorkoutTotals {
  let exercisesCompleted = 0
  let exercisesSkipped = 0
  let sets = 0
  let reps = 0
  let volumeKg = 0
  // Totals describe the training itself: warm-up and cool-down items are not working sets.
  for (const ex of exercises) {
    if (ex.phase !== "main") continue
    if (ex.status === "completed") exercisesCompleted += 1
    else if (ex.status === "skipped") exercisesSkipped += 1
    for (const set of ex.sets) {
      if (!set.completed) continue
      sets += 1
      if (set.reps != null && set.reps > 0) reps += set.reps
      if (isLoadedSet(set)) volumeKg += set.weightKg * set.reps
    }
  }
  return {
    exercisesCompleted,
    exercisesSkipped,
    sets,
    reps,
    volumeKg: round1(volumeKg),
    caloriesEstimate: estimateCalories(
      calories.weightKg,
      calories.durationSeconds
    ),
  }
}

/* ------------------------------------------------------------------ */
/* Personal records                                                    */
/* ------------------------------------------------------------------ */

/**
 * Groups completed main-phase exercises by id, concatenating their sets (an exercise may fill two
 * slots). Warm-up and cool-down items are preparation, not training, so they never feed progress
 * or personal records.
 */
function groupCompleted(exercises: CompletedExercise[]): Map<string, SetLog[]> {
  const map = new Map<string, SetLog[]>()
  for (const ex of exercises) {
    if (ex.status !== "completed" || ex.phase !== "main") continue
    const done = completedSets(ex.sets)
    if (!done.length) continue
    const existing = map.get(ex.exerciseId)
    if (existing) existing.push(...done)
    else map.set(ex.exerciseId, [...done])
  }
  return map
}

/** Highest reps logged at exactly `weightKg` across the known recent sessions; null when never seen. */
function recentRepsAtWeight(
  progress: ExerciseProgress,
  weightKg: number
): number | null {
  let best: number | null = null
  for (const session of progress.recentSessions) {
    for (const set of session.sets) {
      if (isLoadedSet(set) && set.weightKg === weightKg)
        best = Math.max(best ?? 0, set.reps)
    }
  }
  return best
}

/**
 * Most reps ever logged at the standing best weight. Uses the all-time `repsAtBestWeight` when the
 * progress carries it; older progress without it falls back to the recent sessions.
 */
function repsAtBestWeight(progress: ExerciseProgress): number | null {
  if (progress.bestWeightKg == null) return null
  return (
    progress.repsAtBestWeight ??
    recentRepsAtWeight(progress, progress.bestWeightKg)
  )
}

/**
 * Records set this session versus the progress *before* it. The first-ever session of an
 * exercise never produces a record; it seeds the baseline instead.
 *
 * - weight: heaviest loaded set beats bestWeightKg
 * - e1rm: best Epley estimate beats bestE1rmKg
 * - volume: best single-set weight × reps beats bestVolumeKg
 * - reps_at_weight: more reps at the standing best weight than any set ever logged at that weight
 *   (only when the weight record itself was not beaten)
 */
export function detectPersonalRecords(
  exercises: CompletedExercise[],
  previousProgress: Record<string, ExerciseProgress>,
  achievedAt: string
): PersonalRecord[] {
  const records: PersonalRecord[] = []
  for (const [exerciseId, sets] of groupCompleted(exercises)) {
    const prev = previousProgress[exerciseId]
    if (!prev || prev.timesPerformed === 0) continue
    const loaded = sets.filter(isLoadedSet)
    if (!loaded.length) continue
    const bests = sessionBests(loaded)

    let weightBeaten = false
    if (
      bests.weight != null &&
      prev.bestWeightKg != null &&
      bests.weight > prev.bestWeightKg
    ) {
      weightBeaten = true
      const set = loaded.find((s) => s.weightKg === bests.weight)
      records.push({
        exerciseId,
        kind: "weight",
        value: bests.weight,
        weightKg: bests.weight,
        reps: set?.reps ?? null,
        previousValue: prev.bestWeightKg,
        achievedAt,
      })
    }

    if (!weightBeaten && prev.bestWeightKg != null) {
      const atBest = loaded.filter((s) => s.weightKg === prev.bestWeightKg)
      const previousReps = repsAtBestWeight(prev)
      const sessionReps = maxOrNull(atBest.map((s) => s.reps))
      if (
        sessionReps != null &&
        previousReps != null &&
        sessionReps > previousReps
      ) {
        records.push({
          exerciseId,
          kind: "reps_at_weight",
          value: sessionReps,
          weightKg: prev.bestWeightKg,
          reps: sessionReps,
          previousValue: previousReps,
          achievedAt,
        })
      }
    }

    if (
      bests.e1rm != null &&
      prev.bestE1rmKg != null &&
      bests.e1rm > prev.bestE1rmKg
    ) {
      const set = loaded.find(
        (s) => epley1rm(s.weightKg, s.reps) === bests.e1rm
      )
      records.push({
        exerciseId,
        kind: "e1rm",
        value: bests.e1rm,
        weightKg: set?.weightKg ?? null,
        reps: set?.reps ?? null,
        previousValue: prev.bestE1rmKg,
        achievedAt,
      })
    }

    if (
      bests.volume != null &&
      prev.bestVolumeKg != null &&
      bests.volume > prev.bestVolumeKg
    ) {
      const set = loaded.find(
        (s) => round1(s.weightKg * s.reps) === bests.volume
      )
      records.push({
        exerciseId,
        kind: "volume",
        value: bests.volume,
        weightKg: set?.weightKg ?? null,
        reps: set?.reps ?? null,
        previousValue: prev.bestVolumeKg,
        achievedAt,
      })
    }
  }
  return records
}

/* ------------------------------------------------------------------ */
/* Per-exercise progress                                               */
/* ------------------------------------------------------------------ */

export const RECENT_SESSIONS_CAP = 5

function emptyProgress(exerciseId: string, at: string): ExerciseProgress {
  return {
    exerciseId,
    bestWeightKg: null,
    repsAtBestWeight: null,
    bestReps: null,
    bestVolumeKg: null,
    bestE1rmKg: null,
    timesPerformed: 0,
    lastPerformedAt: null,
    recentSessions: [],
    updatedAt: at,
  }
}

function better(prev: number | null, next: number | null): number | null {
  if (prev == null) return next
  if (next == null) return prev
  return Math.max(prev, next)
}

/**
 * Most reps at `bestWeightKg` after folding in `sets`: a new heavier best starts over from this
 * session, an equal best keeps the higher count. Independent of the order sessions are folded in.
 */
function foldRepsAtBest(
  prev: ExerciseProgress,
  sets: SetLog[],
  bestWeightKg: number | null
): number | null {
  if (bestWeightKg == null) return null
  const session = maxOrNull(
    sets
      .filter(isLoadedSet)
      .filter((s) => s.weightKg === bestWeightKg)
      .map((s) => s.reps)
  )
  if (prev.bestWeightKg == null || bestWeightKg > prev.bestWeightKg)
    return session
  const before = repsAtBestWeight(prev)
  if (before == null) return session
  return session == null ? before : Math.max(before, session)
}

/** Folds one completed workout into the progress map. Returns a new map; never mutates. */
export function applyWorkoutToProgress(
  progress: Record<string, ExerciseProgress>,
  workout: CompletedWorkout
): Record<string, ExerciseProgress> {
  const grouped = groupCompleted(workout.exercises)
  if (!grouped.size) return progress
  const next: Record<string, ExerciseProgress> = { ...progress }
  for (const [exerciseId, sets] of grouped) {
    const prev =
      next[exerciseId] ?? emptyProgress(exerciseId, workout.completedAt)
    const bests = sessionBests(sets)
    const session: ExerciseSession = {
      workoutId: workout.id,
      date: workout.date,
      sets,
    }
    const recent = [
      session,
      ...prev.recentSessions.filter((s) => s.workoutId !== workout.id),
    ]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, RECENT_SESSIONS_CAP)
    const bestWeightKg = better(prev.bestWeightKg, bests.weight)
    next[exerciseId] = {
      exerciseId,
      bestWeightKg,
      repsAtBestWeight: foldRepsAtBest(prev, sets, bestWeightKg),
      bestReps: better(prev.bestReps, bests.reps),
      bestVolumeKg: better(prev.bestVolumeKg, bests.volume),
      bestE1rmKg: better(prev.bestE1rmKg, bests.e1rm),
      timesPerformed: prev.timesPerformed + 1,
      lastPerformedAt:
        prev.lastPerformedAt && prev.lastPerformedAt > workout.completedAt
          ? prev.lastPerformedAt
          : workout.completedAt,
      recentSessions: recent,
      updatedAt: workout.completedAt,
    }
  }
  return next
}

/** Recomputes progress from scratch, applying workouts oldest → newest. */
export function rebuildProgress(
  workouts: CompletedWorkout[]
): Record<string, ExerciseProgress> {
  const ordered = [...workouts].sort((a, b) =>
    a.completedAt < b.completedAt ? -1 : a.completedAt > b.completedAt ? 1 : 0
  )
  let progress: Record<string, ExerciseProgress> = {}
  for (const w of ordered) progress = applyWorkoutToProgress(progress, w)
  return progress
}

/* ------------------------------------------------------------------ */
/* Streaks                                                             */
/* ------------------------------------------------------------------ */

/** Max calendar-day gap between two sessions that keeps a streak alive (one rest day). */
export const STREAK_MAX_GAP_DAYS = 2

/**
 * Longest gap (in calendar days) between sessions that keeps a streak alive for a plan of
 * `trainingDaysPerWeek` sessions a week: 8 − N, the largest gap any fixed weekly schedule of N
 * sessions has (all N on consecutive days, then the rest of the week off). So Mon/Wed/Fri (gap 3)
 * or a Sat/Sun-only 2-day plan (gap 6) keeps its streak, while missing a whole week still breaks
 * it. Never tighter than {@link STREAK_MAX_GAP_DAYS}, which is also the value without a plan.
 */
export function streakMaxGapDays(trainingDaysPerWeek?: number | null): number {
  if (trainingDaysPerWeek == null || !(trainingDaysPerWeek > 0))
    return STREAK_MAX_GAP_DAYS
  return Math.max(STREAK_MAX_GAP_DAYS, 8 - Math.floor(trainingDaysPerWeek))
}

/**
 * A streak is a run of training days where each gap to the next session is at most
 * {@link streakMaxGapDays} days (two, i.e. one rest day, when no plan is given). The current
 * streak only counts while the last session is no further back than that gap.
 */
export function computeStreak(
  workouts: CompletedWorkout[],
  today: string,
  trainingDaysPerWeek?: number | null
): StreakInfo {
  const maxGap = streakMaxGapDays(trainingDaysPerWeek)
  const days = Array.from(new Set(workouts.map((w) => w.date))).sort()
  const weekAgo = addDays(today, -6)
  const lastSevenDays = days
    .filter((d) => d >= weekAgo && d <= today)
    .sort((a, b) => (a < b ? 1 : -1))

  let longest = 0
  let run = 0
  let prev: string | null = null
  for (const day of days) {
    run = prev && daysBetween(prev, day) <= maxGap ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = day
  }

  const last = days[days.length - 1]
  const current =
    last && daysBetween(last, today) <= maxGap && daysBetween(last, today) >= 0
      ? run
      : 0

  return { current, longest, lastSevenDays }
}

/* ------------------------------------------------------------------ */
/* Weekly volume                                                       */
/* ------------------------------------------------------------------ */

export interface WeeklyVolume {
  /** Monday of the week, as a date key. */
  weekStart: string
  /** Sunday of the week, as a date key. */
  weekEnd: string
  workouts: number
  sets: number
  reps: number
  volumeKg: number
  durationSeconds: number
}

/** Monday-based start of the week containing `key`. */
export function weekStartKey(key: string): string {
  const d = parseDateKey(key)
  const offset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - offset)
  return dateKey(d)
}

/**
 * Per-week totals for the last `weeks` weeks ending with the week containing `today`,
 * oldest first, including empty weeks.
 */
export function weeklyVolume(
  workouts: CompletedWorkout[],
  weeks: number,
  today: string
): WeeklyVolume[] {
  const count = Math.max(0, Math.floor(weeks))
  if (count === 0) return []
  const thisWeek = weekStartKey(today)
  const buckets: WeeklyVolume[] = []
  const index = new Map<string, WeeklyVolume>()
  for (let i = count - 1; i >= 0; i--) {
    const weekStart = addDays(thisWeek, -7 * i)
    const bucket: WeeklyVolume = {
      weekStart,
      weekEnd: addDays(weekStart, 6),
      workouts: 0,
      sets: 0,
      reps: 0,
      volumeKg: 0,
      durationSeconds: 0,
    }
    buckets.push(bucket)
    index.set(weekStart, bucket)
  }
  for (const w of workouts) {
    const bucket = index.get(weekStartKey(w.date))
    if (!bucket) continue
    bucket.workouts += 1
    bucket.sets += w.totals.sets
    bucket.reps += w.totals.reps
    bucket.volumeKg = round1(bucket.volumeKg + w.totals.volumeKg)
    bucket.durationSeconds += w.durationSeconds
  }
  return buckets
}
