/**
 * History store: completed workouts and derived per-exercise progress, persisted to IndexedDB
 * ("forge:history"). Progress is folded incrementally on add and rebuilt on merge/remove.
 */
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import type { HistoryState } from "./types"
import type { CompletedWorkout, ExerciseProgress } from "@/lib/domain/types"
import {
  applyWorkoutToProgress,
  computeStreak,
  rebuildProgress,
} from "@/lib/domain/progress"
import { idbStorage, onIdbKeyChange } from "@/lib/persistence/idb"
import { requestPersistentStorage } from "@/lib/persistence/durability"
import { daysBetween, todayKey } from "@/lib/dates"
import { onRehydrate, type Hydratable } from "./hydration"
import { useProfileStore } from "./profile-store"

export const HISTORY_STORAGE_KEY = "forge:history"
/**
 * 2: ExerciseProgress gained `repsAtBestWeight`. Progress is derived, so migrating any older
 * version rebuilds it from the stored workouts.
 */
export const HISTORY_SCHEMA_VERSION = 2

export type HistoryStore = HistoryState &
  Hydratable & {
    /**
     * Drops workouts deleted elsewhere (another device, via sync). Unlike removeWorkout it does
     * not announce a user delete, so nothing is queued to be sent back to the server.
     */
    dropRemote(ids: readonly string[]): void
  }

type RemovedListener = (workout: CompletedWorkout) => void
const removedListeners = new Set<RemovedListener>()

/**
 * Subscribes to workouts the user deleted on this device (removeWorkout only; not clearAll,
 * merges or remote drops). The sync store uses it to queue the delete for the server, which
 * keeps this module free of a dependency on the sync layer.
 */
export function onWorkoutRemoved(listener: RemovedListener): () => void {
  removedListeners.add(listener)
  return () => removedListeners.delete(listener)
}

/** Key-order-independent JSON equality for plain data (workouts as stored and as pulled). */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (typeof a !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return a.length === other.length && a.every((v, i) => sameData(v, other[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)])
  for (const key of keys) {
    // A missing key and an explicit undefined are the same once serialized.
    if (!sameData(ao[key], bo[key])) return false
  }
  return true
}

export interface PersistedHistory {
  workouts: CompletedWorkout[]
  progress: Record<string, ExerciseProgress>
}

/** Newest first by completion time, then by date, then id for a stable order. */
export function sortNewestFirst(
  workouts: CompletedWorkout[]
): CompletedWorkout[] {
  return [...workouts].sort((a, b) => {
    if (a.completedAt !== b.completedAt)
      return a.completedAt < b.completedAt ? 1 : -1
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}

export function migrateHistory(
  persisted: unknown,
  version: number
): PersistedHistory {
  if (version === HISTORY_SCHEMA_VERSION && isPersistedHistory(persisted)) {
    return {
      workouts: persisted.workouts,
      progress: rebuildProgress(persisted.workouts),
    }
  }
  // Unknown shape: keep any workouts we can recognise, recompute everything derived.
  if (isPersistedHistory(persisted)) {
    return {
      workouts: persisted.workouts,
      progress: rebuildProgress(persisted.workouts),
    }
  }
  return { workouts: [], progress: {} }
}

function isPersistedHistory(value: unknown): value is PersistedHistory {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { workouts?: unknown }).workouts)
  )
}

export const useHistoryStore = create<HistoryStore>()(
  persist(
    (set, get) => ({
      hydrated: false,
      workouts: [],
      progress: {},
      // Only write on a real change: a re-read triggered by another tab must not write back and
      // announce again, or two tabs would bounce the key between them forever.
      setHydrated: (hydrated) => {
        if (get().hydrated !== hydrated) set({ hydrated })
      },

      addWorkout(workout) {
        const { workouts, progress } = get()
        const exists = workouts.some((w) => w.id === workout.id)
        if (exists) {
          const next = sortNewestFirst(
            workouts.map((w) => (w.id === workout.id ? workout : w))
          )
          set({ workouts: next, progress: rebuildProgress(next) })
          return
        }
        set({
          workouts: sortNewestFirst([workout, ...workouts]),
          progress: applyWorkoutToProgress(progress, workout),
        })
        // History now holds something worth keeping: ask the browser not to evict it.
        requestPersistentStorage()
      },

      mergeRemote(remote) {
        if (!remote.length) return
        const byId = new Map(get().workouts.map((w) => [w.id, w] as const))
        let changed = false
        for (const w of remote) {
          const incoming = { ...w, synced: true }
          // Pulls overlap by design (the cursor trails server time), so most re-delivered rows are
          // already here unchanged. Skipping them avoids a write, a progress rebuild and a history
          // change event that would trigger another flush.
          if (sameData(byId.get(w.id), incoming)) continue
          byId.set(w.id, incoming)
          changed = true
        }
        if (!changed) return
        const next = sortNewestFirst(Array.from(byId.values()))
        set({ workouts: next, progress: rebuildProgress(next) })
      },

      dropRemote(ids) {
        if (!ids.length) return
        const gone = new Set(ids)
        const next = get().workouts.filter((w) => !gone.has(w.id))
        if (next.length === get().workouts.length) return
        set({ workouts: next, progress: rebuildProgress(next) })
      },

      markSynced(ids) {
        if (!ids.length) return
        const wanted = new Set(ids)
        let changed = false
        const next = get().workouts.map((w) => {
          if (!wanted.has(w.id) || w.synced) return w
          changed = true
          return { ...w, synced: true }
        })
        if (changed) set({ workouts: next })
      },

      removeWorkout(id) {
        const removed = get().workouts.find((w) => w.id === id)
        if (!removed) return
        const next = get().workouts.filter((w) => w.id !== id)
        set({ workouts: next, progress: rebuildProgress(next) })
        for (const listener of removedListeners) listener(removed)
      },

      getWorkout(id) {
        return get().workouts.find((w) => w.id === id)
      },

      streak() {
        // The allowed gap between sessions follows the plan, so a 2- or 3-day lifter who trains
        // on schedule keeps their streak over the long rest gap of the week.
        return computeStreak(
          get().workouts,
          todayKey(),
          useProfileStore.getState().profile?.trainingDaysPerWeek
        )
      },

      recent(days) {
        const today = todayKey()
        return get().workouts.filter((w) => {
          const diff = daysBetween(w.date, today)
          return diff >= 0 && diff < days
        })
      },

      clearAll() {
        set({ workouts: [], progress: {} })
      },
    }),
    {
      name: HISTORY_STORAGE_KEY,
      version: HISTORY_SCHEMA_VERSION,
      storage: createJSONStorage<PersistedHistory>(() => idbStorage),
      partialize: (state): PersistedHistory => ({
        workouts: state.workouts,
        progress: state.progress,
      }),
      migrate: migrateHistory,
      skipHydration: false,
      onRehydrateStorage: onRehydrate<HistoryStore>(),
    }
  )
)

// History is one IndexedDB blob that every write replaces in full. When another tab or app window
// saves, re-read it so this tab's next write (a delete, a save, a sync) does not erase that save.
onIdbKeyChange(HISTORY_STORAGE_KEY, () => {
  void useHistoryStore.persist.rehydrate()
})
