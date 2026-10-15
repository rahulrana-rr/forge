/**
 * User-facing domain types shared by the engine, stores, UI and sync layer.
 * Weights are ALWAYS stored in kilograms. Convert at the UI edge with lib/units.ts.
 * Dates: `date` fields are local calendar keys "YYYY-MM-DD" (lib/dates.ts); timestamps are ISO strings.
 */
import type { BodyArea, Equipment, Goal, Difficulty, MuscleGroup } from "@/lib/exercises/types"

export type Gender = "male" | "female" | "unspecified"
export type Experience = Difficulty
export type TrainingDays = 2 | 3 | 4 | 5 | 6
export type EquipmentPreset = "full_gym" | "dumbbells" | "home_gym" | "bodyweight" | "custom"
export type Units = "kg" | "lb"
export type DurationPreference = 30 | 45 | 60 | 75

export interface UserProfile {
  /** Local id (uuid). When signed in, the server profile is keyed by the auth user id instead. */
  id: string
  goal: Goal
  gender: Gender
  weightKg: number
  experience: Experience
  trainingDaysPerWeek: TrainingDays
  equipmentPreset: EquipmentPreset
  /** Resolved equipment the user actually has. For presets this is derived (see EQUIPMENT_PRESETS). */
  equipment: Equipment[]
  durationPreferenceMinutes: DurationPreference
  units: Units
  /** Body areas to protect; exercises whose `contraindications` include any of these are excluded. */
  limitations: BodyArea[]
  /** Exercise ids the user never wants to see. */
  excludedExerciseIds: string[]
  /** Exercise ids the user likes; the engine prefers them when they fit the slot. */
  preferredExerciseIds: string[]
  name?: string
  createdAt: string
  updatedAt: string
}

export const EQUIPMENT_PRESETS: Record<Exclude<EquipmentPreset, "custom">, Equipment[]> = {
  full_gym: [
    "barbell", "dumbbell", "kettlebell", "cable", "machine", "smith_machine", "bodyweight", "band",
    "pull_up_bar", "bench", "box", "medicine_ball", "foam_roller", "cardio_machine", "trap_bar",
    "ez_bar", "dip_station", "landmine", "ab_wheel", "jump_rope", "sled", "rack",
  ],
  dumbbells: ["dumbbell", "bodyweight", "bench"],
  // A home gym with a barbell is assumed to have a rack or squat stands; without one, pick "custom".
  home_gym: ["barbell", "dumbbell", "kettlebell", "bodyweight", "band", "pull_up_bar", "bench", "jump_rope", "rack"],
  bodyweight: ["bodyweight", "pull_up_bar", "jump_rope"],
}

/** One logged set. For timed work, `durationSeconds` is set and `reps` is null. */
export interface SetLog {
  setNumber: number
  /** Kilograms. null for pure bodyweight / timed sets. For "assisted" load type, assistance weight as a negative number. */
  weightKg: number | null
  reps: number | null
  durationSeconds?: number | null
  /** Rate of perceived exertion 1-10, optional. */
  rpe?: number | null
  completed: boolean
}

export type ExerciseLogStatus = "pending" | "completed" | "skipped" | "replaced"

export interface ExerciseLog {
  slotId: string
  exerciseId: string
  status: ExerciseLogStatus
  sets: SetLog[]
  completedAt?: string
  /** When status is "replaced": the slotId/exerciseId that took its place. */
  replacedByExerciseId?: string
  /**
   * Every exercise id this slot has held so far (original first). Lets "swipe left" exclude
   * exercises already tried for the slot. Optional; absent means only the current exercise.
   */
  triedExerciseIds?: string[]
}

export interface CompletedExercise {
  slotId: string
  exerciseId: string
  role: WorkoutRole
  phase: WorkoutPhase
  status: Exclude<ExerciseLogStatus, "pending">
  sets: SetLog[]
  /** The planned prescription at the time, for history display. */
  prescribedSets: number
  prescribedReps: [number, number] | null
  prescribedDurationSeconds: number | null
  recommendedWeightKg: number | null
  /**
   * Where the card's recommended load came from (WorkoutExercise.weightSource). Optional: absent
   * on workouts logged before it existed. Progression treats a session logged from an "estimate"
   * as a calibration session.
   */
  weightSource?: "history" | "estimate" | "user" | null
  /**
   * Tempo prescribed at the time (a slower lowering earned at the rep ceiling carries over).
   * Optional: absent on workouts logged before it existed (coach round 2, R12).
   */
  prescribedTempo?: string | null
  /**
   * Rest between sets prescribed at the time (a conditioning block's shortened rest carries over).
   * Optional: absent on workouts logged before it existed (coach round 2, R12).
   */
  prescribedRestSeconds?: number | null
  /**
   * A harder variation the card suggested (WorkoutExercise.suggestedExerciseId): the lift had
   * outgrown itself, so it no longer holds its slot for consistency. Optional (coach round 2, R12).
   */
  suggestedExerciseId?: string | null
  /**
   * The exercise the plan put in this slot before any swap (WorkoutExercise.replacedFromExerciseId,
   * else the exercise itself). Lets the weekly review tell a substitution from the plan. Optional:
   * absent on workouts logged before it existed.
   */
  plannedExerciseId?: string | null
}

/** Which assigned-program day a completed workout was (Workout.program at completion). */
export interface CompletedWorkoutProgram {
  /** Program id (lib/programs registry). */
  id: string
  dayKey: string
  week: number
  /** The assignment's start date ("YYYY-MM-DD"). */
  startDate: string
  /** The coach-approved plan revision the day followed; null = the program as assigned. */
  revisionId: string | null
}

export type WorkoutPhase = "warmup" | "main" | "cooldown"

export type WorkoutRole =
  | "warmup"
  | "primary_compound"
  | "secondary_compound"
  | "accessory"
  | "isolation"
  | "finisher"
  | "cooldown"

export type SplitDay =
  | "push"
  | "pull"
  | "legs"
  | "upper"
  | "lower"
  | "full_body"
  | "chest_triceps"
  | "back_biceps"
  | "shoulders_arms"
  | "arms"
  | "conditioning"

export interface WorkoutTotals {
  exercisesCompleted: number
  exercisesSkipped: number
  sets: number
  reps: number
  /** Sum of weightKg * reps over completed external-load sets. */
  volumeKg: number
  /** Optional, only when implemented; null means "not estimated". */
  caloriesEstimate: number | null
}

export type PersonalRecordKind = "weight" | "reps_at_weight" | "e1rm" | "volume"

export interface PersonalRecord {
  exerciseId: string
  kind: PersonalRecordKind
  value: number
  /** Supporting detail, e.g. weightKg and reps of the set. */
  weightKg?: number | null
  reps?: number | null
  previousValue?: number | null
  achievedAt: string
}

/** A finished workout, as persisted in local history and synced to the backend. */
export interface CompletedWorkout {
  /** Client-generated uuid; the backend upserts by this id (idempotent sync). */
  id: string
  date: string
  title: string
  split: SplitDay
  focus: MuscleGroup[]
  goal: Goal
  startedAt: string
  completedAt: string
  /** Active seconds, excluding paused time. */
  durationSeconds: number
  exercises: CompletedExercise[]
  totals: WorkoutTotals
  personalRecords: PersonalRecord[]
  /** Engine metadata for debugging/regeneration. */
  engineVersion: number
  /**
   * The assigned-program day this workout was, so the weekly review compares it with what was
   * prescribed. Absent for engine workouts and for workouts logged before it was recorded.
   */
  programDay?: CompletedWorkoutProgram | null
  /**
   * Whether the backend has this workout. (Completed workouts with zero completed main-phase
   * exercises are not saved: warm-up drills and stretches alone are not a workout.)
   */
  synced: boolean
}

export interface ExerciseProgress {
  exerciseId: string
  bestWeightKg: number | null
  /**
   * Most reps logged at exactly `bestWeightKg`, across all history (not only `recentSessions`).
   * Optional: absent on progress computed before it existed, in which case readers fall back to
   * scanning `recentSessions`.
   */
  repsAtBestWeight?: number | null
  bestReps: number | null
  /** Best single-set volume (weight * reps). */
  bestVolumeKg: number | null
  /** Best estimated 1RM (Epley: w * (1 + reps/30)). */
  bestE1rmKg: number | null
  timesPerformed: number
  lastPerformedAt: string | null
  /** Up to the last 5 sessions, newest first. */
  recentSessions: ExerciseSession[]
  updatedAt: string
}

export interface ExerciseSession {
  workoutId: string
  date: string
  sets: SetLog[]
}

export interface StreakInfo {
  current: number
  longest: number
  /** Date keys of the last 7 days with a completed workout. */
  lastSevenDays: string[]
}
