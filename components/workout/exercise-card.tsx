"use client"

import { Badge } from "@/components/ui/badge"
import { ExerciseDemo, type DemoMode } from "@/components/workout/exercise-demo"
import { ExerciseMedia } from "@/components/workout/exercise-media"
import { hasMedia } from "@/lib/exercises/media"
import {
  roleLabel,
  coachTipFor,
  formatRepRange,
  perSideLabel,
  formatSeconds,
  isTimedSlot,
} from "@/components/workout/prescription"
import type { Units } from "@/lib/domain/types"
import type { WorkoutExercise } from "@/lib/engine/types"
import {
  CATEGORY_LABELS,
  DIFFICULTY_LABELS,
  EQUIPMENT_LABELS,
  MUSCLE_LABELS,
  type Exercise,
} from "@/lib/exercises/types"
import { formatWeight } from "@/lib/units"
import { cn } from "@/lib/utils"

export interface ExerciseCardProps {
  exercise: Exercise
  slot: WorkoutExercise
  /** Zero-based slot index in the workout; used to rotate the coach tip. */
  index: number
  total: number
  units: Units
  /** The card underneath the active one: content is de-emphasised. */
  dimmed?: boolean
  /** play = top card (video plays), preload = the card underneath, idle = everywhere else. */
  demoMode?: DemoMode
  /** The workout's split: a conditioning-led day labels its block "Conditioning". */
  split?: string | null
  className?: string
}

const MECHANICS_LABEL = { compound: "Compound", isolation: "Isolation" } as const

/**
 * The exercise card: media on top, then name, meta, equipment, the big prescription row, the
 * recommended load, cues and muscles. Purely presentational; the deck handles gestures.
 *
 * Rows are shown by the card's own height (a size container), not the viewport: the rest timer
 * shrinks the card, and the name, sets × reps and load must never be the parts that get clipped.
 * Lower-priority rows drop out first, in reverse order of importance, and the media takes what is
 * left. Thresholds assume a two-line name and leave the media about 80-100px. Rows that drop out
 * stay in the accessibility tree (sr-only), and the Details drawer shows today's tempo, RIR and note.
 */
export function ExerciseCard({ exercise, slot, index, total, units, dimmed = false, demoMode = "idle", split = null, className }: ExerciseCardProps) {
  const timed = isTimedSlot(slot)
  const tip = coachTipFor(exercise, index)
  const equipment = exercise.equipment.filter((e) => e !== "bodyweight" || exercise.equipment.length === 1)
  const isWorkingSet = slot.phase === "main"
  const showRest = slot.restSeconds > 0

  return (
    <article
      className={cn(
        "surface-card @container-size flex h-full w-full flex-col overflow-hidden rounded-3xl",
        dimmed && "saturate-50",
        className,
      )}
      aria-label={`${exercise.name}, exercise ${index + 1} of ${total}`}
    >
      <div className="relative min-h-0 flex-1 bg-surface-2 [@container(min-height:260px)]:min-h-14">
        <ExerciseDemo exercise={exercise} mode={demoMode} variant="card" fallback={<ExerciseMedia exercise={exercise} />} />
        {hasMedia(exercise.id) ? (
          // The demo shows the movement; a small map keeps the target muscles visible.
          <div className="pointer-events-none absolute bottom-2 left-2 h-20 w-14 rounded-xl border border-border/60 glass p-1" aria-hidden="true">
            <ExerciseMedia exercise={exercise} className="gap-0.5 px-0 py-0" />
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-card to-transparent" />
        )}
        <Badge
          variant="secondary"
          className={cn(
            "absolute top-3 left-3 h-6 border-border/60 bg-background/70 px-2.5 text-label backdrop-blur-sm",
            slot.phase === "main" && "border-volt/60 text-volt-ink",
          )}
        >
          {roleLabel(slot.role, split)}
        </Badge>
      </div>

      <div className="flex shrink-0 flex-col gap-2.5 px-4 pt-2 pb-4 sm:px-5 [@container(max-height:459px)]:gap-2 [@container(max-height:459px)]:pb-3">
        <header className="flex flex-col gap-1">
          <h2 className="line-clamp-2 font-heading text-2xl leading-[0.95] font-extrabold tracking-tight uppercase sm:text-3xl [@container(min-height:600px)]:text-4xl">
            {exercise.name}
          </h2>
          <p className="sr-only text-sm text-muted-foreground [@container(min-height:300px)]:not-sr-only">
            {[
              CATEGORY_LABELS[exercise.category],
              isWorkingSet ? MECHANICS_LABEL[exercise.mechanics] : null,
              DIFFICULTY_LABELS[exercise.difficulty],
            ]
              .filter(Boolean)
              .join(" • ")}
          </p>
        </header>

        {equipment.length > 0 ? (
          <ul className="sr-only flex flex-wrap gap-1.5 [@container(min-height:380px)]:not-sr-only" aria-label="Equipment">
            {equipment.map((eq) => (
              <li key={eq}>
                <Badge variant="outline" className="h-6 bg-surface-2 px-2.5 text-xs font-medium text-foreground/90">
                  {EQUIPMENT_LABELS[eq]}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}

        <dl className="grid grid-cols-[1fr_auto] items-end gap-3">
          <div>
            <dt className="text-label text-muted-foreground">{timed ? "Sets × time" : "Sets × reps"}</dt>
            <dd className="text-stat text-3xl font-semibold leading-none sm:text-4xl">
              {slot.sets}
              <span className="mx-1 text-muted-foreground">×</span>
              {timed && slot.durationSeconds != null
                ? formatSeconds(slot.durationSeconds)
                : slot.reps
                  ? formatRepRange(slot.reps)
                  : "—"}
              {perSideLabel(exercise) && (slot.reps || slot.durationSeconds != null) ? (
                <span className="ml-1 text-sm font-medium text-muted-foreground">{perSideLabel(exercise)}</span>
              ) : null}
            </dd>
          </div>
          {showRest ? (
            <div className="text-right">
              <dt className="text-label text-muted-foreground">Rest</dt>
              <dd className="text-stat text-2xl font-semibold leading-none whitespace-nowrap sm:text-3xl">{formatSeconds(slot.restSeconds)}</dd>
            </div>
          ) : null}
        </dl>

        {isWorkingSet ? (
          <div className="rounded-2xl border border-volt/50 bg-volt/8 px-4 py-2.5 dark:border-volt/25 [@container(max-height:459px)]:py-2">
            {slot.recommendedWeightKg != null ? (
              <>
                <p className="text-label text-muted-foreground dark:text-volt/80">
                  {slot.weightSource === "estimate" ? "Start around" : slot.weightSource === "user" ? "Your load" : "Recommended load"}
                </p>
                <p className="text-stat text-3xl font-bold leading-none text-volt-ink">
                  {formatWeight(slot.recommendedWeightKg, units)}
                  {exercise.isUnilateral ? <span className="ml-1 text-sm font-medium text-muted-foreground dark:text-volt/70">per side</span> : null}
                </p>
                {slot.weightSource === "estimate" ? (
                  <div className="sr-only [@container(min-height:300px)]:not-sr-only">
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">
                      A light first guess. Adjust it, then log what you lifted.
                    </p>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm leading-snug text-foreground/90">
                <span className="font-semibold text-volt-ink">Find your working weight</span>
                {slot.rir != null ? ` — leave ${slot.rir} rep${slot.rir === 1 ? "" : "s"} in reserve.` : " — stop 2 reps shy of failure."}
              </p>
            )}
          </div>
        ) : null}

        {slot.tempo || slot.rir != null ? (
          <ul className="sr-only flex flex-wrap gap-1.5 [@container(min-height:480px)]:not-sr-only" aria-label="Execution">
            {slot.tempo ? (
              <li>
                <Badge variant="secondary" className="h-6 px-2.5 text-stat text-xs">
                  Tempo {slot.tempo}
                </Badge>
              </li>
            ) : null}
            {slot.rir != null ? (
              <li>
                <Badge variant="secondary" className="h-6 px-2.5 text-stat text-xs">
                  RIR {slot.rir}
                </Badge>
              </li>
            ) : null}
          </ul>
        ) : null}

        {tip ? (
          <div className={cn("hidden", slot.note ? "[@container(min-height:580px)]:block" : "[@container(min-height:500px)]:block")}>
            <p className="text-label text-muted-foreground">Coach tip</p>
            <p className="line-clamp-2 text-sm leading-snug text-foreground/90">{tip}</p>
          </div>
        ) : null}

        {slot.note ? (
          <div className="sr-only [@container(min-height:440px)]:not-sr-only">
            <p className="line-clamp-2 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-snug text-muted-foreground">
              {slot.note}
            </p>
          </div>
        ) : null}

        <div className="sr-only [@container(min-height:510px)]:not-sr-only">
          <p className="truncate pt-0.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{MUSCLE_LABELS[exercise.primaryMuscle]}</span>
            {exercise.secondaryMuscles.length > 0
              ? ` · ${exercise.secondaryMuscles.map((m) => MUSCLE_LABELS[m]).join(", ")}`
              : null}
          </p>
        </div>
      </div>
    </article>
  )
}
