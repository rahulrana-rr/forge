/**
 * API contract shared by the Next.js route handlers and the client sync layer.
 * All routes require an authenticated better-auth session except /api/auth/*.
 * Request/response bodies are JSON. Errors: { error: { code: string; message: string } } with 4xx/5xx.
 */
import type {
  CompletedWorkout,
  ExerciseProgress,
  UserProfile,
} from "@/lib/domain/types"

/** GET /api/me → MeResponse ; PUT /api/me body: PutMeRequest → MeResponse */
export interface MeResponse {
  user: { id: string; email: string; name: string | null; image: string | null }
  /** null until the client has pushed a profile. */
  profile: UserProfile | null
  /**
   * The caller's assigned program (lib/programs), or null. Optional: absent from servers that
   * predate assigned programs, which the client treats as null.
   */
  program?: { programId: string; startDate: string } | null
}

export type PutMeRequest = Omit<
  UserProfile,
  "id" | "createdAt" | "updatedAt"
> & {
  /** Client's local profile timestamps; server keeps the newer updatedAt. */
  updatedAt?: string
}

/** POST /api/workouts body: one CompletedWorkout → { id: string } (idempotent upsert by id). */
export type PostWorkoutRequest = CompletedWorkout
export interface PostWorkoutResponse {
  id: string
}

/** DELETE /api/workouts/:id → DeleteWorkoutResponse (idempotent tombstone, scoped to the user). */
export interface DeleteWorkoutResponse {
  id: string
  deleted: true
}

/**
 * Most workouts one sync pull page returns. The server imports this constant, so client and
 * server always agree. Truncation is signalled by `SyncResponse.hasMore`, not by page length:
 * a page ends on an updatedAt boundary and can be shorter than this while more remain.
 */
export const SYNC_PULL_LIMIT = 500

/**
 * POST /api/workouts/sync
 * Push a batch of workouts (idempotent) and pull everything the server has newer than `since`.
 */
export interface SyncRequest {
  workouts: CompletedWorkout[]
  /** ISO timestamp of the client's last successful sync; omit for a full pull. */
  since?: string
  /** Optional profile push in the same round-trip. */
  profile?: PutMeRequest
  /**
   * Ids of workouts the user deleted on this device. The server keeps a tombstone so other
   * devices drop their copies; unknown ids and ids of other accounts are ignored.
   */
  deletedIds?: string[]
}
export interface SyncResponse {
  acceptedIds: string[]
  /**
   * Server workouts changed after `since` (or all), up to SYNC_PULL_LIMIT per page. Pages go
   * oldest change first; within a page rows are sorted newest completedAt first.
   */
  workouts: CompletedWorkout[]
  profile: UserProfile | null
  /**
   * The pull cursor: store it and send it back as the next `since`. It is not wall-clock time:
   * it trails server time by ~10 s (so rows committed late are offered again; merging is by id),
   * and while `hasMore` is true it can be far in the past.
   */
  serverTime: string
  /** True when the pull was truncated: send `serverTime` back as `since` for the next page. */
  hasMore?: boolean
  /**
   * Workouts deleted on the server (by another device) after `since`, plus pushed ids that had
   * already been deleted. The client drops its copies.
   */
  deletedIds?: string[]
  /**
   * Workouts the server refused (invalid shape, or an id owned by another account), with a reason.
   * Omitted when every pushed workout was accepted.
   */
  rejected?: SyncRejection[]
}

export interface SyncRejection {
  /** The pushed workout's id when it could be read, otherwise null. */
  id: string | null
  code: string
  message: string
}

/** GET /api/workouts/history?cursor=<iso>&limit=50 → HistoryResponse */
export interface HistoryResponse {
  workouts: CompletedWorkout[]
  nextCursor: string | null
}

/** GET /api/progress → ProgressResponse */
export interface ProgressResponse {
  progress: Record<string, ExerciseProgress>
  totals: { workouts: number; sets: number; reps: number; volumeKg: number }
}

export interface ApiError {
  error: { code: string; message: string }
}
