/**
 * GET /api/workouts/history?cursor=<iso>&limit=50 → HistoryResponse (completedAt desc, keyset pagination)
 */
import { requireUser } from "@/lib/auth-server"
import { json, withApiHandler } from "@/lib/sync/server/http"
import { historyQuerySchema } from "@/lib/sync/server/validation"
import { listHistory } from "@/lib/sync/server/workouts"
import type { HistoryResponse } from "@/lib/sync/types"

export const GET = withApiHandler(async (req) => {
  const user = await requireUser()
  const params = new URL(req.url).searchParams
  const query = historyQuerySchema.parse({
    cursor: params.get("cursor") ?? undefined,
    limit: params.get("limit") ?? undefined,
  })
  const page = await listHistory(user.id, query.cursor, query.limit)
  return json<HistoryResponse>(page)
})
