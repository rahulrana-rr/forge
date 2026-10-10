/**
 * Workout engine public API. Pure and deterministic: no I/O, no Date.now(), no Math.random().
 */
import type { EngineInput, ReplaceOptions, ReplacementCandidate, Workout } from "./types"
import { generateWorkout as generate } from "./generate"
import { replaceExercise as replace, replacementCandidates as candidates } from "./replace"
import { estimateDurationMinutes as estimate } from "./duration"
import { explainWorkout as explain } from "./explain"

export * from "./types"

export function generateWorkout(input: EngineInput): Workout {
  return generate(input)
}

export function replaceExercise(
  workout: Workout,
  slotId: string,
  input: EngineInput,
  options?: ReplaceOptions,
): Workout | null {
  return replace(workout, slotId, input, options)
}

export function replacementCandidates(
  workout: Workout,
  slotId: string,
  input: EngineInput,
  limit?: number,
): ReplacementCandidate[] {
  return candidates(workout, slotId, input, limit)
}

export function estimateDurationMinutes(workout: Workout): number {
  return estimate(workout)
}

export function explainWorkout(workout: Workout, input: EngineInput): string[] {
  return explain(workout, input)
}
