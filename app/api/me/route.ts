/**
 * GET /api/me  → MeResponse
 * PUT /api/me  body: PutMeRequest → MeResponse (last-write-wins on updatedAt; always 200 with the winner)
 * Both include the caller's own program assignment (PROGRAM_ASSIGNMENTS), never anyone else's.
 */
import { requireUser, type SessionUser } from "@/lib/auth-server"
import { assignmentForEmail } from "@/lib/programs/assignments"
import { json, readJsonBody, withApiHandler } from "@/lib/sync/server/http"
import { getProfile, toMeUser, upsertProfile } from "@/lib/sync/server/profile"
import { putMeSchema } from "@/lib/sync/server/validation"
import type { MeResponse } from "@/lib/sync/types"

/** The caller's own assignment; only for a verified email, so an address cannot be claimed. */
function programFor(user: SessionUser): MeResponse["program"] {
  return user.emailVerified ? assignmentForEmail(user.email) : null
}

export const GET = withApiHandler(async () => {
  const user = await requireUser()
  const profile = await getProfile(user.id)
  return json<MeResponse>({ user: toMeUser(user), profile, program: programFor(user) })
})

export const PUT = withApiHandler(async (req) => {
  const user = await requireUser()
  const input = putMeSchema.parse(await readJsonBody(req))
  const profile = await upsertProfile(user.id, input)
  return json<MeResponse>({ user: toMeUser(user), profile, program: programFor(user) })
})
