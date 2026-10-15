/**
 * Assigned programs: the registry of program definitions and the assignment shape shared by the
 * server (/api/me) and the client. Pure; safe to import anywhere.
 */
import { returningLifterCalisthenics } from "./returning-lifter-calisthenics"
import type { ProgramAssignment, ProgramDefinition } from "./types"

export * from "./types"

export const PROGRAMS: readonly ProgramDefinition[] = [returningLifterCalisthenics]

const byId = new Map(PROGRAMS.map((p) => [p.id, p]))

export function getProgram(id: string): ProgramDefinition | undefined {
  return byId.get(id)
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/** Whether `key` is a real calendar date written "YYYY-MM-DD". */
export function isDateKey(key: unknown): key is string {
  if (typeof key !== "string" || !DATE_KEY.test(key)) return false
  const [y, m, d] = key.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/**
 * A valid assignment from untrusted input (env JSON, an API response), or null: the program id
 * must be a known program and the start date a real "YYYY-MM-DD" date. Extra fields are dropped.
 */
export function parseAssignment(value: unknown): ProgramAssignment | null {
  if (typeof value !== "object" || value === null) return null
  const { programId, startDate } = value as Record<string, unknown>
  if (typeof programId !== "string" || !getProgram(programId) || !isDateKey(startDate)) return null
  return { programId, startDate }
}
