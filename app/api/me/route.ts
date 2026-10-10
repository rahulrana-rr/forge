/**
 * GET /api/me  → MeResponse
 * PUT /api/me  body: PutMeRequest → MeResponse (last-write-wins on updatedAt; always 200 with the winner)
 */
import { requireUser } from "@/lib/auth-server"
import { json, readJsonBody, withApiHandler } from "@/lib/sync/server/http"
import { getProfile, toMeUser, upsertProfile } from "@/lib/sync/server/profile"
import { putMeSchema } from "@/lib/sync/server/validation"
import type { MeResponse } from "@/lib/sync/types"

export const GET = withApiHandler(async () => {
  const user = await requireUser()
  const profile = await getProfile(user.id)
  return json<MeResponse>({ user: toMeUser(user), profile })
})

export const PUT = withApiHandler(async (req) => {
  const user = await requireUser()
  const input = putMeSchema.parse(await readJsonBody(req))
  const profile = await upsertProfile(user.id, input)
  return json<MeResponse>({ user: toMeUser(user), profile })
})
