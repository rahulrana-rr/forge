/**
 * Workout engine contract. The engine is pure, deterministic for a given (input, seed),
 * and runs entirely on the client. No I/O.
 */
import type { Goal, Mechanics, MovementPattern, MuscleGroup } from "@/lib/exercises/types"
import type {
  CompletedWorkout,
  ExerciseProgress,
  SplitDay,
  UserProfile,
  WorkoutPhase,
  WorkoutRole,
} from "@/lib/domain/types"

export const ENGINE_VERSION = 1

/** A planned slot in a workout. */
export interface WorkoutExercise {
  /** Unique within the workout (uuid). Stable across replacements: a replacement keeps the slotId and changes exerciseId. */
  slotId: string
  exerciseId: string
  phase: WorkoutPhase
  role: WorkoutRole
  sets: number
  /** Target rep range, null for timed/distance work. */
  reps: [number, number] | null
  /** Target seconds per set for timed/distance work, null otherwise. */
  durationSeconds: number | null
  restSeconds: number
  tempo: string | null
  /** Target reps in reserve for working sets (null for warm-up/cool-down). */
  rir: number | null
  /** Kilograms. null when there is not enough history to recommend. */
  recommendedWeightKg: number | null
  /**
   * Where recommendedWeightKg came from: "history" = progression from logged sets; "estimate" = a
   * conservative starting load from body weight, gender and experience (first time only); "user" =
   * set by the user today. Absent on workouts generated before this field existed.
   */
  weightSource?: "history" | "estimate" | "user" | null
  /**
   * Short slot-specific instruction shown on the card (e.g. "Ramp up over 2 lighter sets before
   * your working sets."). Usually one sentence; a safety or calibration instruction may follow a
   * cap or stand-in note as a second sentence, so it is never lost.
   */
  note: string | null
  /** When this slot has been swapped, the original exercise id. */
  replacedFromExerciseId: string | null
  /**
   * What a stand-in slot (filled through secondary muscles, match level 3 or more) was planned to
   * train, so a swap can bring the planned lift back. Absent or null on every other slot.
   */
  intendedSlot?: {
    patterns: MovementPattern[]
    groups: MuscleGroup[]
    mechanics?: Mechanics
    role?: Exclude<WorkoutRole, "warmup" | "cooldown">
  } | null
  /**
   * The recommended load repeats a logged load that looks like a logging slip (far above the
   * starting estimate); the note asks the lifter to check it. Absent means false.
   */
  loadCheck?: boolean
  /**
   * A harder variation the lifter is ready for (a bodyweight lift or hold maxed out on reps and
   * sets), named in the note; the card may offer it as a one-tap swap. Absent or null otherwise.
   */
  suggestedExerciseId?: string | null
}

export interface Workout {
  id: string
  date: string
  /** e.g. "Chest + Triceps", "Lower body", "Full body A". */
  title: string
  split: SplitDay
  focus: MuscleGroup[]
  goal: Goal
  estimatedMinutes: number
  exercises: WorkoutExercise[]
  generatedAt: string
  seed: number
  engineVersion: number
  /** Optional engine remarks for the UI, e.g. when fewer than 3 main exercises could be filled. */
  notes?: string[]
}

export interface EngineInput {
  profile: UserProfile
  /** Completed workouts, newest first. The engine only needs roughly the last 14 days. */
  history: CompletedWorkout[]
  /** Per-exercise progress keyed by exercise id. */
  progress: Record<string, ExerciseProgress>
  /** Local calendar key for the workout day. */
  date: string
  /** ISO timestamp used for generatedAt. Passed in so the engine stays pure. */
  now: string
  /** Optional explicit seed; default derived from profile.id + date. Changing the seed yields a different but equally valid workout. */
  seed?: number
}

export interface ReplaceOptions {
  /** Exercise ids to exclude in addition to everything already in the workout. */
  exclude?: string[]
  /** Force a specific replacement (manual pick). Must be valid for the slot or the call returns null. */
  withExerciseId?: string
}

export interface ReplacementCandidate {
  exerciseId: string
  score: number
  reason: string
  /**
   * Restores a stand-in slot's planned lift whose group is over this week's volume target: picking
   * it knowingly exceeds the weekly cap. Absent means false.
   */
  overCap?: boolean
}

/**
 * Public engine API implemented in lib/engine/index.ts.
 */
export interface WorkoutEngine {
  generateWorkout(input: EngineInput): Workout
  /** Returns a new workout with the slot swapped, or null if no suitable replacement exists. */
  replaceExercise(
    workout: Workout,
    slotId: string,
    input: EngineInput,
    options?: ReplaceOptions,
  ): Workout | null
  /** Ranked list of replacement candidates for the manual picker. */
  replacementCandidates(workout: Workout, slotId: string, input: EngineInput, limit?: number): ReplacementCandidate[]
  estimateDurationMinutes(workout: Workout): number
  /** Human-readable reason this workout was chosen, e.g. "Legs were trained 3 days ago; upper body is fresh." */
  explainWorkout(workout: Workout, input: EngineInput): string[]
}
