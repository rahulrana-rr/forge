"use client"

import { useMemo, useState } from "react"
import { ClockIcon, FlameIcon, PlayIcon, ShuffleIcon } from "lucide-react"

import { BigButton } from "@/components/app/big-button"
import { PageHeader } from "@/components/app/page-header"
import { SectionLabel } from "@/components/app/section-label"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CoachPanel } from "@/components/workout/coach-panel"
import { ExerciseDetailsDrawer } from "@/components/workout/exercise-details-drawer"
import {
  PHASE_LABELS,
  formatPrescription,
  formatSeconds,
} from "@/components/workout/prescription"
import { useEngineInput } from "@/hooks/use-engine-input"
import { formatDateKey } from "@/lib/dates"
import type { WorkoutPhase } from "@/lib/domain/types"
import { explainWorkout } from "@/lib/engine"
import type { Workout } from "@/lib/engine/types"
import { getExercise } from "@/lib/exercises"
import { mediaFor } from "@/lib/exercises/media"
import { MUSCLE_GROUP_LABELS, MUSCLE_LABELS } from "@/lib/exercises/types"
import { haptic } from "@/lib/haptics"
import { useHistoryStore, useProfileStore, useWorkoutStore } from "@/lib/store"
import { cn } from "@/lib/utils"

export interface WorkoutOverviewProps {
  workout: Workout
  /** "resume": an in-progress workout from an earlier day is still active. */
  mode?: "start" | "resume"
  /**
   * Resume mode: continue in the deck. The parent owns this because the date check that shows
   * this screen must be a one-time prompt, not a gate (resuming does not change the date).
   */
  onResume?: () => void
  /** Resume mode: end the old session (review, then save or discard). */
  onEnd?: () => void
  className?: string
}

const PHASES: WorkoutPhase[] = ["warmup", "main", "cooldown"]

/** Pre-start screen: title, focus, why this workout, the plan by phase, and the start bar. */
export function WorkoutOverview({
  workout,
  mode = "start",
  onResume,
  onEnd,
  className,
}: WorkoutOverviewProps) {
  const input = useEngineInput(workout)
  const historyWorkouts = useHistoryStore((s) => s.workouts)
  const [detailsId, setDetailsId] = useState<string | null>(null)

  const program = workout.program ?? null
  const reasons = useMemo(() => {
    // A program day is not chosen by the engine, so the engine's reasons do not apply.
    if (!input || workout.program) return []
    try {
      return explainWorkout(workout, input)
    } catch {
      return []
    }
  }, [workout, input])

  // The allowed gap between sessions follows the plan, so a plan change updates the streak too.
  const trainingDays = useProfileStore((s) => s.profile?.trainingDaysPerWeek)
  const streak = useMemo(() => {
    void historyWorkouts
    void trainingDays
    return useHistoryStore.getState().streak()
  }, [historyWorkouts, trainingDays])

  const grouped = useMemo(
    () =>
      PHASES.map((phase) => ({
        phase,
        slots: workout.exercises.filter((e) => e.phase === phase),
      })).filter((g) => g.slots.length > 0),
    [workout.exercises]
  )

  const start = () => {
    haptic("success")
    const store = useWorkoutStore.getState()
    if (mode === "start") store.start()
    else if (onResume) onResume()
    else store.resume()
  }
  const shuffle = () => {
    haptic("tap")
    useWorkoutStore.getState().regenerate()
  }

  const resume = mode === "resume"

  return (
    <div className={cn("flex min-h-full flex-col", className)}>
      <div className="flex flex-col gap-6 pb-40">
        <PageHeader
          title={workout.title}
          subtitle={
            resume
              ? `Still in progress from ${formatDateKey(workout.date)}`
              : (program?.title ?? "Today's workout")
          }
          action={
            <div className="flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-sm">
              <ClockIcon
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="text-stat font-semibold">
                {workout.estimatedMinutes}
              </span>
              <span className="text-muted-foreground">min</span>
            </div>
          }
        />

        <div className="flex flex-wrap gap-1.5" aria-label="Focus">
          {workout.focus.map((g) => (
            <Badge
              key={g}
              className="h-7 bg-volt/15 px-3 text-xs font-semibold text-volt-ink"
            >
              {MUSCLE_GROUP_LABELS[g]}
            </Badge>
          ))}
        </div>

        {streak.current > 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <FlameIcon className="size-4 text-replace" aria-hidden="true" />
            <span className="text-stat font-semibold text-foreground">
              {streak.current}
            </span>
            workout streak
            {streak.longest > streak.current ? (
              <span className="text-xs">· best {streak.longest}</span>
            ) : null}
          </p>
        ) : null}

        {mode === "start" ? <CoachPanel workoutId={workout.id} /> : null}

        {resume ? (
          <p className="text-sm leading-snug text-muted-foreground">
            Pick up where you left off, or end it to save what you did.
          </p>
        ) : null}

        {reasons.length > 0 || (workout.notes?.length ?? 0) > 0 ? (
          <section className="flex flex-col gap-2 rounded-3xl p-4 surface-card">
            <SectionLabel>{program ? "This week" : "Why this workout"}</SectionLabel>
            <ul className="flex flex-col gap-1.5">
              {[...reasons, ...(workout.notes ?? [])].map((line) => (
                <li key={line} className="flex gap-2 text-sm leading-snug">
                  <span
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-volt"
                    aria-hidden="true"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {grouped.map(({ phase, slots }) => (
          <section key={phase} className="flex flex-col gap-2">
            <SectionLabel>
              {PHASE_LABELS[phase]} · {slots.length}
            </SectionLabel>
            <ol className="flex flex-col gap-1.5">
              {slots.map((slot) => {
                const ex = getExercise(slot.exerciseId)
                const media = mediaFor(slot.exerciseId)
                const thumb = media?.video?.poster ?? media?.frames?.start ?? media?.animation?.poster ?? null
                const contain = !media?.video && !media?.frames && !!media?.animation
                return (
                  <li key={slot.slotId}>
                    <button
                      type="button"
                      onClick={() => setDetailsId(slot.exerciseId)}
                      className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left surface-card transition-colors outline-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring"
                    >
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element -- static CDN thumbnail
                        <img
                          src={thumb}
                          alt=""
                          width={48}
                          height={48}
                          loading="lazy"
                          decoding="async"
                          className={cn("size-12 shrink-0 rounded-xl", contain ? "bg-white object-contain" : "bg-surface-3 object-cover")}
                        />
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {ex?.name ?? slot.exerciseId}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {ex ? MUSCLE_LABELS[ex.primaryMuscle] : "—"}
                          {slot.recommendedWeightKg != null
                            ? slot.weightSource === "estimate"
                              ? " · starting load"
                              : " · load recommended"
                            : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end leading-tight">
                        <span
                          className={`text-stat ${cn("text-base font-semibold", phase === "main" && "text-volt-ink")}`}
                        >
                          {formatPrescription(slot, ex)}
                        </span>
                        {slot.restSeconds > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            rest {formatSeconds(slot.restSeconds)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </div>

      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 border-t border-border px-5 pt-3 glass",
          // The bottom nav is hidden while a workout is in progress, so no room is kept for it.
          resume ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "pb-nav"
        )}
      >
        <div className="mx-auto flex w-full max-w-lg items-center gap-3">
          <BigButton tone="volt" onClick={start} className="flex-1 shadow-volt">
            <PlayIcon data-icon="inline-start" aria-hidden="true" />
            {resume ? "Resume" : "Start workout"}
          </BigButton>
          {resume && onEnd ? (
            <BigButton tone="outline" onClick={onEnd} className="w-auto shrink-0 px-5">
              End workout
            </BigButton>
          ) : null}
          {/* A program day is fixed: there is no different workout to shuffle to. */}
          {mode === "start" && !program ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <BigButton
                    tone="ghost"
                    onClick={shuffle}
                    aria-label="Shuffle: generate a different workout"
                    className="w-14 shrink-0 px-0"
                  />
                }
              >
                <ShuffleIcon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>
                Generate a different workout for today
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <ExerciseDetailsDrawer
        exerciseId={detailsId}
        open={detailsId !== null}
        onOpenChange={(open) => !open && setDetailsId(null)}
      />
    </div>
  )
}
