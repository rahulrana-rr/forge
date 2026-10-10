/**
 * POST /api/workouts/sync  body: SyncRequest → SyncResponse
 * Pushes a batch of workouts (each validated and upserted independently, so one bad record
 * cannot block the rest), optionally pushes the profile, then pulls what changed after `since`.
 *
 * The pull is paginated: when more than one page changed, the response carries `hasMore: true`
 * and `serverTime` is a continuation cursor (not wall-clock time); sending it back as `since`
 * returns the next page. See pullWorkouts for how the cursor is chosen.
 */
import { requireUser } from "@/lib/auth-server"
import { ApiHttpError, summarizeZodError } from "@/lib/sync/server/errors"
import { json, readJsonBody, withApiHandler } from "@/lib/sync/server/http"
import { getProfile, upsertProfile } from "@/lib/sync/server/profile"
import {
  completedWorkoutSchema,
  syncRequestSchema,
} from "@/lib/sync/server/validation"
import {
  deleteWorkouts,
  findDeletedIds,
  pullWorkouts,
  upsertWorkout,
} from "@/lib/sync/server/workouts"
import type { SyncRejection, SyncResponse } from "@/lib/sync/types"

/** A full push batch of long workouts stays far below this; anything larger is refused with 413. */
const SYNC_MAX_BODY_BYTES = 4 * 1024 * 1024

type SyncResponseBody = SyncResponse & { hasMore: boolean; deletedIds: string[] }

function readId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || !("id" in raw)) return null
  const id = (raw as { id: unknown }).id
  return typeof id === "string" ? id : null
}

export const POST = withApiHandler(async (req) => {
  const user = await requireUser()
  const body = syncRequestSchema.parse(
    await readJsonBody(req, SYNC_MAX_BODY_BYTES)
  )

  const acceptedIds: string[] = []
  const rejected: SyncRejection[] = []

  // Deletes first, so a delete and a stale push of the same workout in one request stay deleted.
  const deleted = new Set(await deleteWorkouts(user.id, body.deletedIds ?? []))
  const pushedIds = body.workouts
    .map(readId)
    .filter((id): id is string => id !== null)
  for (const id of await findDeletedIds(user.id, pushedIds)) deleted.add(id)

  for (const raw of body.workouts) {
    const rawId = readId(raw)
    if (rawId && deleted.has(rawId)) {
      // Deleted on another device: acknowledge it so the device stops pushing, and tell it to drop it.
      acceptedIds.push(rawId)
      continue
    }
    const parsed = completedWorkoutSchema.safeParse(raw)
    if (!parsed.success) {
      rejected.push({
        id: readId(raw),
        code: "validation_error",
        message: summarizeZodError(parsed.error),
      })
      continue
    }
    try {
      acceptedIds.push(await upsertWorkout(user.id, parsed.data))
    } catch (error) {
      if (error instanceof ApiHttpError && error.status < 500) {
        rejected.push({
          id: parsed.data.id,
          code: error.code,
          message: error.message,
        })
        continue
      }
      throw error
    }
  }

  // No `since` means this device has never completed a sync for this account, so its profile is
  // usually a fresh onboarding default. An existing account profile must not lose to it just
  // because it is newer; upsertProfile keeps the account's and re-stamps it for the device to adopt.
  const profile = body.profile
    ? await upsertProfile(user.id, body.profile, {
        keepExisting: body.since === undefined,
      })
    : await getProfile(user.id)

  // Captured before the pull: the cursor is derived from it, never from a later clock reading.
  const now = new Date()
  const pulled = await pullWorkouts(user.id, body.since, now)

  const response: SyncResponseBody = {
    acceptedIds,
    workouts: pulled.workouts,
    profile,
    serverTime: pulled.cursor.toISOString(),
    hasMore: pulled.hasMore,
    deletedIds: [...new Set([...deleted, ...pulled.deletedIds])],
  }
  if (rejected.length > 0) response.rejected = rejected
  return json<SyncResponseBody>(response)
})
