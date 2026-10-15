/**
 * Prisma rows <-> domain types (lib/domain/types.ts).
 *
 * String columns hold enum values that were validated by lib/sync/server/validation.ts on the
 * way in, so reading them back is a cast rather than a second parse.
 */
import type {
  CompletedExercise,
  CompletedWorkout,
  CompletedWorkoutProgram,
  DurationPreference,
  EquipmentPreset,
  ExerciseProgress,
  ExerciseSession,
  Experience,
  Gender,
  PersonalRecord,
  SplitDay,
  TrainingDays,
  Units,
  UserProfile,
  WorkoutTotals,
} from "@/lib/domain/types"
import type {
  BodyArea,
  Equipment,
  Goal,
  MuscleGroup,
} from "@/lib/exercises/types"
import type {
  Prisma,
  UserProfile as UserProfileRow,
  UserProgress as UserProgressRow,
  Workout as WorkoutRow,
} from "@/lib/generated/prisma/client"

import type {
  CompletedWorkoutInput,
  PutMeInput,
  SetLogInput,
} from "./validation"

/* ------------------------------------------------------------------ */
/* JSON columns                                                        */
/* ------------------------------------------------------------------ */

/** Validated client JSON going into a Json column. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

/** Json column coming back out; the column is authoritative for round-tripping what the client sent. */
function fromJson<T>(value: Prisma.JsonValue): T {
  return value as unknown as T
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export function profileRowToDomain(row: UserProfileRow): UserProfile {
  const profile: UserProfile = {
    id: row.userId,
    goal: row.goal as Goal,
    gender: row.gender as Gender,
    weightKg: row.weightKg,
    experience: row.experience as Experience,
    trainingDaysPerWeek: row.trainingDaysPerWeek as TrainingDays,
    equipmentPreset: row.equipmentPreset as EquipmentPreset,
    equipment: row.equipment as Equipment[],
    durationPreferenceMinutes:
      row.durationPreferenceMinutes as DurationPreference,
    units: row.units as Units,
    limitations: row.limitations as BodyArea[],
    excludedExerciseIds: row.excludedExerciseIds,
    preferredExerciseIds: row.preferredExerciseIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
  if (row.displayName) profile.name = row.displayName
  return profile
}

/** Columns shared by create and update; `userId`/`createdAt` are added by the caller. */
export function profileInputToColumns(input: PutMeInput, updatedAt: Date) {
  return {
    goal: input.goal,
    gender: input.gender,
    weightKg: input.weightKg,
    experience: input.experience,
    trainingDaysPerWeek: input.trainingDaysPerWeek,
    equipmentPreset: input.equipmentPreset,
    equipment: [...input.equipment],
    durationPreferenceMinutes: input.durationPreferenceMinutes,
    units: input.units,
    limitations: [...input.limitations],
    excludedExerciseIds: [...input.excludedExerciseIds],
    preferredExerciseIds: [...input.preferredExerciseIds],
    displayName: input.name?.trim() ? input.name.trim() : null,
    updatedAt,
  }
}

/* ------------------------------------------------------------------ */
/* Workouts                                                            */
/* ------------------------------------------------------------------ */

export function workoutRowToDomain(row: WorkoutRow): CompletedWorkout {
  return {
    id: row.id,
    date: row.date,
    title: row.title,
    split: row.split as SplitDay,
    focus: row.focus as MuscleGroup[],
    goal: row.goal as Goal,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt.toISOString(),
    durationSeconds: row.durationSeconds,
    exercises: fromJson<CompletedExercise[]>(row.exercises),
    totals: fromJson<WorkoutTotals>(row.totals),
    personalRecords: fromJson<PersonalRecord[]>(row.personalRecords),
    engineVersion: row.engineVersion,
    ...(row.programDay ? { programDay: fromJson<CompletedWorkoutProgram>(row.programDay) } : {}),
    synced: true,
  }
}

/** Columns shared by create and update; `id` is added by the caller. */
export function workoutInputToColumns(
  userId: string,
  input: CompletedWorkoutInput
) {
  return {
    userId,
    date: input.date,
    title: input.title,
    split: input.split,
    focus: [...input.focus],
    goal: input.goal,
    startedAt: new Date(input.startedAt),
    completedAt: new Date(input.completedAt),
    durationSeconds: Math.round(input.durationSeconds),
    completed: true,
    engineVersion: input.engineVersion,
    exercises: toJson(input.exercises),
    totals: toJson(input.totals),
    personalRecords: toJson(input.personalRecords),
    // Absent leaves the column as it is (null on create): older clients never send it.
    programDay: input.programDay ? toJson(input.programDay) : undefined,
  }
}

/* ------------------------------------------------------------------ */
/* Exercise performance (one row per logged set)                       */
/* ------------------------------------------------------------------ */

export interface PerformanceColumns {
  userId: string
  workoutId: string
  exerciseId: string
  setNumber: number
  weightKg: number | null
  reps: number | null
  durationSeconds: number | null
  rpe: number | null
  completedAt: Date
}

/** A set counts towards history/progress when it was completed with reps or time logged. */
export function isLoggableSet(set: SetLogInput): boolean {
  if (!set.completed) return false
  return (set.reps ?? 0) > 0 || (set.durationSeconds ?? 0) > 0
}

export function performanceRowsFromWorkout(
  userId: string,
  workout: CompletedWorkoutInput
): PerformanceColumns[] {
  const completedAt = new Date(workout.completedAt)
  const rows: PerformanceColumns[] = []
  for (const exercise of workout.exercises) {
    // Only completed main-phase work is performance: warm-up and cool-down items mirror the
    // client's progress rules and never feed bests or recent sessions.
    if (exercise.status !== "completed" || exercise.phase !== "main") continue
    for (const set of exercise.sets) {
      if (!isLoggableSet(set)) continue
      rows.push({
        userId,
        workoutId: workout.id,
        exerciseId: exercise.exerciseId,
        setNumber: set.setNumber,
        weightKg: set.weightKg,
        reps: set.reps,
        durationSeconds:
          set.durationSeconds == null ? null : Math.round(set.durationSeconds),
        rpe: set.rpe ?? null,
        completedAt,
      })
    }
  }
  return rows
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export function progressRowToDomain(
  row: UserProgressRow,
  recentSessions: ExerciseSession[]
): ExerciseProgress {
  return {
    exerciseId: row.exerciseId,
    bestWeightKg: row.bestWeightKg,
    bestReps: row.bestReps,
    bestVolumeKg: row.bestVolumeKg,
    bestE1rmKg: row.bestE1rmKg,
    timesPerformed: row.timesPerformed,
    lastPerformedAt: row.lastPerformedAt
      ? row.lastPerformedAt.toISOString()
      : null,
    recentSessions,
    updatedAt: row.updatedAt.toISOString(),
  }
}
