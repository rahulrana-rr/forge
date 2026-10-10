/**
 * Exercise lookup used by the engine. Defaults to the static library; tests inject fixtures.
 */
import { EXERCISES, getExercise } from "@/lib/exercises"
import type { Exercise } from "@/lib/exercises/types"

export interface Library {
  all: readonly Exercise[]
  get(id: string): Exercise | undefined
}

export const DEFAULT_LIBRARY: Library = { all: EXERCISES, get: getExercise }

export function libraryFrom(pool: readonly Exercise[]): Library {
  if (pool === EXERCISES) return DEFAULT_LIBRARY
  const byId = new Map(pool.map((e) => [e.id, e]))
  return { all: pool, get: (id) => byId.get(id) }
}
