/**
 * Active workout store: today's generated workout, per-slot logs, undo stack and the rest timer.
 * Persisted to localStorage ("forge:active-workout") so a reload mid-session loses nothing; the
 * rest timer is stored as an absolute `endsAt` so it keeps counting across reloads.
 *
 * Day boundaries: a workout the user acts on today is today's workout. A plan left open overnight,
 * a session that crosses midnight, or one resumed the next morning is re-dated to today when the
 * user starts, resumes or acts on it, so the Today screen never strands it behind the "still in
 * progress from earlier" prompt. The saved record keeps the day the session was started. A session
 * from an earlier day left idle for STALE_WORKOUT_MS is closed by ensureToday: logged main work is
 * saved, anything else is dropped, and today's workout is generated.
 */
import { create } from "zustand"
import { persist } from "zustand/middleware"
import type {
  ActiveWorkout,
  RestTimerState,
  UndoEntry,
  WorkoutState,
} from "./types"
import type { EngineInput, Workout, WorkoutExercise } from "@/lib/engine/types"
import type {
  CompletedExercise,
  CompletedWorkout,
  ExerciseLog,
  UserProfile,
} from "@/lib/domain/types"
import {
  generateWorkout,
  replaceExercise,
  replacementCandidates,
} from "@/lib/engine"
import { computeTotals, detectPersonalRecords } from "@/lib/domain/progress"
import {
  createLocalStorage,
  onLocalStorageKeyChange,
} from "@/lib/persistence/local-storage"
import { newId } from "@/lib/ids"
import { dateKey, todayKey } from "@/lib/dates"
import { useProfileStore } from "./profile-store"
import { useHistoryStore } from "./history-store"
import { useSyncStore } from "@/lib/sync/sync-store"
import { onRehydrate, type Hydratable } from "./hydration"

export const WORKOUT_STORAGE_KEY = "forge:active-workout"
export const WORKOUT_SCHEMA_VERSION = 1
export const UNDO_STACK_CAP = 20
/**
 * Undo entries written to localStorage. Memory keeps UNDO_STACK_CAP, but every entry is a full
 * snapshot and every action re-serialises the persisted state synchronously, so only the last few
 * survive a reload.
 */
export const PERSISTED_UNDO_CAP = 3
/** History window handed to the engine (days). */
export const ENGINE_HISTORY_DAYS = 21
/** A session from an earlier day with no activity for this long is over (see ensureToday). */
export const STALE_WORKOUT_MS = 6 * 60 * 60 * 1000

export type WorkoutStore = WorkoutState & Hydratable

interface PersistedWorkout {
  active: ActiveWorkout | null
  timer: RestTimerState
}

export const IDLE_TIMER: RestTimerState = {
  totalSeconds: null,
  endsAt: null,
  pausedRemaining: null,
  running: false,
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

function buildEngineInput(
  profile: UserProfile,
  date: string,
  seed?: number
): EngineInput {
  const history = useHistoryStore.getState()
  return {
    profile,
    history: history.recent(ENGINE_HISTORY_DAYS),
    progress: history.progress,
    date,
    now: new Date().toISOString(),
    ...(seed !== undefined ? { seed } : {}),
  }
}

function pendingLog(slot: WorkoutExercise, tried?: string[]): ExerciseLog {
  return {
    slotId: slot.slotId,
    exerciseId: slot.exerciseId,
    status: "pending",
    sets: [],
    triedExerciseIds: tried ?? [slot.exerciseId],
  }
}

function createActive(workout: Workout): ActiveWorkout {
  const logs: Record<string, ExerciseLog> = {}
  for (const slot of workout.exercises) logs[slot.slotId] = pendingLog(slot)
  return {
    workout,
    status: "ready",
    currentIndex: 0,
    logs,
    startedAt: null,
    pausedAt: null,
    pausedTotalMs: 0,
    completedAt: null,
    undoStack: [],
    savedWorkoutId: null,
  }
}

function snapshot(active: ActiveWorkout, kind: UndoEntry["kind"]): UndoEntry {
  return {
    kind,
    workout: active.workout,
    logs: active.logs,
    currentIndex: active.currentIndex,
  }
}

function pushUndo(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  const next = [...stack, entry]
  return next.length > UNDO_STACK_CAP
    ? next.slice(next.length - UNDO_STACK_CAP)
    : next
}

function isInProgress(active: ActiveWorkout): boolean {
  return active.status === "active" || active.status === "paused"
}

function elapsedOf(active: ActiveWorkout, nowMs: number): number {
  if (!active.startedAt) return 0
  const start = Date.parse(active.startedAt)
  const end = active.completedAt
    ? Date.parse(active.completedAt)
    : (active.pausedAt ?? nowMs)
  return Math.max(0, Math.floor((end - start - active.pausedTotalMs) / 1000))
}

/** Re-dates a plan or session carried over from an earlier day to today (see the file comment). */
function forToday(active: ActiveWorkout): ActiveWorkout {
  const today = todayKey()
  if (active.workout.date === today) return active
  return { ...active, workout: { ...active.workout, date: today } }
}

/** The calendar day a session belongs to: the day it was started, else the day it was planned for. */
function sessionDay(active: ActiveWorkout): string {
  const started = active.startedAt ? new Date(active.startedAt) : null
  return started && !Number.isNaN(started.getTime())
    ? dateKey(started)
    : active.workout.date
}

/** Epoch ms of the last thing the user did in the session: start, pause or a completed slot. */
function lastActivityMs(active: ActiveWorkout): number {
  const times: number[] = []
  for (const iso of [
    active.workout.generatedAt,
    active.startedAt,
    ...Object.values(active.logs).map((log) => log.completedAt),
  ]) {
    const ms = iso ? Date.parse(iso) : Number.NaN
    if (Number.isFinite(ms)) times.push(ms)
  }
  if (active.pausedAt != null) times.push(active.pausedAt)
  return times.length ? Math.max(...times) : 0
}

/**
 * When a session ends now. A session started on an earlier day and saved later (from the resume
 * prompt's End workout, or after a long break) would otherwise record the whole gap as training
 * time, so it ends at the last thing the user did in it instead.
 */
function sessionEndMs(active: ActiveWorkout, nowMs: number): number {
  if (!active.startedAt || sessionDay(active) >= todayKey()) return nowMs
  const last = lastActivityMs(active)
  return last > 0 ? Math.min(nowMs, last) : nowMs
}

/**
 * The CompletedWorkout for `active` as of `endMs`, or null when no main-phase exercise was
 * completed: warm-up drills and stretches alone are not a workout (they would otherwise be
 * saved with zero sets, advance the split rotation and count toward the streak).
 */
function buildCompleted(
  active: ActiveWorkout,
  endMs: number
): CompletedWorkout | null {
  const endIso = new Date(endMs).toISOString()
  const started = active.startedAt ?? endIso
  const exercises = toCompletedExercises(active, "skipped")
  const countable = exercises.some(
    (e) => e.status === "completed" && e.phase === "main"
  )
  if (!countable) return null

  const durationSeconds = elapsedOf({ ...active, startedAt: started }, endMs)
  const profile = useProfileStore.getState().profile
  const history = useHistoryStore.getState()
  const totals = computeTotals(exercises, {
    weightKg: profile?.weightKg ?? null,
    durationSeconds,
  })
  const personalRecords = detectPersonalRecords(
    exercises,
    history.progress,
    endIso
  )
  const workout = active.workout
  return {
    id: newId(),
    date: sessionDay({ ...active, startedAt: started }),
    title: workout.title,
    split: workout.split,
    focus: workout.focus,
    goal: workout.goal,
    startedAt: started,
    completedAt: endIso,
    durationSeconds,
    exercises,
    totals,
    personalRecords,
    engineVersion: workout.engineVersion,
    synced: false,
  }
}

function kickSync(): void {
  void useSyncStore
    .getState()
    .flush()
    .catch(() => {
      // Background sync failures are surfaced through the sync store's status.
    })
}

/** Converts slot logs to CompletedExercise entries; pending slots are dropped or marked skipped. */
function toCompletedExercises(
  active: ActiveWorkout,
  pendingAs: "drop" | "skipped"
): CompletedExercise[] {
  const out: CompletedExercise[] = []
  for (const slot of active.workout.exercises) {
    const log = active.logs[slot.slotId]
    if (!log) continue
    if (log.status === "pending" && pendingAs === "drop") continue
    out.push({
      slotId: slot.slotId,
      exerciseId: log.exerciseId,
      role: slot.role,
      phase: slot.phase,
      status: log.status === "pending" ? "skipped" : log.status,
      sets: log.sets,
      prescribedSets: slot.sets,
      prescribedReps: slot.reps,
      prescribedDurationSeconds: slot.durationSeconds,
      recommendedWeightKg: slot.recommendedWeightKg,
      // Lets progression treat a session logged from a starting estimate as calibration (F14).
      weightSource: slot.weightSource ?? null,
      // Progression carries an earned tempo, a shortened conditioning rest and a suggested harder
      // variation into the next session (coach round 2, R12).
      prescribedTempo: slot.tempo ?? null,
      prescribedRestSeconds: slot.restSeconds,
      suggestedExerciseId: slot.suggestedExerciseId ?? null,
    })
  }
  return out
}

function restTimerFor(seconds: number, nowMs: number): RestTimerState {
  const total = Math.max(0, Math.round(seconds))
  if (total === 0) return IDLE_TIMER
  return {
    totalSeconds: total,
    endsAt: nowMs + total * 1000,
    pausedRemaining: null,
    running: true,
  }
}

function remainingSeconds(timer: RestTimerState, nowMs: number): number {
  if (timer.running && timer.endsAt != null)
    return Math.max(0, Math.ceil((timer.endsAt - nowMs) / 1000))
  if (timer.pausedRemaining != null) return Math.max(0, timer.pausedRemaining)
  return 0
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const useWorkoutStore = create<WorkoutStore>()(
  persist(
    (set, get) => {
      /** Returns the active workout and its current slot when the user can act on it. */
      function current(): {
        active: ActiveWorkout
        slot: WorkoutExercise
        log: ExerciseLog
      } | null {
        const active = get().active
        if (!active || active.status === "completed") return null
        const slot = active.workout.exercises[active.currentIndex]
        if (!slot) return null
        const log = active.logs[slot.slotId] ?? pendingLog(slot)
        return { active, slot, log }
      }

      function generateFor(
        profile: UserProfile,
        date: string,
        seed?: number
      ): void {
        const workout = generateWorkout(buildEngineInput(profile, date, seed))
        set({ active: createActive(workout), timer: IDLE_TIMER })
      }

      /**
       * The user is acting on the workout: auto-start a "ready" one they act on without pressing
       * start, and make a carried-over one today's.
       */
      function started(active: ActiveWorkout, nowIso: string): ActiveWorkout {
        if (active.status !== "ready") return forToday(active)
        return forToday({
          ...active,
          status: "active",
          startedAt: active.startedAt ?? nowIso,
        })
      }

      function applyReplacement(
        active: ActiveWorkout,
        slot: WorkoutExercise,
        log: ExerciseLog,
        replaced: Workout
      ): ActiveWorkout {
        const newSlot = replaced.exercises.find((e) => e.slotId === slot.slotId)
        if (!newSlot) return active
        const tried = log.triedExerciseIds ?? [slot.exerciseId]
        const nextTried = tried.includes(newSlot.exerciseId)
          ? tried
          : [...tried, newSlot.exerciseId]
        return {
          ...active,
          workout: replaced,
          logs: {
            ...active.logs,
            [slot.slotId]: pendingLog(newSlot, nextTried),
          },
          undoStack: pushUndo(active.undoStack, snapshot(active, "replace")),
        }
      }

      function skipAndAdvance(
        active: ActiveWorkout,
        slot: WorkoutExercise,
        log: ExerciseLog
      ): ActiveWorkout {
        return {
          ...active,
          logs: {
            ...active.logs,
            [slot.slotId]: {
              ...log,
              status: "skipped",
              exerciseId: slot.exerciseId,
            },
          },
          currentIndex: active.currentIndex + 1,
          undoStack: pushUndo(active.undoStack, snapshot(active, "skip")),
        }
      }

      return {
        hydrated: false,
        active: null,
        timer: IDLE_TIMER,
        setHydrated: (hydrated) => {
          if (get().hydrated !== hydrated) set({ hydrated })
        },

        ensureToday() {
          const profile = useProfileStore.getState().profile
          if (!profile) return
          const today = todayKey()
          const active = get().active
          if (active) {
            if (active.status === "completed") {
              // A session that crossed midnight was re-dated while it ran; it belongs to the day
              // it started, so the next day still gets its own workout.
              if (sessionDay(active) === today) return
            } else if (active.workout.date === today) {
              return
            } else if (isInProgress(active)) {
              // In progress from an earlier day. Touched recently: keep it, so the user can resume
              // it (resuming makes it today's).
              const lastMs = lastActivityMs(active)
              if (Date.now() - lastMs < STALE_WORKOUT_MS) return
              // Abandoned: keep whatever main work was logged, then plan today afresh.
              const completed = buildCompleted(active, lastMs)
              if (completed) {
                useHistoryStore.getState().addWorkout(completed)
                generateFor(profile, today)
                kickSync()
                return
              }
            }
          }
          generateFor(profile, today)
        },

        regenerate() {
          const active = get().active
          const profile = useProfileStore.getState().profile
          if (!active || !profile || active.status !== "ready") return
          generateFor(profile, active.workout.date, active.workout.seed + 1)
        },

        start() {
          const active = get().active
          if (!active || active.status !== "ready") return
          // A plan left open overnight becomes today's when the user starts it.
          set({ active: started(active, new Date().toISOString()) })
        },

        pause() {
          const current = get().active
          if (!current || current.status !== "active") return
          const active = forToday(current)
          const now = Date.now()
          const timer = get().timer
          const next: RestTimerState = timer.running
            ? {
                ...timer,
                endsAt: null,
                running: false,
                pausedRemaining: remainingSeconds(timer, now),
              }
            : timer
          set({
            active: { ...active, status: "paused", pausedAt: now },
            timer: next,
          })
        },

        resume() {
          const current = get().active
          if (!current || !isInProgress(current)) return
          const active = forToday(current)
          if (active.status === "active") {
            // An active session from an earlier day: continuing it makes it today's.
            if (active !== current) set({ active })
            return
          }
          const now = Date.now()
          const pausedMs =
            active.pausedAt != null ? Math.max(0, now - active.pausedAt) : 0
          const timer = get().timer
          const next: RestTimerState =
            !timer.running &&
            timer.pausedRemaining != null &&
            timer.totalSeconds != null
              ? {
                  ...timer,
                  endsAt: now + timer.pausedRemaining * 1000,
                  running: true,
                  pausedRemaining: null,
                }
              : timer
          set({
            active: {
              ...active,
              status: "active",
              pausedAt: null,
              pausedTotalMs: active.pausedTotalMs + pausedMs,
            },
            timer: next,
          })
        },

        completeCurrent(sets) {
          const cur = current()
          // Paused: the clock is frozen and the deck is behind a modal; nothing may change it.
          if (!cur || cur.active.status === "paused") return
          const nowIso = new Date().toISOString()
          const nowMs = Date.now()
          const active = started(cur.active, nowIso)
          const nextIndex = active.currentIndex + 1
          const hasNext = nextIndex < active.workout.exercises.length
          const log: ExerciseLog = {
            ...cur.log,
            exerciseId: cur.slot.exerciseId,
            status: "completed",
            sets,
            completedAt: nowIso,
          }
          set({
            active: {
              ...active,
              logs: { ...active.logs, [cur.slot.slotId]: log },
              currentIndex: nextIndex,
              undoStack: pushUndo(
                active.undoStack,
                snapshot(cur.active, "complete")
              ),
            },
            // No rest after a cool-down stretch: the next thing is another stretch or the end.
            timer:
              hasNext && cur.slot.phase !== "cooldown" && cur.slot.restSeconds > 0
                ? restTimerFor(cur.slot.restSeconds, nowMs)
                : IDLE_TIMER,
          })
        },

        skipCurrent() {
          const cur = current()
          if (!cur || cur.active.status === "paused") return
          const profile = useProfileStore.getState().profile
          const active = started(cur.active, new Date().toISOString())
          const tried = cur.log.triedExerciseIds ?? [cur.slot.exerciseId]
          const exclude = Array.from(new Set([...tried, cur.slot.exerciseId]))
          const replaced = profile
            ? replaceExercise(
                active.workout,
                cur.slot.slotId,
                buildEngineInput(profile, active.workout.date),
                { exclude }
              )
            : null
          if (replaced) {
            set({
              active: applyReplacement(active, cur.slot, cur.log, replaced),
            })
            return
          }
          set({ active: skipAndAdvance(active, cur.slot, cur.log) })
        },

        replaceCurrent(exerciseId) {
          const cur = current()
          if (!cur || exerciseId === cur.slot.exerciseId) return
          const profile = useProfileStore.getState().profile
          if (!profile) return
          const active = forToday(cur.active)
          const replaced = replaceExercise(
            active.workout,
            cur.slot.slotId,
            buildEngineInput(profile, active.workout.date),
            {
              withExerciseId: exerciseId,
            }
          )
          if (!replaced) return
          set({
            active: applyReplacement(active, cur.slot, cur.log, replaced),
          })
        },

        candidatesForCurrent(limit) {
          const cur = current()
          const profile = useProfileStore.getState().profile
          if (!cur || !profile) return []
          return replacementCandidates(
            cur.active.workout,
            cur.slot.slotId,
            buildEngineInput(profile, cur.active.workout.date),
            limit
          )
        },

        skipWithoutReplace() {
          const cur = current()
          if (!cur || cur.active.status === "paused") return
          const active = started(cur.active, new Date().toISOString())
          set({ active: skipAndAdvance(active, cur.slot, cur.log) })
        },

        undo() {
          const active = get().active
          if (
            !active ||
            active.status === "completed" ||
            !active.undoStack.length
          )
            return
          const entry = active.undoStack[active.undoStack.length - 1]
          set({
            active: forToday({
              ...active,
              workout: entry.workout,
              logs: entry.logs,
              currentIndex: entry.currentIndex,
              undoStack: active.undoStack.slice(0, -1),
            }),
            // Only a completed slot starts a rest, so only undoing one cancels it; undoing a
            // replace or skip leaves a running rest alone.
            ...(entry.kind === "complete" ? { timer: IDLE_TIMER } : {}),
          })
        },

        canUndo() {
          const active = get().active
          return (
            !!active &&
            active.status !== "completed" &&
            active.undoStack.length > 0
          )
        },

        updateCurrentPrescription(patch) {
          const cur = current()
          if (!cur) return
          // A load the user sets by hand is theirs: it is no longer an estimate to confirm.
          const sourcePatch =
            patch.recommendedWeightKg !== undefined
              ? { weightSource: patch.recommendedWeightKg != null ? ("user" as const) : null }
              : {}
          const active = forToday(cur.active)
          const exercises = active.workout.exercises.map((e) =>
            e.slotId === cur.slot.slotId ? { ...e, ...patch, ...sourcePatch } : e
          )
          set({
            active: {
              ...active,
              workout: { ...active.workout, exercises },
            },
          })
        },

        goTo(index) {
          const active = get().active
          if (!active || active.status === "completed") return
          const max = Math.max(0, active.workout.exercises.length - 1)
          const clamped = Math.min(max, Math.max(0, Math.floor(index)))
          if (clamped === active.currentIndex) return
          set({ active: forToday({ ...active, currentIndex: clamped }) })
        },

        previewSummary() {
          const active = get().active
          if (!active) return null
          const exercises = toCompletedExercises(active, "drop")
          const durationSeconds = elapsedOf(active, sessionEndMs(active, Date.now()))
          const totals = computeTotals(exercises, {
            weightKg: useProfileStore.getState().profile?.weightKg ?? null,
            durationSeconds,
          })
          const personalRecords = detectPersonalRecords(
            exercises,
            useHistoryStore.getState().progress,
            active.completedAt ?? new Date().toISOString()
          )
          return {
            totals,
            personalRecords,
            durationSeconds,
            exercisesCompleted: totals.exercisesCompleted,
          }
        },

        isAtEnd() {
          const active = get().active
          return (
            !!active &&
            isInProgress(active) &&
            active.currentIndex >= active.workout.exercises.length
          )
        },

        finish() {
          const active = get().active
          if (!active || active.status === "completed") return null
          const nowMs = sessionEndMs(active, Date.now())
          const completed = buildCompleted(active, nowMs)
          if (!completed) return null
          useHistoryStore.getState().addWorkout(completed)
          set({
            active: {
              ...active,
              status: "completed",
              startedAt: completed.startedAt,
              pausedAt: null,
              pausedTotalMs:
                active.pausedTotalMs +
                (active.pausedAt != null
                  ? Math.max(0, nowMs - active.pausedAt)
                  : 0),
              completedAt: completed.completedAt,
              savedWorkoutId: completed.id,
              undoStack: [],
            },
            timer: IDLE_TIMER,
          })
          kickSync()
          return completed
        },

        discard() {
          set({ active: null, timer: IDLE_TIMER })
        },

        startRest(seconds) {
          set({ timer: restTimerFor(seconds, Date.now()) })
        },

        pauseRest() {
          const timer = get().timer
          if (!timer.running || timer.endsAt == null) return
          set({
            timer: {
              ...timer,
              endsAt: null,
              running: false,
              pausedRemaining: remainingSeconds(timer, Date.now()),
            },
          })
        },

        resumeRest() {
          const timer = get().timer
          if (
            timer.running ||
            timer.pausedRemaining == null ||
            timer.totalSeconds == null
          )
            return
          set({
            timer: {
              ...timer,
              endsAt: Date.now() + timer.pausedRemaining * 1000,
              running: true,
              pausedRemaining: null,
            },
          })
        },

        adjustRest(deltaSeconds) {
          const timer = get().timer
          if (timer.totalSeconds == null) return
          const now = Date.now()
          const total = Math.max(0, timer.totalSeconds + deltaSeconds)
          if (timer.running && timer.endsAt != null) {
            const remaining = Math.max(
              0,
              remainingSeconds(timer, now) + deltaSeconds
            )
            set({
              timer: {
                ...timer,
                totalSeconds: total,
                endsAt: now + remaining * 1000,
              },
            })
            return
          }
          if (timer.pausedRemaining != null) {
            set({
              timer: {
                ...timer,
                totalSeconds: total,
                pausedRemaining: Math.max(
                  0,
                  timer.pausedRemaining + deltaSeconds
                ),
              },
            })
          }
        },

        skipRest() {
          set({ timer: IDLE_TIMER })
        },

        currentExercise() {
          const active = get().active
          if (!active) return null
          return active.workout.exercises[active.currentIndex] ?? null
        },

        progress() {
          const active = get().active
          if (!active)
            return { index: 0, total: 0, completed: 0, phase: "warmup" }
          const total = active.workout.exercises.length
          const completed = active.workout.exercises.filter(
            (e) => active.logs[e.slotId]?.status === "completed"
          ).length
          const slot =
            active.workout.exercises[
              Math.min(active.currentIndex, Math.max(0, total - 1))
            ]
          return {
            index: Math.min(active.currentIndex, total),
            total,
            completed,
            phase:
              active.currentIndex >= total
                ? "cooldown"
                : (slot?.phase ?? "warmup"),
          }
        },

        elapsedSeconds() {
          const active = get().active
          if (!active) return 0
          return elapsedOf(active, Date.now())
        },
      }
    },
    {
      name: WORKOUT_STORAGE_KEY,
      version: WORKOUT_SCHEMA_VERSION,
      storage: createLocalStorage<PersistedWorkout>(),
      partialize: (state): PersistedWorkout => ({
        active:
          state.active && state.active.undoStack.length > PERSISTED_UNDO_CAP
            ? {
                ...state.active,
                undoStack: state.active.undoStack.slice(-PERSISTED_UNDO_CAP),
              }
            : state.active,
        timer: state.timer,
      }),
      migrate: (persisted, version) => {
        if (
          version === WORKOUT_SCHEMA_VERSION &&
          typeof persisted === "object" &&
          persisted !== null
        ) {
          return persisted as PersistedWorkout
        }
        return { active: null, timer: IDLE_TIMER }
      },
      skipHydration: false,
      onRehydrateStorage: onRehydrate<WorkoutStore>(),
    }
  )
)

// Another tab or app window changed the active workout (logged a set, started a rest): re-read
// it, so this tab's next write, including a rest timer ending on its own, cannot erase that work.
onLocalStorageKeyChange(WORKOUT_STORAGE_KEY, () => {
  void useWorkoutStore.persist.rehydrate()
})
