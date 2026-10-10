"use client"

import { useMemo } from "react"

import {
  ExerciseDetailsContent,
  type ExerciseAlternative,
} from "@/components/workout/exercise-details-content"
import type { WorkoutExercise } from "@/lib/engine/types"
import { getExercise } from "@/lib/exercises"
import { cn } from "@/lib/utils"

export interface ExerciseDetailsProps {
  exerciseId: string
  /** Hide the top media block (e.g. when the caller shows it already). */
  hideMedia?: boolean
  /** Show an alternative in place instead of navigating to /exercise/[slug]. */
  onAlternativeSelect?: (exerciseId: string) => void
  /** Today's prescription for this exercise, shown at the top. */
  slot?: WorkoutExercise
  className?: string
}

/**
 * Full exercise reference looked up by id, for screens that already ship the exercise library
 * (the deck and overview drawers). /exercise/[slug] resolves the exercise on the server and
 * renders ExerciseDetailsContent directly, so its client bundle stays free of the library.
 */
export function ExerciseDetails({ exerciseId, className, ...rest }: ExerciseDetailsProps) {
  const exercise = getExercise(exerciseId)
  const alternatives = useMemo<ExerciseAlternative[]>(
    () => (exercise?.alternativeExercises ?? []).map((id) => getExercise(id)).filter((e) => e !== undefined),
    [exercise],
  )

  if (!exercise) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)} role="status">
        This exercise is not in the library.
      </p>
    )
  }

  return <ExerciseDetailsContent exercise={exercise} alternatives={alternatives} className={className} {...rest} />
}
