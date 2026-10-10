/**
 * Workout persistence: idempotent upsert by client id (scoped to the user), derived
 * ExercisePerformance rows, UserProgress recompute, sync pull and history pagination.
 */
import type { CompletedWorkout } from "@/lib/domain/types"
import type { Prisma } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { SYNC_PULL_LIMIT, type HistoryResponse } from "@/lib/sync/types"

import { ApiHttpError } from "./errors"
import {
  performanceRowsFromWorkout,
  workoutInputToColumns,
  workoutRowToDomain,
} from "./mappers"
import { computeProgressStats } from "./stats"
import type { CompletedWorkoutInput } from "./validation"

// One definition shared with the client (lib/sync/types.ts), so the two can never drift apart.
export { SYNC_PULL_LIMIT }

/**
 * Upper bound on one workout upsert transaction (Prisma's default, made explicit because
 * SYNC_PULL_OVERLAP_MS depends on it). Past this Prisma rolls the transaction back.
 */
export const UPSERT_TRANSACTION_TIMEOUT_MS = 5_000

/**
 * How far behind server time a completed pull's cursor is set.
 *
 * Prisma stamps `Workout.updatedAt` when the upsert statement runs, but the row only becomes
 * visible at commit, up to UPSERT_TRANSACTION_TIMEOUT_MS later. A concurrent pull in that gap
 * cannot see the row although its stamp is older than the pull's server time, so a cursor equal to
 * server time would skip it for good. Backing the cursor off by twice the transaction bound
 * (plus clock skew) re-offers such rows on the next pull; the client merges by id, so
 * re-delivery is harmless.
 */
export const SYNC_PULL_OVERLAP_MS = 2 * UPSERT_TRANSACTION_TIMEOUT_MS

/**
 * Upserts one workout for `userId` and rebuilds its derived rows in a single transaction.
 * Throws ApiHttpError 409 when the id already belongs to another account.
 */
export async function upsertWorkout(
  userId: string,
  input: CompletedWorkoutInput
): Promise<string> {
  await prisma.$transaction(
    async (tx) => {
      const existing = await tx.workout.findUnique({
        where: { id: input.id },
        select: { userId: true, deletedAt: true },
      })
      if (existing && existing.userId !== userId) {
        throw new ApiHttpError(
          "conflict",
          "A workout with this id belongs to another account.",
          409
        )
      }
      // Deleted on another device: a late push of an old copy must not bring it back.
      if (existing?.deletedAt) return

      const columns = workoutInputToColumns(userId, input)
      // `where` includes userId as a second guard; a mismatch falls through to create and trips the
      // primary-key constraint, which errorToResponse maps to 409.
      await tx.workout.upsert({
        where: { id: input.id, userId },
        create: { id: input.id, ...columns },
        update: columns,
      })

      const previous = await tx.exercisePerformance.findMany({
        where: { workoutId: input.id },
        select: { exerciseId: true },
        distinct: ["exerciseId"],
      })
      await tx.exercisePerformance.deleteMany({
        where: { workoutId: input.id },
      })

      const rows = performanceRowsFromWorkout(userId, input)
      if (rows.length > 0)
        await tx.exercisePerformance.createMany({ data: rows })

      const touched = new Set<string>()
      for (const p of previous) touched.add(p.exerciseId)
      for (const r of rows) touched.add(r.exerciseId)
      await recomputeProgress(tx, userId, [...touched])
    },
    { timeout: UPSERT_TRANSACTION_TIMEOUT_MS }
  )
  return input.id
}

/** Recomputes UserProgress for the given exercises from their ExercisePerformance rows. */
export async function recomputeProgress(
  tx: Prisma.TransactionClient,
  userId: string,
  exerciseIds: readonly string[]
): Promise<void> {
  for (const exerciseId of exerciseIds) {
    const rows = await tx.exercisePerformance.findMany({
      where: { userId, exerciseId },
      select: {
        workoutId: true,
        weightKg: true,
        reps: true,
        completedAt: true,
      },
    })
    const stats = computeProgressStats(rows)
    if (!stats) {
      await tx.userProgress.deleteMany({ where: { userId, exerciseId } })
      continue
    }
    await tx.userProgress.upsert({
      where: { userId_exerciseId: { userId, exerciseId } },
      create: { userId, exerciseId, ...stats },
      update: stats,
    })
  }
}

/**
 * Ids among `ids` that `userId` has deleted (tombstoned). The sync route answers pushes of these
 * as accepted without writing them, and tells the device to drop its copy.
 */
export async function findDeletedIds(
  userId: string,
  ids: readonly string[]
): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await prisma.workout.findMany({
    where: { userId, id: { in: [...ids] }, deletedAt: { not: null } },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/**
 * Deletes `userId`'s workouts by id. Each becomes a tombstone (deletedAt set, which also bumps
 * updatedAt so other devices pull the delete), its performance rows are removed and progress for
 * the exercises it touched is recomputed. Ids that do not exist or belong to another account are
 * ignored. Returns the ids that are now deleted for this user (including ones deleted earlier).
 */
export async function deleteWorkouts(
  userId: string,
  ids: readonly string[]
): Promise<string[]> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return []
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.workout.findMany({
        where: { userId, id: { in: unique } },
        select: { id: true, deletedAt: true },
      })
      const live = rows.filter((r) => r.deletedAt == null).map((r) => r.id)
      if (live.length > 0) {
        const touched = await tx.exercisePerformance.findMany({
          where: { workoutId: { in: live } },
          select: { exerciseId: true },
          distinct: ["exerciseId"],
        })
        await tx.exercisePerformance.deleteMany({
          where: { workoutId: { in: live } },
        })
        await tx.workout.updateMany({
          where: { userId, id: { in: live } },
          data: { deletedAt: new Date() },
        })
        await recomputeProgress(
          tx,
          userId,
          touched.map((t) => t.exerciseId)
        )
      }
      return rows.map((r) => r.id)
    },
    { timeout: UPSERT_TRANSACTION_TIMEOUT_MS }
  )
}

export interface PullPage {
  /** Newest completedAt first. */
  workouts: CompletedWorkout[]
  /** Workouts deleted after `since`; the client drops its copies. */
  deletedIds: string[]
  /** The client's next `since` (returned to it as `serverTime`). */
  cursor: Date
  /** True when rows changed after `cursor` remain; pull again with it as `since`. */
  hasMore: boolean
}

/**
 * How many of `rows` (sorted by `key`, `limit + 1` fetched) form the page when the next page is
 * requested with a strict comparison on `key` (`> cursor` or `< cursor`). A full page never ends
 * inside a run of equal keys, because that comparison would skip the rest of the run. Returns 0
 * when the whole fetch is a single run; the caller then widens the page to that run.
 */
export function pageLength<Row>(
  rows: readonly Row[],
  limit: number,
  key: (row: Row) => Date
): number {
  if (rows.length <= limit) return rows.length
  let end = limit
  while (end > 0 && key(rows[end - 1]!).getTime() === key(rows[end]!).getTime())
    end--
  return end
}

const byUpdatedAt = (row: { updatedAt: Date }) => row.updatedAt
const byCompletedAt = (row: { completedAt: Date }) => row.completedAt

/**
 * The next `since` for a delivered page (rows sorted by updatedAt ascending).
 *
 * Complete: SYNC_PULL_OVERLAP_MS behind `now`, so rows stamped before `now` but committed after
 * the pull are offered again. Truncated: the last row's `updatedAt`, backed off to that same safe
 * point only while doing so still advances past the start of the page. When the whole page is
 * younger than the safe point, backing off would return the same page forever, so it continues
 * from the last row.
 */
export function pullCursor(
  page: readonly { updatedAt: Date }[],
  hasMore: boolean,
  now: Date
): Date {
  const safe = new Date(now.getTime() - SYNC_PULL_OVERLAP_MS)
  const first = page[0]
  const last = page.at(-1)
  if (!hasMore || !first || !last) return safe
  return last.updatedAt > safe && first.updatedAt <= safe
    ? safe
    : last.updatedAt
}

/**
 * Workouts changed on the server after `since` (or all), oldest change first, at most
 * SYNC_PULL_LIMIT per call.
 *
 * A complete pull returns a cursor SYNC_PULL_OVERLAP_MS behind `now` (see that constant). A
 * truncated pull returns `hasMore` and a cursor no later than the last delivered row's
 * `updatedAt`, so the next pull continues where this one stopped instead of jumping to server
 * time and silently skipping the rest.
 */
export async function pullWorkouts(
  userId: string,
  since: string | undefined,
  now: Date = new Date(),
  limit: number = SYNC_PULL_LIMIT
): Promise<PullPage> {
  const rows = await prisma.workout.findMany({
    where: { userId, ...(since ? { updatedAt: { gt: new Date(since) } } : {}) },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  })

  let page = rows
  let hasMore = false
  if (rows.length > limit) {
    hasMore = true
    const length = pageLength(rows, limit, byUpdatedAt)
    page =
      length > 0
        ? rows.slice(0, length)
        : // Every fetched row shares one updatedAt: deliver that whole run so the cursor can pass it.
          await prisma.workout.findMany({
            where: { userId, updatedAt: rows[0]!.updatedAt },
            orderBy: [{ id: "asc" }],
          })
  }

  const cursor = pullCursor(page, hasMore, now)
  const deletedIds = page.filter((r) => r.deletedAt != null).map((r) => r.id)
  const workouts = page
    .filter((r) => r.deletedAt == null)
    .sort(
      (a, b) =>
        b.completedAt.getTime() - a.completedAt.getTime() ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
    )
    .map(workoutRowToDomain)
  return { workouts, deletedIds, cursor, hasMore }
}

/**
 * Cursor pagination by completedAt desc; `cursor` is the completedAt of the last item seen.
 * Pages end between distinct completedAt values (see pageLength), so workouts sharing a
 * completedAt are never split across the `completedAt < cursor` boundary and skipped.
 */
export async function listHistory(
  userId: string,
  cursor: string | undefined,
  limit: number
): Promise<HistoryResponse> {
  const rows = await prisma.workout.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(cursor ? { completedAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  })
  if (rows.length <= limit)
    return { workouts: rows.map(workoutRowToDomain), nextCursor: null }

  const length = pageLength(rows, limit, byCompletedAt)
  const page =
    length > 0
      ? rows.slice(0, length)
      : // More than `limit` workouts share one completedAt: return them all so the cursor can pass.
        await prisma.workout.findMany({
          where: { userId, deletedAt: null, completedAt: rows[0]!.completedAt },
          orderBy: [{ id: "desc" }],
        })
  return {
    workouts: page.map(workoutRowToDomain),
    nextCursor: page.at(-1)!.completedAt.toISOString(),
  }
}
