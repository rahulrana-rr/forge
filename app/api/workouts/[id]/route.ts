/**
 * DELETE /api/workouts/:id → { id, deleted } (idempotent)
 * Tombstones one of the signed-in user's workouts so other devices drop it on their next pull.
 * Unknown ids and ids of other accounts answer 404.
 */
import { requireUser } from "@/lib/auth-server"
import { ApiHttpError, errorToResponse } from "@/lib/sync/server/errors"
import { json } from "@/lib/sync/server/http"
import { deleteWorkouts } from "@/lib/sync/server/workouts"
import type { DeleteWorkoutResponse } from "@/lib/sync/types"

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/workouts/[id]">
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    if (!id || id.length > 128)
      throw new ApiHttpError("validation_error", "Invalid workout id.", 400)
    const deleted = await deleteWorkouts(user.id, [id])
    if (!deleted.includes(id))
      throw new ApiHttpError("not_found", "Workout not found.", 404)
    return json<DeleteWorkoutResponse>({ id, deleted: true })
  } catch (error) {
    return errorToResponse(error)
  }
}
