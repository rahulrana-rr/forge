"use client"

import { useMemo } from "react"

import type { EngineInput, Workout } from "@/lib/engine/types"
import { useHistoryStore, useProfileStore } from "@/lib/store"

/**
 * Reconstructs the EngineInput that produced (or would reproduce) `workout` from the profile and
 * history stores, for explainWorkout / replacementCandidates in the UI. Uses the workout's own
 * date and generatedAt so the result is stable across renders.
 */
export function useEngineInput(workout: Workout | null): EngineInput | null {
  const profile = useProfileStore((s) => s.profile)
  const workouts = useHistoryStore((s) => s.workouts)
  const progress = useHistoryStore((s) => s.progress)

  return useMemo(() => {
    if (!profile || !workout) return null
    // `workouts` is a dependency so the 21-day window refreshes when history changes.
    void workouts
    const history = useHistoryStore.getState().recent(21)
    return {
      profile,
      history,
      progress,
      date: workout.date,
      now: workout.generatedAt,
      seed: workout.seed,
    }
  }, [profile, workout, workouts, progress])
}
