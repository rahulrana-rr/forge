/**
 * POST /api/workouts  body: CompletedWorkout → { id } (idempotent upsert by id, scoped to the user)
 */
import { requireUser } from "@/lib/auth-server"
import { json, readJsonBody, withApiHandler } from "@/lib/sync/server/http"
import { completedWorkoutSchema } from "@/lib/sync/server/validation"
import { upsertWorkout } from "@/lib/sync/server/workouts"
import type { PostWorkoutResponse } from "@/lib/sync/types"

export const POST = withApiHandler(async (req) => {
  const user = await requireUser()
  const workout = completedWorkoutSchema.parse(await readJsonBody(req))
  const id = await upsertWorkout(user.id, workout)
  return json<PostWorkoutResponse>({ id })
})
