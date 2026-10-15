"use client"

/**
 * Coach review state on the client.
 *
 * - One entry per workout id, persisted in localStorage (last 7 kept).
 * - A review is requested only while the workout is still "ready" (not started).
 * - Corrections are applied only if the plan is still exactly the one that was reviewed, and the
 *   pre-coach plan is kept so the user can switch back.
 * - Assigned-program workouts (Workout.program) are coach-approved already and are never sent.
 * - Fail safe: offline, not configured, refused, rate limited, error or switched off all show as
 *   "not reviewed". Nothing but a successful review response ever shows as approved.
 */
import { create } from "zustand"
import { persist } from "zustand/middleware"

import type { EngineInput, Workout } from "@/lib/engine"
import { createLocalStorage } from "@/lib/persistence/local-storage"
import { useHistoryStore, useProfileStore, useWorkoutStore } from "@/lib/store"
import { applyCoachReview, type CoachChange } from "./apply"
import { buildCoachRequest, workoutReviewKey } from "./context"
import type { CoachErrorBody, CoachResponse } from "./schema"

export type CoachStatus = "pending" | "reviewed" | "unavailable" | "error" | "off"

export interface CoachEntry {
  workoutId: string
  /** Key of the plan that was sent for review. */
  reviewedKey: string
  /** Key of the plan after the coach's corrections were applied (equals reviewedKey when none). */
  appliedKey: string | null
  status: CoachStatus
  response: CoachResponse | null
  changes: CoachChange[]
  /** The engine's plan before corrections, for "use the original plan". */
  original: Workout | null
  usingOriginal: boolean
  /** Why there is no review (status unavailable / error). */
  reason: string | null
  updatedAt: string
}

interface CoachState {
  hydrated: boolean
  /** Internal: flipped by the persist middleware once localStorage has been read. */
  setHydrated(hydrated: boolean): void
  enabled: boolean
  entries: Record<string, CoachEntry>
  setEnabled(enabled: boolean): void
  /** Request a review for today's workout if it has none for its current plan. Safe to call often. */
  ensureReview(force?: boolean): void
  /** Switch between the coach-corrected plan and the engine's original (only before starting). */
  useOriginal(workoutId: string, original: boolean): void
}

const MAX_ENTRIES = 7
const TIMEOUT_MS = 120_000
const inFlight = new Set<string>()

function engineInputFor(workout: Workout): EngineInput | null {
  const profile = useProfileStore.getState().profile
  if (!profile) return null
  return {
    profile,
    history: useHistoryStore.getState().recent(21),
    progress: useHistoryStore.getState().progress,
    date: workout.date,
    now: workout.generatedAt,
    seed: workout.seed,
  }
}

/** Replace today's plan, but only if it has not started and is still the plan we reviewed. */
function replaceReadyPlan(workoutId: string, expectedKey: string, next: Workout): boolean {
  let replaced = false
  useWorkoutStore.setState((s) => {
    const active = s.active
    if (!active || active.status !== "ready" || active.workout.id !== workoutId) return s
    if (workoutReviewKey(active.workout) !== expectedKey) return s
    const logs = Object.fromEntries(
      next.exercises.map((e) => [
        e.slotId,
        active.logs[e.slotId]?.exerciseId === e.exerciseId
          ? active.logs[e.slotId]
          : { slotId: e.slotId, exerciseId: e.exerciseId, status: "pending" as const, sets: [] },
      ]),
    )
    replaced = true
    return { active: { ...active, workout: next, logs, currentIndex: 0, undoStack: [] } }
  })
  return replaced
}

function messageFor(code: CoachErrorBody["error"]["code"] | "offline" | "timeout" | "network"): string {
  switch (code) {
    case "offline":
      return "You're offline. The coach will review this workout when you reconnect."
    case "coach_unavailable":
      return "The coach isn't set up on this server yet."
    case "rate_limited":
      return "The coach has reviewed a lot of workouts this hour. Try again later."
    case "coach_refused":
      return "The coach declined to review this workout."
    case "timeout":
      return "The coach took too long to answer."
    case "invalid_request":
      return "This workout couldn't be sent for review."
    default:
      return "The coach couldn't review this workout."
  }
}

export const useCoachStore = create<CoachState>()(
  persist(
    (set, get) => {
      const put = (entry: CoachEntry) =>
        set((s) => {
          const entries = { ...s.entries, [entry.workoutId]: entry }
          const ids = Object.values(entries)
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
            .map((e) => e.workoutId)
          for (const id of ids.slice(MAX_ENTRIES)) delete entries[id]
          return { entries }
        })

      return {
        hydrated: false,
        enabled: true,
        entries: {},

        setHydrated(hydrated) {
          set({ hydrated })
        },

        setEnabled(enabled) {
          set({ enabled })
          if (enabled) get().ensureReview(true)
        },

        ensureReview(force = false) {
          const active = useWorkoutStore.getState().active
          if (!active || active.status !== "ready") return
          const workout = active.workout
          // An assigned program is already coach-approved: it is never sent for review or corrected.
          if (workout.program) return
          const key = workoutReviewKey(workout)
          const existing = get().entries[workout.id]
          const now = new Date().toISOString()
          const base: CoachEntry = {
            workoutId: workout.id,
            reviewedKey: key,
            appliedKey: null,
            status: "pending",
            response: null,
            changes: [],
            original: null,
            usingOriginal: false,
            reason: null,
            updatedAt: now,
          }

          if (!get().enabled) {
            if (existing?.status !== "off") put({ ...(existing ?? base), status: "off", reason: "Coach review is switched off in Profile.", updatedAt: now })
            return
          }
          // Already reviewed (or being reviewed) for this exact plan, before or after corrections.
          if (existing && !force) {
            const current = existing.reviewedKey === key || existing.appliedKey === key || (existing.usingOriginal && existing.reviewedKey === key)
            if (current && (existing.status === "reviewed" || existing.status === "pending")) return
            if (current && existing.status === "unavailable" && existing.reason === messageFor("coach_unavailable")) return
          }
          if (inFlight.has(workout.id)) return
          if (typeof navigator !== "undefined" && navigator.onLine === false) {
            put({ ...base, status: "unavailable", reason: messageFor("offline") })
            return
          }
          const input = engineInputFor(workout)
          if (!input) return

          put(base)
          inFlight.add(workout.id)
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
          void (async () => {
            try {
              const res = await fetch("/api/coach/review", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(buildCoachRequest(workout, input)),
                signal: controller.signal,
              })
              if (!res.ok) {
                const body = (await res.json().catch(() => null)) as CoachErrorBody | null
                const code = body?.error.code ?? "coach_failed"
                put({ ...base, status: code === "coach_unavailable" || code === "rate_limited" ? "unavailable" : "error", reason: messageFor(code), updatedAt: new Date().toISOString() })
                return
              }
              const response = (await res.json()) as CoachResponse
              const { workout: corrected, changes } = applyCoachReview(workout, response.review, input)
              const applied = changes.length > 0 && replaceReadyPlan(workout.id, key, corrected)
              put({
                ...base,
                status: "reviewed",
                response,
                changes: applied ? changes : [],
                appliedKey: applied ? workoutReviewKey(corrected) : key,
                original: applied ? workout : null,
                reason: changes.length > 0 && !applied ? "You started before the coach finished, so its changes were not applied." : null,
                updatedAt: new Date().toISOString(),
              })
            } catch (err) {
              const aborted = err instanceof DOMException && err.name === "AbortError"
              put({ ...base, status: "error", reason: messageFor(aborted ? "timeout" : "network"), updatedAt: new Date().toISOString() })
            } finally {
              clearTimeout(timer)
              inFlight.delete(workout.id)
            }
          })()
        },

        useOriginal(workoutId, original) {
          const entry = get().entries[workoutId]
          const active = useWorkoutStore.getState().active
          if (!entry || !entry.original || !active || active.workout.id !== workoutId || active.status !== "ready") return
          const input = engineInputFor(entry.original)
          if (!input || !entry.response) return
          if (original) {
            if (entry.usingOriginal) return
            const ok = replaceReadyPlan(workoutId, entry.appliedKey ?? "", entry.original)
            if (ok) put({ ...entry, usingOriginal: true, updatedAt: new Date().toISOString() })
          } else {
            if (!entry.usingOriginal) return
            const { workout: corrected } = applyCoachReview(entry.original, entry.response.review, input)
            const ok = replaceReadyPlan(workoutId, entry.reviewedKey, corrected)
            if (ok) put({ ...entry, usingOriginal: false, appliedKey: workoutReviewKey(corrected), updatedAt: new Date().toISOString() })
          }
        },
      }
    },
    {
      name: "forge:coach",
      version: 1,
      storage: createLocalStorage<Pick<CoachState, "enabled" | "entries">>(),
      partialize: (s) => ({ enabled: s.enabled, entries: s.entries }),
      // localStorage hydrates synchronously while the store is being created, so use the state
      // handed to the callback rather than the not-yet-assigned hook.
      onRehydrateStorage: (pre) => (state) => {
        ;(state ?? pre).setHydrated(true)
      },
    },
  ),
)

/** Retry pending/unavailable reviews when the device comes back online. */
if (typeof window !== "undefined") {
  window.addEventListener("online", () => useCoachStore.getState().ensureReview())
}
