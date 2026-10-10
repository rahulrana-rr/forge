/**
 * GET /api/progress → ProgressResponse (per-exercise bests + last 5 sessions, lifetime totals)
 */
import { requireUser } from "@/lib/auth-server"
import { json, withApiHandler } from "@/lib/sync/server/http"
import { buildProgressResponse } from "@/lib/sync/server/progress"
import type { ProgressResponse } from "@/lib/sync/types"

export const GET = withApiHandler(async () => {
  const user = await requireUser()
  const progress = await buildProgressResponse(user.id)
  return json<ProgressResponse>(progress)
})
