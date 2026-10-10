import { beforeEach, describe, expect, it, vi } from "vitest"

import { generateWorkout } from "@/lib/engine"
import { makeInput, makeProfile } from "@/lib/engine/test-fixtures"
import { buildCoachRequest } from "./context"

const reviewWorkout = vi.fn()
const takeRateLimit = vi.fn(() => true)

vi.mock("@/lib/auth-server", () => ({ getSession: vi.fn(async () => null) }))
vi.mock("@/lib/coach/server", () => {
  class CoachError extends Error {
    constructor(readonly code: string, message: string, readonly status: number) {
      super(message)
    }
  }
  return { CoachError, reviewWorkout: (...a: unknown[]) => reviewWorkout(...a), takeRateLimit: () => takeRateLimit() }
})

const { POST } = await import("@/app/api/coach/review/route")
const { CoachError } = await import("@/lib/coach/server")

const input = makeInput(makeProfile({ goal: "strength" }), "2026-10-07")
const body = buildCoachRequest(generateWorkout(input), input)
const post = (b: unknown) => POST(new Request("http://localhost/api/coach/review", { method: "POST", body: typeof b === "string" ? b : JSON.stringify(b) }))

describe("POST /api/coach/review", () => {
  beforeEach(() => {
    reviewWorkout.mockReset()
    takeRateLimit.mockReset().mockReturnValue(true)
  })

  it("rejects malformed bodies before calling the model", async () => {
    expect((await post("not json")).status).toBe(400)
    expect((await post({ workout: { exercises: [] } })).status).toBe(400)
    expect(reviewWorkout).not.toHaveBeenCalled()
  })

  it("returns the review on success", async () => {
    reviewWorkout.mockResolvedValue({ review: { review_status: "APPROVED" }, rejectedChanges: [], model: "m", reviewedAt: "t" })
    const res = await post(body)
    expect(res.status).toBe(200)
    expect((await res.json()).review.review_status).toBe("APPROVED")
  })

  it("reports an unconfigured coach as unavailable, never as approval", async () => {
    reviewWorkout.mockRejectedValue(new CoachError("coach_unavailable", "not configured", 503))
    const res = await post(body)
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe("coach_unavailable")
  })

  it("rate limits callers", async () => {
    takeRateLimit.mockReturnValue(false)
    const res = await post(body)
    expect(res.status).toBe(429)
    expect(reviewWorkout).not.toHaveBeenCalled()
  })
})
