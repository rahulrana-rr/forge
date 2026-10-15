/**
 * Server only: which signed-in users have an assigned program.
 *
 * PROGRAM_ASSIGNMENTS (server env, never NEXT_PUBLIC) is a JSON object keyed by lowercased email:
 *   { "<email>": { "programId": "returning-lifter-calisthenics-7wk", "startDate": "YYYY-MM-DD" } }
 * Invalid JSON means no assignments (logged once); an entry with an unknown program id or a bad
 * date is ignored. Assignments live only in the environment, never in the repo, and /api/me only
 * ever returns the caller's own entry.
 */
import "server-only"

import { parseAssignment } from "./index"
import type { ProgramAssignment } from "./types"

let cached: { raw: string | undefined; map: Map<string, ProgramAssignment> } | null = null
let warned = false

/** Parses the env value; invalid JSON or a non-object yields no assignments. */
export function parseProgramAssignments(raw: string | undefined): Map<string, ProgramAssignment> {
  const map = new Map<string, ProgramAssignment>()
  if (!raw || !raw.trim()) return map
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    if (!warned) {
      warned = true
      console.warn("PROGRAM_ASSIGNMENTS is not valid JSON; no program assignments are active.")
    }
    return map
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    if (!warned) {
      warned = true
      console.warn("PROGRAM_ASSIGNMENTS must be a JSON object keyed by email; no program assignments are active.")
    }
    return map
  }
  for (const [email, value] of Object.entries(parsed as Record<string, unknown>)) {
    const assignment = parseAssignment(value)
    if (assignment) map.set(email.trim().toLowerCase(), assignment)
  }
  return map
}

/** The caller's assignment, or null. `raw` defaults to process.env.PROGRAM_ASSIGNMENTS. */
export function assignmentForEmail(email: string | null | undefined, raw: string | undefined = process.env.PROGRAM_ASSIGNMENTS): ProgramAssignment | null {
  if (!email) return null
  if (!cached || cached.raw !== raw) cached = { raw, map: parseProgramAssignments(raw) }
  return cached.map.get(email.trim().toLowerCase()) ?? null
}
