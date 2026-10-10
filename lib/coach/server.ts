/**
 * Server only: call the coach model and return a validated, sanitised review.
 *
 * Model: Claude Opus 5.5 by default (override with COACH_MODEL). Effort "high": this is a
 * safety-relevant judgment call, so depth matters more than latency; the client shows the
 * workout immediately with a "reviewing" state and never treats a missing review as approval.
 * Structured outputs guarantee the JSON shape; server-side refusal fallbacks are enabled.
 */
import "server-only"

import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"

import { buildCoachMessage } from "./message"
import { COACH_SYSTEM_PROMPT } from "./prompt"
import { CoachReviewSchema, type CoachErrorBody, type CoachRequest, type CoachResponse } from "./schema"
import { sanitizeReview } from "./validate"

const DEFAULT_MODEL = "claude-opus-5-5"

export class CoachError extends Error {
  constructor(
    readonly code: CoachErrorBody["error"]["code"],
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (client) return client
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new CoachError("coach_unavailable", "The coach is not configured on this server.", 503)
  }
  client = new Anthropic()
  return client
}

export async function reviewWorkout(req: CoachRequest): Promise<CoachResponse> {
  const anthropic = getClient()
  const model = process.env.COACH_MODEL?.trim() || DEFAULT_MODEL
  let message: string
  try {
    message = buildCoachMessage(req)
  } catch (err) {
    throw new CoachError("invalid_request", err instanceof Error ? err.message : "Invalid workout.", 400)
  }

  let response
  try {
    response = await anthropic.beta.messages.parse(
      {
        model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "high", format: betaZodOutputFormat(CoachReviewSchema) },
        system: [{ type: "text", text: COACH_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: message }],
      },
      { timeout: 110_000, maxRetries: 1 },
    )
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new CoachError("rate_limited", "The coach is busy. Try again shortly.", 503)
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      console.error("[coach] credentials rejected", err.status)
      throw new CoachError("coach_unavailable", "The coach is not configured on this server.", 503)
    }
    if (err instanceof Anthropic.BadRequestError) {
      console.error("[coach] bad request", err.message)
      throw new CoachError("coach_failed", "The coach could not review this workout.", 502)
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[coach] api error", err.status, err.message)
      throw new CoachError("coach_failed", "The coach could not review this workout.", 502)
    }
    console.error("[coach] request failed", err)
    throw new CoachError("coach_failed", "The coach could not be reached.", 502)
  }

  if (response.stop_reason === "refusal") {
    throw new CoachError("coach_refused", "The coach declined to review this workout.", 502)
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new CoachError("coach_failed", "The coach's review was incomplete.", 502)
  }
  // Belt and braces: the SDK parsed against the schema; re-validate before trusting it.
  const parsed = CoachReviewSchema.safeParse(response.parsed_output)
  if (!parsed.success) throw new CoachError("coach_failed", "The coach's review was malformed.", 502)

  const { review, rejectedChanges } = sanitizeReview(req, parsed.data)
  return { review, rejectedChanges, model: response.model, reviewedAt: new Date().toISOString() }
}

/* ------------------------------------------------------------------ */
/* Rate limiting                                                       */
/* ------------------------------------------------------------------ */

/**
 * Per-caller fixed window, in memory. Enough for one Node process; on serverless or several
 * instances put a shared limiter (Redis, the platform's edge rate limiting) in front instead.
 */
const WINDOW_MS = 60 * 60 * 1000
const LIMIT = 15
const buckets = new Map<string, { count: number; resetAt: number }>()

export function takeRateLimit(key: string, now = Date.now()): boolean {
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
    }
    return true
  }
  if (bucket.count >= LIMIT) return false
  bucket.count += 1
  return true
}
