/**
 * The card note for a main-phase slot, composed once the load is known. Generation and the swap
 * share it so a slot reads the same however it was filled.
 */
import type { Exercise } from "@/lib/exercises/types"
import type { Experience } from "@/lib/domain/types"
import type { WorkoutExercise } from "./types"
import { BUILD_UP_NOTE, FEEDER_SET_NOTE, needsFeederSet, needsRampUp, RAMP_UP_NOTE } from "./duration"
import { isAntiMovementTrunk } from "./prescriptions"
import type { PlannedLoad } from "./progression"

const FIND_WORKING_WEIGHT = /^Find your working weight/
/**
 * A load held after a top-of-range session because its next step is a big jump (progression.ts):
 * the next kettlebell, or a light dumbbell's next pair (coach round 2, R11). It is the only reason a
 * lift that hit the top of its range shows no increase, so it is never hidden behind a cap,
 * stand-in or ramp-up note.
 */
const BELL_HOLD = /^Stay at .*: the next (bell|step) /

/**
 * The ramp-up or feeder-set instruction a slot needs at this load, or null. On a starting estimate
 * the lighter sets build up to it (BUILD_UP_NOTE, coach round 2 R10), so the lifter does not ramp
 * below an already light guess.
 */
export function setupNote(role: WorkoutExercise["role"], exercise: Exercise, weightKg: number | null, estimate = false): string | null {
  if (needsRampUp(role, exercise, weightKg)) return estimate ? BUILD_UP_NOTE : RAMP_UP_NOTE
  if (needsFeederSet(role, exercise, weightKg)) return FEEDER_SET_NOTE
  return null
}

export interface SlotNoteParts {
  role: WorkoutExercise["role"]
  exercise: Exercise
  /** The load shown on the card (after any hold), and how it was planned. */
  weightKg: number | null
  load: Pick<PlannedLoad, "note" | "weightSource" | "loadCheck">
  /** A cap, maintenance or stand-in note that explains the slot itself; it always leads. */
  lead?: string | null
  /** A bodyweight or hold progression note from the prescription. */
  progression?: string | null
  /** The lifter's experience: anti-movement trunk work gets a position-stop cue when given (core spec C14). */
  experience?: Experience
}

/** Core spec C14: how the position-stop cue on anti-movement trunk work begins. */
export const POSITION_STOP_PREFIX = "Stop each set"

/**
 * Core spec C14: anti-movement trunk work has no RIR target; each set stops before position slips.
 * Beginners stop further from it. Rollouts are never taken to failure. Coaching judgment.
 */
export function positionStopCue(exercise: Exercise, experience: Experience): string | null {
  if (!isAntiMovementTrunk(exercise)) return null
  const margin = experience === "beginner" ? "2-3 reps (about 10 s)" : "1-2 reps (about 5 s)"
  const cue = `${POSITION_STOP_PREFIX} ${margin} before your position slips: ribs flare, hips sag or twist, or you lean.`
  return /rollout/.test(exercise.id) ? `${cue} Never take a rollout to failure.` : cue
}

/**
 * Precedence: a lead note (cap, stand-in) first; then the ramp-up or feeder-set instruction, which
 * is never dropped; then a load that needs calibrating or checking (starting guess, "find your
 * working weight", logged-load check), which is never hidden behind the ramp-up either; then a
 * kettlebell bell hold, which explains a load that did not go up. A "find
 * your working weight" note already builds up from light sets, so it replaces the ramp-up
 * sentence. Without any of those: the progression note, else the load note.
 */
export function composeSlotNote(parts: SlotNoteParts): string | null {
  const base = baseSlotNote(parts)
  const cue = parts.experience && parts.role !== "finisher" ? positionStopCue(parts.exercise, parts.experience) : null
  if (!cue) return base
  return base ? `${base} ${cue}` : cue
}

function baseSlotNote({ role, exercise, weightKg, load, lead = null, progression = null }: SlotNoteParts): string | null {
  const setup = setupNote(role, exercise, weightKg, load.weightSource === "estimate")
  const findWeight = !!load.note && FIND_WORKING_WEIGHT.test(load.note)
  const calibration = load.loadCheck || load.weightSource === "estimate" || findWeight ? load.note : null
  const bellHold = !calibration && !!load.note && BELL_HOLD.test(load.note) ? load.note : null
  const parts: string[] = []
  if (lead) parts.push(lead)
  if (setup && !findWeight) parts.push(setup)
  if (calibration) parts.push(calibration)
  // Alone, a bell hold is simply the load note; after a lead or setup sentence it is kept too.
  if (bellHold && parts.length > 0) parts.push(bellHold)
  if (parts.length > 0) return parts.join(" ")
  return progression ?? load.note ?? null
}
