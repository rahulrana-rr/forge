/**
 * POST /api/coach/review → CoachResponse
 *
 * Sends today's generated workout to the coach model for review before the user starts it.
 * Open to guests (guest mode is first-class) but rate limited per user or IP. The request carries
 * only ids, numbers and enums (lib/coach/schema.ts); the prompt is built here from the static
 * library. Nothing in the request or the review is stored.
 */
import { getSession } from "@/lib/auth-server"
import { CoachError, reviewWorkout, takeRateLimit } from "@/lib/coach/server"
import { CoachRequestSchema, type CoachErrorBody, type CoachResponse } from "@/lib/coach/schema"
import { ApiHttpError } from "@/lib/sync/server/errors"
import { readJsonBody } from "@/lib/sync/server/http"

export const maxDuration = 120

/** A maximal CoachRequest (40 exercises, 14 history days) is well under this. */
const COACH_MAX_BODY_BYTES = 256 * 1024

function error(code: CoachErrorBody["error"]["code"], message: string, status: number) {
  return Response.json({ error: { code, message } } satisfies CoachErrorBody, { status })
}

function callerKey(req: Request, userId: string | null): string {
  if (userId) return `user:${userId}`
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  return `ip:${forwarded || req.headers.get("x-real-ip") || "local"}`
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await readJsonBody(req, COACH_MAX_BODY_BYTES)
  } catch (err) {
    if (err instanceof ApiHttpError && err.status === 413) {
      return error("invalid_request", "That workout is too large to review.", 413)
    }
    return error("invalid_request", "Request body must be JSON.", 400)
  }
  const parsed = CoachRequestSchema.safeParse(body)
  if (!parsed.success) return error("invalid_request", "That workout cannot be reviewed.", 400)

  const session = await getSession().catch(() => null)
  if (!takeRateLimit(callerKey(req, session?.user.id ?? null))) {
    return error("rate_limited", "Too many reviews this hour. Your workout is still ready to use.", 429)
  }

  try {
    const result = await reviewWorkout(parsed.data)
    return Response.json(result satisfies CoachResponse, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    if (err instanceof CoachError) return error(err.code, err.message, err.status)
    console.error("[coach] unexpected", err)
    return error("coach_failed", "The coach could not review this workout.", 500)
  }
}
