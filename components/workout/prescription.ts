/**
 * Small pure helpers shared by the workout components: prescription formatting, default set logs
 * for a swipe-right, load-step classification and phase/role labels.
 */
import { unilateralSide, type Equipment, type Exercise } from "@/lib/exercises/types"
import type { SetLog, WorkoutPhase, WorkoutRole } from "@/lib/domain/types"
import type { WorkoutExercise } from "@/lib/engine/types"

export type LoadKind = "barbell" | "dumbbell" | "kettlebell" | "machine" | "other"

export const PHASE_LABELS: Record<WorkoutPhase, string> = {
  warmup: "Warm-up",
  main: "Main",
  cooldown: "Cool-down",
}

export const ROLE_LABELS: Record<WorkoutRole, string> = {
  warmup: "Warm-up",
  primary_compound: "Primary compound",
  secondary_compound: "Secondary compound",
  accessory: "Accessory",
  isolation: "Isolation",
  finisher: "Finisher",
  cooldown: "Cool-down",
}

/**
 * The role label on a card. On a conditioning-led day (split "conditioning") the finisher-role
 * block is the day's main work, so it reads "Conditioning", not "Finisher".
 */
export function roleLabel(role: WorkoutRole, split?: string | null): string {
  if (role === "finisher" && split === "conditioning") return "Conditioning"
  return ROLE_LABELS[role]
}

/** Timed slots have no rep range and a per-set duration. */
export function isTimedSlot(slot: Pick<WorkoutExercise, "reps" | "durationSeconds">): boolean {
  return slot.reps == null && slot.durationSeconds != null
}

export function formatRepRange(range: [number, number]): string {
  return range[0] === range[1] ? `${range[0]}` : `${range[0]}–${range[1]}`
}

/** "45s", "90s", then "1:45", "3:00" once it no longer reads well in seconds. */
export function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 100) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, "0")}`
}

/** "per leg" or "per side" for a unilateral exercise's target (unilateralSide), null for bilateral work. */
export function perSideLabel(exercise: Pick<Exercise, "isUnilateral" | "primaryMuscle" | "movementPattern"> | undefined): string | null {
  const side = exercise ? unilateralSide(exercise) : null
  return side ? `per ${side}` : null
}

type SidedExercise = Parameters<typeof perSideLabel>[0]

/** "4 × 8–10", "3 × 45s", or "3 × 10 per leg" for unilateral work. */
export function formatPrescription(slot: Pick<WorkoutExercise, "sets" | "reps" | "durationSeconds">, exercise?: SidedExercise): string {
  const side = perSideLabel(exercise)
  const suffix = side ? ` ${side}` : ""
  if (slot.reps) return `${slot.sets} × ${formatRepRange(slot.reps)}${suffix}`
  if (slot.durationSeconds != null) return `${slot.sets} × ${formatSeconds(slot.durationSeconds)}${suffix}`
  return `${slot.sets} sets`
}

/** formatSeconds for speech: "45 seconds", "1 minute 30 seconds". */
export function spokenSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const rest = s % 60
  const sec = (n: number) => `${n} second${n === 1 ? "" : "s"}`
  if (m === 0) return sec(rest)
  const min = `${m} minute${m === 1 ? "" : "s"}`
  return rest === 0 ? min : `${min} ${sec(rest)}`
}

/** formatPrescription for screen readers, without "×" and "–": "3 sets of 6 to 10 reps (per leg)". */
export function spokenPrescription(slot: Pick<WorkoutExercise, "sets" | "reps" | "durationSeconds">, exercise?: SidedExercise): string {
  const sets = `${slot.sets} set${slot.sets === 1 ? "" : "s"}`
  const side = perSideLabel(exercise)
  const suffix = side ? ` ${side}` : ""
  if (slot.reps) {
    const [lo, hi] = slot.reps
    return `${sets} of ${lo === hi ? lo : `${lo} to ${hi}`} reps${suffix}`
  }
  if (slot.durationSeconds != null) return `${sets} of ${spokenSeconds(slot.durationSeconds)}${suffix}`
  return sets
}

/**
 * Which load step applies to an exercise, from its equipment. Matches the engine's
 * lib/engine/progression.ts loadKindOf, so the stepper moves in the steps the engine recommends:
 * kettlebells (without dumbbells) step to the next standard bell.
 */
export function loadKindFor(exercise: Pick<Exercise, "equipment"> | undefined): LoadKind {
  if (!exercise) return "other"
  const has = (...kinds: Equipment[]) => kinds.some((k) => exercise.equipment.includes(k))
  if (has("barbell", "trap_bar", "ez_bar", "smith_machine", "landmine")) return "barbell"
  if (has("dumbbell")) return "dumbbell"
  if (has("kettlebell")) return "kettlebell"
  if (has("machine", "cable")) return "machine"
  return "other"
}

/**
 * Whether a set asks how many reps were left: weighted rep work on a starting estimate, or a set
 * logged at the top of the range. Progression only recalibrates the load from logged effort
 * (SetLog.rpe = 10 - RIR, lib/engine/progression.ts recommendWeight), so these are the sets where
 * one tap saves a session of guessing.
 */
export function asksForRir(slot: Pick<WorkoutExercise, "reps" | "weightSource">, weighted: boolean, timed: boolean, reps: number | null): boolean {
  if (!weighted || timed || !slot.reps) return false
  return slot.weightSource === "estimate" || (reps != null && reps >= slot.reps[1])
}

/** Whether a set for this exercise carries an external load worth logging. */
export function usesWeight(exercise: Pick<Exercise, "loadType"> | undefined): boolean {
  return exercise?.loadType === "external" || exercise?.loadType === "assisted"
}

export interface DefaultSetOverrides {
  weightKg?: number | null
  reps?: number | null
  durationSeconds?: number | null
}

/**
 * Reps assumed for a set the user did not count: the bottom of the prescribed range. A plain
 * "done" means the prescription was met, not beaten, so progression holds the load until the
 * user logs reps at the top of the range (see lib/engine/progression.ts `recommendWeight`).
 * null for timed work or a slot without a rep range.
 */
export function defaultRepsFor(slot: Pick<WorkoutExercise, "reps" | "durationSeconds">): number | null {
  if (isTimedSlot(slot) || !slot.reps) return null
  return slot.reps[0]
}

/**
 * The set logs a plain swipe-right records: one completed set per prescribed set at the
 * recommended weight and the bottom of the rep range (or the slot duration for timed work).
 */
export function buildDefaultSets(
  slot: WorkoutExercise,
  exercise: Exercise | undefined,
  overrides: DefaultSetOverrides = {},
): SetLog[] {
  const timed = isTimedSlot(slot)
  const weightKg =
    overrides.weightKg !== undefined ? overrides.weightKg : usesWeight(exercise) ? slot.recommendedWeightKg : null
  const reps = overrides.reps !== undefined ? overrides.reps : defaultRepsFor(slot)
  const durationSeconds =
    overrides.durationSeconds !== undefined ? overrides.durationSeconds : timed ? slot.durationSeconds : null
  return Array.from({ length: Math.max(1, slot.sets) }, (_, i) => ({
    setNumber: i + 1,
    weightKg,
    reps,
    durationSeconds,
    completed: true,
  }))
}

/** One coach tip per slot, rotating by slot index so a repeated exercise shows a different cue. */
export function coachTipFor(exercise: Pick<Exercise, "coachTips"> | undefined, index: number): string | null {
  if (!exercise || exercise.coachTips.length === 0) return null
  return exercise.coachTips[((index % exercise.coachTips.length) + exercise.coachTips.length) % exercise.coachTips.length] ?? null
}

/** "Previous: 60 kg × 8, 60 × 8" style summary of a session's completed sets. */
export function summarizeSets(sets: SetLog[], formatKg: (kg: number) => string): string {
  const done = sets.filter((s) => s.completed)
  if (done.length === 0) return "—"
  return done
    .map((s) => {
      if (s.durationSeconds != null && s.reps == null) return formatSeconds(s.durationSeconds)
      const w = s.weightKg != null ? formatKg(s.weightKg) : null
      const r = s.reps != null ? `${s.reps}` : "—"
      return w ? `${w} × ${r}` : `${r} reps`
    })
    .join(", ")
}
