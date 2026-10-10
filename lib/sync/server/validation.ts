/**
 * zod v4 schemas for every request body the API accepts. Strict on shape, enum values and
 * numeric ranges.
 *
 * Unknown keys: objects that are stored verbatim in a JSON column (sets, exercises, totals,
 * personal records) use `z.object`, which STRIPS unknown keys, so a client cannot park arbitrary
 * data in the database. A new client field on those types must be added here to round-trip.
 * Top-level request objects stay `looseObject`: their extras never reach storage because the
 * mappers pick columns one by one.
 *
 * Integers that land in Postgres INTEGER columns are bounded well below int4 so an out-of-range
 * value is a per-record validation rejection, not a 500 that aborts the whole sync batch.
 */
import { z } from "zod"

import type {
  DurationPreference,
  EquipmentPreset,
  ExerciseLogStatus,
  Gender,
  PersonalRecordKind,
  SplitDay,
  TrainingDays,
  Units,
  WorkoutPhase,
  WorkoutRole,
} from "@/lib/domain/types"
import type {
  BodyArea,
  Difficulty,
  Equipment,
  Goal,
  MuscleGroup,
} from "@/lib/exercises/types"

/* ------------------------------------------------------------------ */
/* Exhaustive literal tuples                                           */
/* ------------------------------------------------------------------ */

/**
 * Compile-time guard: `literals<Union>()([...])` only type-checks when the tuple contains every
 * member of `Union` and nothing else, so a contract change cannot silently desync validation.
 */
type Covers<Union, Tuple extends readonly unknown[]> = [
  Exclude<Union, Tuple[number]>,
] extends [never]
  ? unknown
  : never

function literals<Union extends string | number>() {
  return <const Tuple extends readonly Union[]>(
    values: Tuple & Covers<Union, Tuple>
  ): Tuple => values
}

export const GOALS = literals<Goal>()([
  "muscle_gain",
  "strength",
  "fat_loss",
  "general_fitness",
  "endurance",
])
export const GENDERS = literals<Gender>()(["male", "female", "unspecified"])
export const DIFFICULTIES = literals<Difficulty>()([
  "beginner",
  "intermediate",
  "advanced",
])
export const TRAINING_DAYS = literals<TrainingDays>()([2, 3, 4, 5, 6])
export const EQUIPMENT_PRESETS = literals<EquipmentPreset>()([
  "full_gym",
  "dumbbells",
  "home_gym",
  "bodyweight",
  "custom",
])
export const DURATION_PREFERENCES = literals<DurationPreference>()([
  30, 45, 60, 75,
])
export const UNITS = literals<Units>()(["kg", "lb"])
export const EQUIPMENT = literals<Equipment>()([
  "barbell",
  "dumbbell",
  "kettlebell",
  "cable",
  "machine",
  "smith_machine",
  "bodyweight",
  "band",
  "pull_up_bar",
  "bench",
  "box",
  "medicine_ball",
  "foam_roller",
  "cardio_machine",
  "trap_bar",
  "ez_bar",
  "dip_station",
  "landmine",
  "suspension",
  "ab_wheel",
  "jump_rope",
  "sled",
  "rack",
])
export const BODY_AREAS = literals<BodyArea>()([
  "shoulder",
  "elbow",
  "wrist",
  "lower_back",
  "hip",
  "knee",
  "ankle",
  "neck",
])
export const MUSCLE_GROUPS = literals<MuscleGroup>()([
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "core",
  "full_body",
  "cardio",
])
export const SPLIT_DAYS = literals<SplitDay>()([
  "push",
  "pull",
  "legs",
  "upper",
  "lower",
  "full_body",
  "chest_triceps",
  "back_biceps",
  "shoulders_arms",
  "arms",
  "conditioning",
])
export const WORKOUT_ROLES = literals<WorkoutRole>()([
  "warmup",
  "primary_compound",
  "secondary_compound",
  "accessory",
  "isolation",
  "finisher",
  "cooldown",
])
export const WORKOUT_PHASES = literals<WorkoutPhase>()([
  "warmup",
  "main",
  "cooldown",
])
export const COMPLETED_STATUSES = literals<
  Exclude<ExerciseLogStatus, "pending">
>()(["completed", "skipped", "replaced"])
export const PERSONAL_RECORD_KINDS = literals<PersonalRecordKind>()([
  "weight",
  "reps_at_weight",
  "e1rm",
  "volume",
])

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** ISO-8601 timestamp with a UTC "Z" or explicit offset (what Date#toISOString produces). */
export const isoTimestamp = z.iso.datetime({ offset: true })
/** Local calendar key "YYYY-MM-DD" (lib/dates.ts). */
export const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date key")

const id = z.string().min(1).max(128)
const exerciseId = z.string().min(1).max(128)
/** Non-negative integer capped at `max` (keep every cap below int4's 2,147,483,647). */
const intUpTo = (max: number) => z.number().int().nonnegative().max(max)
/** Non-negative number capped at `max`. */
const upTo = (max: number) => z.number().nonnegative().max(max)

/* Realistic ceilings, each far above what the UI can produce (set logger: reps ≤ 100, ≤ 3600 s, ≤ 500 kg/lb). */
const MAX_SET_NUMBER = 1_000
const MAX_REPS = 1_000
const MAX_SET_SECONDS = 24 * 60 * 60
/** Active workout time. A forgotten, never-paused workout can run for days, so this is generous. */
const MAX_WORKOUT_SECONDS = 365 * 24 * 60 * 60
const MAX_LOAD_KG = 10_000
/** Workout-level totals; above what 100 exercises x 100 sets x MAX_REPS can add up to. */
const MAX_COUNT = 10_000_000
const MAX_ENGINE_VERSION = 1_000_000

/** Kilograms. Negative values are allowed: "assisted" load types log assistance as a negative weight. */
const loadKg = z.number().min(-MAX_LOAD_KG).max(MAX_LOAD_KG)

/* ------------------------------------------------------------------ */
/* Workouts                                                            */
/* ------------------------------------------------------------------ */

export const setLogSchema = z.object({
  setNumber: intUpTo(MAX_SET_NUMBER),
  weightKg: loadKg.nullable(),
  reps: intUpTo(MAX_REPS).nullable(),
  durationSeconds: upTo(MAX_SET_SECONDS).nullable().optional(),
  rpe: z.number().min(0).max(10).nullable().optional(),
  completed: z.boolean(),
})

export const completedExerciseSchema = z.object({
  slotId: id,
  exerciseId,
  role: z.enum(WORKOUT_ROLES),
  phase: z.enum(WORKOUT_PHASES),
  status: z.enum(COMPLETED_STATUSES),
  sets: z.array(setLogSchema).max(100),
  prescribedSets: intUpTo(MAX_SET_NUMBER),
  prescribedReps: z.tuple([intUpTo(MAX_REPS), intUpTo(MAX_REPS)]).nullable(),
  prescribedDurationSeconds: upTo(MAX_SET_SECONDS).nullable(),
  recommendedWeightKg: loadKg.nullable(),
  weightSource: z.enum(["history", "estimate", "user"]).nullable().optional(),
  prescribedTempo: z.string().max(16).nullable().optional(),
  prescribedRestSeconds: upTo(MAX_SET_SECONDS).nullable().optional(),
  suggestedExerciseId: exerciseId.nullable().optional(),
})

export const workoutTotalsSchema = z.object({
  exercisesCompleted: intUpTo(MAX_COUNT),
  exercisesSkipped: intUpTo(MAX_COUNT),
  sets: intUpTo(MAX_COUNT),
  reps: intUpTo(MAX_COUNT),
  volumeKg: upTo(1e9),
  caloriesEstimate: upTo(MAX_COUNT).nullable(),
})

export const personalRecordSchema = z.object({
  exerciseId,
  kind: z.enum(PERSONAL_RECORD_KINDS),
  value: z.number().min(-1e9).max(1e9),
  weightKg: loadKg.nullable().optional(),
  reps: intUpTo(MAX_REPS).nullable().optional(),
  previousValue: z.number().min(-1e9).max(1e9).nullable().optional(),
  achievedAt: isoTimestamp,
})

export const completedWorkoutSchema = z.looseObject({
  id,
  date: dateKey,
  title: z.string().min(1).max(120),
  split: z.enum(SPLIT_DAYS),
  focus: z.array(z.enum(MUSCLE_GROUPS)).max(MUSCLE_GROUPS.length),
  goal: z.enum(GOALS),
  startedAt: isoTimestamp,
  completedAt: isoTimestamp,
  durationSeconds: upTo(MAX_WORKOUT_SECONDS),
  exercises: z.array(completedExerciseSchema).min(1).max(100),
  totals: workoutTotalsSchema,
  personalRecords: z.array(personalRecordSchema).max(500),
  engineVersion: intUpTo(MAX_ENGINE_VERSION),
  /** Ignored on input; the server always answers with synced: true. */
  synced: z.boolean().optional(),
})

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

/** Longest excluded / preferred exercise list a profile may carry (server merges respect it too). */
export const MAX_PROFILE_EXERCISE_IDS = 500

export const putMeSchema = z.looseObject({
  goal: z.enum(GOALS),
  gender: z.enum(GENDERS),
  weightKg: z.number().positive().max(500),
  experience: z.enum(DIFFICULTIES),
  trainingDaysPerWeek: z.literal(TRAINING_DAYS),
  equipmentPreset: z.enum(EQUIPMENT_PRESETS),
  equipment: z.array(z.enum(EQUIPMENT)).max(EQUIPMENT.length),
  durationPreferenceMinutes: z.literal(DURATION_PREFERENCES),
  units: z.enum(UNITS),
  limitations: z.array(z.enum(BODY_AREAS)).max(BODY_AREAS.length),
  excludedExerciseIds: z.array(exerciseId).max(MAX_PROFILE_EXERCISE_IDS),
  preferredExerciseIds: z.array(exerciseId).max(MAX_PROFILE_EXERCISE_IDS),
  name: z.string().max(80).nullable().optional(),
  /** Client's local updatedAt; the server keeps whichever profile is newer. Defaults to now. */
  updatedAt: isoTimestamp.optional(),
})

/* ------------------------------------------------------------------ */
/* Sync + history                                                      */
/* ------------------------------------------------------------------ */

/**
 * Most workouts one sync request may push. The client sends SYNC_BATCH_SIZE (25, in
 * lib/sync/sync-store.ts) per round; this leaves 2x headroom and no more.
 */
export const SYNC_MAX_PUSH_BATCH = 50

/** Most workout deletes one sync request may carry (the client sends SYNC_DELETE_BATCH_SIZE). */
export const SYNC_MAX_DELETE_BATCH = 500

/** Workouts are validated one by one so a single bad record cannot block the whole batch. */
export const syncRequestSchema = z.looseObject({
  workouts: z.array(z.unknown()).max(SYNC_MAX_PUSH_BATCH),
  since: isoTimestamp.optional(),
  profile: putMeSchema.optional(),
  /** Ids of workouts deleted on the device. */
  deletedIds: z.array(id).max(SYNC_MAX_DELETE_BATCH).optional(),
})

export const historyQuerySchema = z.object({
  cursor: isoTimestamp.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export type SetLogInput = z.infer<typeof setLogSchema>
export type CompletedExerciseInput = z.infer<typeof completedExerciseSchema>
export type CompletedWorkoutInput = z.infer<typeof completedWorkoutSchema>
export type PutMeInput = z.infer<typeof putMeSchema>
export type SyncRequestInput = z.infer<typeof syncRequestSchema>
export type HistoryQuery = z.infer<typeof historyQuerySchema>
