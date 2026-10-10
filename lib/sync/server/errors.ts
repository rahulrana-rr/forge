/**
 * API error helpers. Every error leaving a route handler has the shape in lib/sync/types.ts:
 *   { error: { code: string; message: string } } with a 4xx/5xx status.
 */
import { ZodError } from "zod"

import { Prisma } from "@/lib/generated/prisma/client"
import type { ApiError } from "@/lib/sync/types"

/** Throwable error that maps 1:1 onto an ApiError response. */
export class ApiHttpError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = "ApiHttpError"
    this.code = code
    this.status = status
  }

  toJSON(): ApiError {
    return { error: { code: this.code, message: this.message } }
  }
}

export function jsonError(
  code: string,
  message: string,
  status: number
): Response {
  const body: ApiError = { error: { code, message } }
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  })
}

/** Compact, single-line summary of the first few zod issues, e.g. "exercises.0.sets: Invalid input; title: Too small". */
export function summarizeZodError(error: ZodError, maxIssues = 5): string {
  const issues = error.issues.slice(0, maxIssues).map((issue) => {
    const path = issue.path.map(String).join(".")
    return `${path || "body"}: ${issue.message}`
  })
  const remaining = error.issues.length - issues.length
  return remaining > 0
    ? `${issues.join("; ")} (+${remaining} more)`
    : issues.join("; ")
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  )
}

/** Converts anything thrown inside a route handler into an ApiError response. */
export function errorToResponse(error: unknown): Response {
  if (error instanceof ApiHttpError)
    return jsonError(error.code, error.message, error.status)
  if (error instanceof ZodError)
    return jsonError("validation_error", summarizeZodError(error), 400)
  if (isUniqueViolation(error)) {
    return jsonError(
      "conflict",
      "A record with this id already exists for another account.",
      409
    )
  }
  console.error("[api] Unhandled error in route handler", error)
  return jsonError(
    "internal_error",
    "Something went wrong. Please try again.",
    500
  )
}
