import { describe, expect, it } from "vitest"
import { requireExercise } from "@/lib/exercises"
import { engineNoteCodes } from "@/lib/coach/notes"
import { BUILD_UP_NOTE, RAMP_UP_NOTE } from "./duration"
import { STARTING_GUESS_NOTE } from "./progression"
import { composeSlotNote, POSITION_STOP_PREFIX, positionStopCue } from "./slot-notes"

const BELL_HOLD = "Stay at 8 kg: the next bell (12 kg) is a big jump. Hit 13 reps on every set once more, then move up."
const CAP = "Capped at 2 sets: glutes is near its weekly volume."

describe("composeSlotNote", () => {
  it("never hides the ramp-up sentence or a starting guess behind a cap note", () => {
    const squat = requireExercise("barbell-back-squat")
    const note = composeSlotNote({
      role: "primary_compound",
      exercise: squat,
      weightKg: 60,
      load: { note: STARTING_GUESS_NOTE, weightSource: "estimate" },
      lead: CAP,
    })
    // Coach round 2 (R10): on a starting estimate the lighter sets build up to it.
    expect(note).toBe(`${CAP} ${BUILD_UP_NOTE} ${STARTING_GUESS_NOTE}`)
    expect(engineNoteCodes(note)).toEqual(["capped_week", "ramp_up", "starting_guess"])
    // A load from history keeps the plain ramp-up sentence.
    const proven = composeSlotNote({ role: "primary_compound", exercise: squat, weightKg: 80, load: { note: null, weightSource: "history" } })
    expect(proven).toBe(RAMP_UP_NOTE)
  })

  it("keeps a kettlebell bell hold after a cap note, so a top-of-range lift that holds says why", () => {
    const kb = requireExercise("kettlebell-deadlift")
    const note = composeSlotNote({ role: "accessory", exercise: kb, weightKg: 8, load: { note: BELL_HOLD, weightSource: "history" }, lead: CAP })
    expect(note).toBe(`${CAP} ${BELL_HOLD}`)
    expect(engineNoteCodes(note)).toEqual(["capped_week", "load_hold"])
    // Alone, the bell hold is simply the load note.
    expect(composeSlotNote({ role: "accessory", exercise: kb, weightKg: 8, load: { note: BELL_HOLD, weightSource: "history" } })).toBe(BELL_HOLD)
  })
})

describe("position-stop cue on anti-movement trunk work (core spec C14)", () => {
  it("is appended for dead bugs, Pallof presses and rollouts, by experience, and never for flexion work", () => {
    const load = { note: null, weightSource: null }
    const bug = composeSlotNote({ role: "accessory", exercise: requireExercise("dead-bug"), weightKg: null, load, experience: "beginner" })
    expect(bug).toBe(`${POSITION_STOP_PREFIX} 2-3 reps (about 10 s) before your position slips: ribs flare, hips sag or twist, or you lean.`)
    const pallof = composeSlotNote({ role: "accessory", exercise: requireExercise("pallof-press"), weightKg: 20, load: { note: "Same 20 kg; aim for 10 reps on every set.", weightSource: "history" }, experience: "advanced" })
    expect(pallof).toBe(`Same 20 kg; aim for 10 reps on every set. ${POSITION_STOP_PREFIX} 1-2 reps (about 5 s) before your position slips: ribs flare, hips sag or twist, or you lean.`)
    expect(positionStopCue(requireExercise("ab-wheel-rollout"), "intermediate")).toContain("Never take a rollout to failure.")
    expect(positionStopCue(requireExercise("cable-crunch"), "advanced")).toBeNull()
    // Without the lifter's experience (older callers) the note is unchanged.
    expect(composeSlotNote({ role: "accessory", exercise: requireExercise("dead-bug"), weightKg: null, load })).toBeNull()
  })
})
