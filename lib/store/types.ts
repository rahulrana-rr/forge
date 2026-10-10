/**
 * Store contracts. Implemented with zustand in lib/store/*.ts and exported from "@/lib/store".
 * UI code depends only on these interfaces.
 *
 * All stores are client-only. Each exposes `hydrated` so the UI can render skeletons until
 * persisted state has loaded (localStorage for small state, IndexedDB for history).
 */
import type {
  Workout,
  WorkoutExercise,
  ReplacementCandidate,
} from "@/lib/engine/types"
import type {
  CompletedWorkout,
  ExerciseLog,
  ExerciseProgress,
  PersonalRecord,
  SetLog,
  StreakInfo,
  UserProfile,
  WorkoutTotals,
} from "@/lib/domain/types"

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export interface ProfileState {
  hydrated: boolean
  profile: UserProfile | null
  /** Creates the profile (onboarding). Fills id/createdAt/updatedAt/equipment-from-preset if omitted. */
  createProfile(
    input: Omit<UserProfile, "id" | "createdAt" | "updatedAt">
  ): UserProfile
  updateProfile(patch: Partial<Omit<UserProfile, "id" | "createdAt">>): void
  /** Replace the local profile with one from the server (after sign-in). */
  replaceProfile(profile: UserProfile): void
  clearProfile(): void
}

/* ------------------------------------------------------------------ */
/* Active workout                                                      */
/* ------------------------------------------------------------------ */

export type WorkoutStatus = "ready" | "active" | "paused" | "completed"

export interface RestTimerState {
  /** Total seconds of the current rest, null when no timer is running. */
  totalSeconds: number | null
  /** Epoch ms when the timer ends; null when paused or stopped. */
  endsAt: number | null
  /** Seconds remaining when paused; null when running or stopped. */
  pausedRemaining: number | null
  running: boolean
}

export interface UndoEntry {
  kind: "complete" | "skip" | "replace"
  /** Full snapshot before the action; undo restores it. */
  workout: Workout
  logs: Record<string, ExerciseLog>
  currentIndex: number
}

export interface ActiveWorkout {
  workout: Workout
  status: WorkoutStatus
  currentIndex: number
  /** Keyed by slotId. Every slot has an entry (status "pending" until acted on). */
  logs: Record<string, ExerciseLog>
  startedAt: string | null
  /** Epoch ms when the current pause began; null when not paused. */
  pausedAt: number | null
  /** Accumulated paused milliseconds. */
  pausedTotalMs: number
  completedAt: string | null
  undoStack: UndoEntry[]
  /** Set after finish(); the saved CompletedWorkout id. */
  savedWorkoutId: string | null
}

export interface WorkoutState {
  hydrated: boolean
  active: ActiveWorkout | null
  timer: RestTimerState
  /**
   * Ensure there is a workout for today. If `active` exists for today's date, keep it.
   * An in-progress workout from an earlier day is kept while it was touched recently (the UI
   * offers to resume it); once idle for longer it is closed (logged main work saved) and today's
   * is generated. Otherwise generate one from the profile + history stores. No-op without a profile.
   */
  ensureToday(): void
  /** Generate a fresh alternative for today (new seed). Only allowed while status is "ready". */
  regenerate(): void
  /** Starts a "ready" workout; a plan left over from an earlier day becomes today's. */
  start(): void
  pause(): void
  /**
   * Continues an in-progress workout: un-pauses a paused one, and makes one from an earlier day
   * today's (so `workout.date` equals today afterwards). Any user action on the session does the same.
   */
  resume(): void
  /** Swipe right. Marks current slot completed with the given set logs, advances. */
  completeCurrent(sets: SetLog[]): void
  /** Swipe left. Replaces the current slot with an engine-chosen alternative; if none, marks skipped and advances. */
  skipCurrent(): void
  /** Manual replacement from the picker. */
  replaceCurrent(exerciseId: string): void
  /** Candidates for the manual picker. */
  candidatesForCurrent(limit?: number): ReplacementCandidate[]
  /** Marks the current slot skipped without replacement and advances. */
  skipWithoutReplace(): void
  undo(): void
  canUndo(): boolean
  /** Edit planned prescription for the current slot (weight/reps/sets) before completing. */
  updateCurrentPrescription(
    patch: Partial<
      Pick<
        WorkoutExercise,
        | "sets"
        | "reps"
        | "recommendedWeightKg"
        | "durationSeconds"
        | "restSeconds"
      >
    >
  ): void
  /** Jump to a slot index (used by the overview list). */
  goTo(index: number): void
  /**
   * Summary of what has been logged so far (used by the pre-save "Workout complete" screen).
   * null when there is no active workout.
   */
  previewSummary(): {
    totals: WorkoutTotals
    personalRecords: PersonalRecord[]
    durationSeconds: number
    exercisesCompleted: number
  } | null
  /** True once the user has acted on every slot (currentIndex >= exercises.length) and status is still active/paused. */
  isAtEnd(): boolean
  /**
   * Finish: compute totals and PRs, save to history store, mark status completed.
   * Returns the saved CompletedWorkout, or null if no main-phase exercise was completed
   * (a warm-up or cool-down alone is not saved). The record's `date` is the day it was started.
   */
  finish(): CompletedWorkout | null
  /** Abandon today's active workout (asks for confirmation in UI). */
  discard(): void
  /** Rest timer */
  startRest(seconds: number): void
  pauseRest(): void
  resumeRest(): void
  adjustRest(deltaSeconds: number): void
  skipRest(): void
  /** Derived helpers */
  currentExercise(): WorkoutExercise | null
  /** Number of main-phase slots and how many are done; for "Exercise 4 of 8". */
  progress(): {
    index: number
    total: number
    completed: number
    phase: "warmup" | "main" | "cooldown"
  }
  /** Active seconds so far excluding pauses. */
  elapsedSeconds(): number
}

/* ------------------------------------------------------------------ */
/* History + progress                                                  */
/* ------------------------------------------------------------------ */

export interface HistoryState {
  hydrated: boolean
  /** Newest first. */
  workouts: CompletedWorkout[]
  progress: Record<string, ExerciseProgress>
  addWorkout(workout: CompletedWorkout): void
  /** Merge server workouts (idempotent by id); recompute progress. */
  mergeRemote(workouts: CompletedWorkout[]): void
  markSynced(ids: string[]): void
  removeWorkout(id: string): void
  getWorkout(id: string): CompletedWorkout | undefined
  streak(): StreakInfo
  /** Workouts in the last N days, newest first. */
  recent(days: number): CompletedWorkout[]
  clearAll(): void
}

/* ------------------------------------------------------------------ */
/* Sync                                                                */
/* ------------------------------------------------------------------ */

export type SyncStatus = "idle" | "syncing" | "offline" | "error" | "signed_out"

export interface SyncState {
  status: SyncStatus
  pendingCount: number
  lastSyncedAt: string | null
  lastError: string | null
  /** Push unsynced workouts + profile, pull remote changes. Safe to call often; coalesces. */
  flush(): Promise<void>
  /**
   * Called when auth session changes. Pass the session user's id when known: local data is
   * scoped to the account it was synced with, and nothing is pushed into a different account.
   */
  setSignedIn(signedIn: boolean, userId?: string | null): void
}
