"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { PauseIcon, SparklesIcon } from "lucide-react"

import { BigButton } from "@/components/app/big-button"
import { EmptyState } from "@/components/app/empty-state"
import { PageSkeleton } from "@/components/app/skeletons"
import { PauseOverlay } from "@/components/workout/pause-overlay"
import { RestTimer } from "@/components/workout/rest-timer"
import { SwipeDeck } from "@/components/workout/swipe-deck"
import { WorkoutComplete } from "@/components/workout/workout-complete"
import { WorkoutOverview } from "@/components/workout/workout-overview"
import { WorkoutProgress } from "@/components/workout/workout-progress"
import { useCoachStore } from "@/lib/coach/store"
import { todayKey } from "@/lib/dates"
import { useHistoryStore, useProfileStore, useWorkoutStore } from "@/lib/store"

/**
 * Orchestrates the Today route: hydration → profile gate → overview → deck → complete.
 * Reads only coarse store slices; the timer and deck subscribe to their own slices.
 */
export function TodayScreen() {
  const profileHydrated = useProfileStore((s) => s.hydrated)
  const profile = useProfileStore((s) => s.profile)
  const historyHydrated = useHistoryStore((s) => s.hydrated)
  const workoutHydrated = useWorkoutStore((s) => s.hydrated)
  const active = useWorkoutStore((s) => s.active)
  const atEnd = useWorkoutStore((s) => s.isAtEnd())
  const canUndo = useWorkoutStore((s) => s.canUndo())
  const [endEarlyFor, setEndEarlyFor] = useState<string | null>(null)
  // The calendar day this screen opened on. A workout dated earlier was left unfinished on a
  // previous day: ask once whether to continue it. Training past midnight keeps the session going
  // because the screen opened on the workout's own day.
  const [openedOn] = useState(() => todayKey())
  const [continuedEarlierId, setContinuedEarlierId] = useState<string | null>(null)

  const ready = profileHydrated && historyHydrated && workoutHydrated

  const plannedId = useWorkoutStore((s) => (s.active?.status === "ready" ? s.active.workout.id : null))
  const coachHydrated = useCoachStore((s) => s.hydrated)
  useEffect(() => {
    if (plannedId && coachHydrated) useCoachStore.getState().ensureReview()
  }, [plannedId, coachHydrated])

  useEffect(() => {
    if (!ready || !profile) return
    useWorkoutStore.getState().ensureToday()
    // A tab left open overnight never remounts: re-check when the user comes back to it, so a plan
    // from yesterday is regenerated and an abandoned session is closed.
    const recheck = () => {
      if (document.visibilityState === "visible") useWorkoutStore.getState().ensureToday()
    }
    document.addEventListener("visibilitychange", recheck)
    window.addEventListener("focus", recheck)
    return () => {
      document.removeEventListener("visibilitychange", recheck)
      window.removeEventListener("focus", recheck)
    }
  }, [ready, profile])

  if (!ready) {
    return (
      <div role="status" aria-live="polite" aria-label="Loading today's workout">
        <PageSkeleton />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen-safe flex-col justify-center pb-nav">
        <EmptyState
          icon={<SparklesIcon aria-hidden="true" />}
          title="Set up your training"
          description="Two minutes of questions and today's workout is programmed for you."
          action={
            <BigButton tone="volt" nativeButton={false} render={<Link href="/onboarding" />}>
              Get started
            </BigButton>
          }
        />
      </div>
    )
  }

  if (!active) {
    return (
      <div role="status" aria-live="polite" aria-label="Preparing today's workout">
        <PageSkeleton />
      </div>
    )
  }

  const units = profile.units
  const { workout, status, currentIndex, logs } = active

  if (status === "ready") return <WorkoutOverview workout={workout} mode="start" />
  if (status === "completed") return <WorkoutComplete mode="saved" units={units} />

  const endEarly = endEarlyFor === workout.id
  if (atEnd || endEarly) {
    // At the end, the last card's action can still be undone (the deck and its Undo are gone).
    const back =
      endEarly && !atEnd
        ? { label: "Back to workout", run: () => setEndEarlyFor(null) }
        : atEnd && canUndo
          ? { label: "Undo last exercise", run: () => useWorkoutStore.getState().undo() }
          : null
    return <WorkoutComplete mode="preview" units={units} onBack={back?.run} backLabel={back?.label} />
  }

  if (workout.date < openedOn && continuedEarlierId !== workout.id) {
    return (
      <WorkoutOverview
        workout={workout}
        mode="resume"
        onResume={() => {
          if (useWorkoutStore.getState().active?.status === "paused") useWorkoutStore.getState().resume()
          setContinuedEarlierId(workout.id)
        }}
        onEnd={() => setEndEarlyFor(workout.id)}
      />
    )
  }

  const paused = status === "paused"

  return (
    <div className="fixed inset-0 z-20 flex flex-col overflow-hidden bg-background pt-safe">
      {/* Inert while paused: the overlay is modal, so no key or Tab can reach the deck behind it. */}
      <div className="mx-auto flex h-full w-full max-w-lg flex-col" inert={paused || undefined}>
        <header className="flex items-start gap-3 px-5 pt-3 pb-1">
          <WorkoutProgress exercises={workout.exercises} currentIndex={currentIndex} logs={logs} className="min-w-0 flex-1" />
          <button
            type="button"
            onClick={() => useWorkoutStore.getState().pause()}
            aria-label="Pause workout"
            className="-mt-1 flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-foreground transition-colors outline-none hover:bg-surface-3 focus-visible:ring-3 focus-visible:ring-ring [&_svg]:size-5"
          >
            <PauseIcon aria-hidden="true" />
          </button>
        </header>
        <SwipeDeck units={units} overlay={<RestTimer className="px-4 pt-1" />} className="pb-safe" />
      </div>
      <PauseOverlay open={paused} onEndWorkout={() => setEndEarlyFor(workout.id)} />
    </div>
  )
}
