import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { assignmentForEmail, parseProgramAssignments } from "./assignments"
import { RETURNING_LIFTER_CALISTHENICS_ID } from "./returning-lifter-calisthenics"

const ENTRY = { programId: RETURNING_LIFTER_CALISTHENICS_ID, startDate: "2026-10-12" }

describe("PROGRAM_ASSIGNMENTS", () => {
  it("returns only the caller's own assignment, matched case-insensitively", () => {
    const raw = JSON.stringify({ "lifter@example.com": ENTRY, "other@example.com": { ...ENTRY, startDate: "2026-11-02" } })
    expect(assignmentForEmail("Lifter@Example.com", raw)).toEqual(ENTRY)
    expect(assignmentForEmail("nobody@example.com", raw)).toBeNull()
    expect(assignmentForEmail(null, raw)).toBeNull()
  })

  it("treats invalid JSON, non-objects and bad entries as no assignment", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(parseProgramAssignments("{not json").size).toBe(0)
    expect(parseProgramAssignments("[]").size).toBe(0)
    expect(parseProgramAssignments(undefined).size).toBe(0)
    const map = parseProgramAssignments(
      JSON.stringify({ "a@example.com": { programId: "unknown", startDate: "2026-10-12" }, "b@example.com": { ...ENTRY, startDate: "12/10/2026" }, "c@example.com": ENTRY }),
    )
    expect([...map.keys()]).toEqual(["c@example.com"])
    // Logged once, not on every request.
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
