/**
 * Static exercise library aggregator.
 *
 * Each category file exports a typed `Exercise[]`. This module merges them and
 * builds lookup indexes. Import from "@/lib/exercises" everywhere; never import
 * category files directly from UI code.
 */
import type { Exercise, ExerciseCategory, Muscle, MuscleGroup, MovementPattern } from "./types"
import { MUSCLE_TO_GROUP } from "./types"
import { chestExercises } from "./chest"
import { shoulderExercises } from "./shoulders"
import { backExercises } from "./back"
import { bicepsExercises } from "./biceps"
import { tricepsExercises } from "./triceps"
import { legExercises } from "./legs"
import { gluteExercises } from "./glutes"
import { coreExercises } from "./core"
import { fullBodyExercises } from "./full-body"
import { cardioExercises } from "./cardio"
import { mobilityExercises } from "./mobility"
import { warmupExercises } from "./warmup"
import { cooldownExercises } from "./cooldown"

export * from "./types"

export const EXERCISES: readonly Exercise[] = [
  ...chestExercises,
  ...shoulderExercises,
  ...backExercises,
  ...bicepsExercises,
  ...tricepsExercises,
  ...legExercises,
  ...gluteExercises,
  ...coreExercises,
  ...fullBodyExercises,
  ...cardioExercises,
  ...mobilityExercises,
  ...warmupExercises,
  ...cooldownExercises,
]

const byId = new Map<string, Exercise>()
const bySlug = new Map<string, Exercise>()
const byCategory = new Map<ExerciseCategory, Exercise[]>()
const byPrimaryMuscle = new Map<Muscle, Exercise[]>()
const byMuscleGroup = new Map<MuscleGroup, Exercise[]>()
const byPattern = new Map<MovementPattern, Exercise[]>()

for (const ex of EXERCISES) {
  byId.set(ex.id, ex)
  bySlug.set(ex.slug, ex)
  push(byCategory, ex.category, ex)
  push(byPrimaryMuscle, ex.primaryMuscle, ex)
  push(byMuscleGroup, MUSCLE_TO_GROUP[ex.primaryMuscle], ex)
  push(byPattern, ex.movementPattern, ex)
}

function push<K>(map: Map<K, Exercise[]>, key: K, ex: Exercise) {
  const list = map.get(key)
  if (list) list.push(ex)
  else map.set(key, [ex])
}

export function getExercise(id: string): Exercise | undefined {
  return byId.get(id)
}

/** Throws if the id is unknown. Use when the id is guaranteed (e.g. from a generated workout). */
export function requireExercise(id: string): Exercise {
  const ex = byId.get(id)
  if (!ex) throw new Error(`Unknown exercise id: ${id}`)
  return ex
}

export function getExerciseBySlug(slug: string): Exercise | undefined {
  return bySlug.get(slug)
}

export function exercisesByCategory(category: ExerciseCategory): readonly Exercise[] {
  return byCategory.get(category) ?? []
}

export function exercisesByPrimaryMuscle(muscle: Muscle): readonly Exercise[] {
  return byPrimaryMuscle.get(muscle) ?? []
}

export function exercisesByMuscleGroup(group: MuscleGroup): readonly Exercise[] {
  return byMuscleGroup.get(group) ?? []
}

export function exercisesByPattern(pattern: MovementPattern): readonly Exercise[] {
  return byPattern.get(pattern) ?? []
}

export function muscleGroupOf(exercise: Exercise): MuscleGroup {
  return MUSCLE_TO_GROUP[exercise.primaryMuscle]
}

/** All muscle groups an exercise meaningfully trains (primary first, then secondary, de-duplicated). */
export function muscleGroupsOf(exercise: Exercise): MuscleGroup[] {
  const out: MuscleGroup[] = [MUSCLE_TO_GROUP[exercise.primaryMuscle]]
  for (const m of exercise.secondaryMuscles) {
    const g = MUSCLE_TO_GROUP[m]
    if (!out.includes(g)) out.push(g)
  }
  return out
}
