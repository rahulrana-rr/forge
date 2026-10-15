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

/** Assigned-program steps (lib/exercises/types.ts tag "program_only"): never generated or offered by the engine. */
export const PROGRAM_ONLY_TAG = "program_only"

export function isProgramOnly(exercise: Exercise): boolean {
  return !!exercise.tags?.includes(PROGRAM_ONLY_TAG)
}

/** The exercises the engine may generate from: every library entry except assigned-program steps. */
export function generationPool(lib: Library): readonly Exercise[] {
  let pool = POOLS.get(lib.all)
  if (!pool) {
    pool = lib.all.some(isProgramOnly) ? lib.all.filter((e) => !isProgramOnly(e)) : lib.all
    POOLS.set(lib.all, pool)
  }
  return pool
}

const POOLS = new WeakMap<readonly Exercise[], readonly Exercise[]>()
