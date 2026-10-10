"use client"

import Link from "next/link"
import { ChevronRightIcon, StarIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { SectionLabel } from "@/components/app/section-label"
import { Stat } from "@/components/app/stat"
import { ExerciseDemo } from "@/components/workout/exercise-demo"
import { ExerciseMedia } from "@/components/workout/exercise-media"
import { toggleFavourite, useIsFavourite } from "@/components/workout/favourite"
import { formatPrescription, formatRepRange, formatSeconds, summarizeSets } from "@/components/workout/prescription"
import { formatRelativeDateKey } from "@/lib/dates"
import type { Units } from "@/lib/domain/types"
import type { WorkoutExercise } from "@/lib/engine/types"
import {
  CATEGORY_LABELS,
  DIFFICULTY_LABELS,
  EQUIPMENT_LABELS,
  MOVEMENT_PATTERN_LABELS,
  MUSCLE_LABELS,
  type Exercise,
} from "@/lib/exercises/types"
// Store modules imported directly, not through the "@/lib/store" barrel: the barrel pulls in the
// workout store, the engine and the whole exercise library, which /exercise/[slug] does not need.
import { useHistoryStore } from "@/lib/store/history-store"
import { useProfileStore } from "@/lib/store/profile-store"
import { formatWeight } from "@/lib/units"
import { cn } from "@/lib/utils"

/** What an alternatives row needs; resolved by the caller (server page or client wrapper). */
export type ExerciseAlternative = Pick<Exercise, "id" | "slug" | "name" | "primaryMuscle" | "equipment">

export interface ExerciseDetailsContentProps {
  exercise: Exercise
  alternatives: ExerciseAlternative[]
  /** Hide the top media block (e.g. when the caller shows it already). */
  hideMedia?: boolean
  /**
   * Show an alternative in place instead of navigating to /exercise/[slug]. The workout screens use
   * this so a tap mid-session never leaves /today (and never needs the network).
   */
  onAlternativeSelect?: (exerciseId: string) => void
  /** Today's prescription for this exercise (the deck's details drawer). */
  slot?: WorkoutExercise
  className?: string
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </section>
  )
}

const ALT_ROW =
  "surface-card flex min-h-12 w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-sm transition-colors outline-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring"

/**
 * Full exercise reference: today's prescription (when given), muscles, how to do it, cues,
 * mistakes, defaults, alternatives and the user's own history. Takes the resolved exercise so it
 * never needs the exercise library on the client.
 */
export function ExerciseDetailsContent({
  exercise,
  alternatives,
  hideMedia = false,
  onAlternativeSelect,
  slot,
  className,
}: ExerciseDetailsContentProps) {
  const units: Units = useProfileStore((s) => s.profile?.units ?? "kg")
  const hasProfile = useProfileStore((s) => s.profile !== null)
  const favourite = useIsFavourite(exercise.id)

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {!hideMedia ? (
        <div className="surface-card aspect-video max-h-72 w-full overflow-hidden rounded-3xl bg-surface-2">
          <ExerciseDemo exercise={exercise} mode="play" variant="detail" fallback={<ExerciseMedia exercise={exercise} />} />
        </div>
      ) : null}

      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-heading text-3xl leading-[0.95] font-extrabold tracking-tight uppercase">{exercise.name}</h2>
          {hasProfile ? (
            <button
              type="button"
              aria-pressed={favourite}
              aria-label={favourite ? `Remove ${exercise.name} from favourites` : `Add ${exercise.name} to favourites`}
              title={favourite ? "Favourite: picked more often" : "Add to favourites"}
              onClick={() => toggleFavourite(exercise.id)}
              className={cn(
                "-mt-1 flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 transition-colors outline-none hover:bg-surface-3 focus-visible:ring-3 focus-visible:ring-ring [&_svg]:size-5",
                favourite ? "text-volt-ink" : "text-muted-foreground"
              )}
            >
              <StarIcon aria-hidden="true" className={cn(favourite && "fill-current")} />
            </button>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {CATEGORY_LABELS[exercise.category]} • {MOVEMENT_PATTERN_LABELS[exercise.movementPattern]} •{" "}
          {DIFFICULTY_LABELS[exercise.difficulty]}
        </p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Equipment">
          {exercise.equipment.map((eq) => (
            <li key={eq}>
              <Badge variant="outline" className="h-6 bg-surface-2 px-2.5 text-xs font-medium">
                {EQUIPMENT_LABELS[eq]}
              </Badge>
            </li>
          ))}
        </ul>
      </header>

      {slot ? <TodaySection slot={slot} exercise={exercise} units={units} /> : null}

      <Section title="Muscles">
        <div className="flex flex-wrap gap-1.5">
          <Badge className="h-6 bg-volt px-2.5 text-xs font-semibold text-volt-foreground">
            {MUSCLE_LABELS[exercise.primaryMuscle]}
          </Badge>
          {exercise.secondaryMuscles.map((m) => (
            <Badge key={m} variant="secondary" className="h-6 px-2.5 text-xs">
              {MUSCLE_LABELS[m]}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="How to do it">
        <ol className="flex flex-col gap-2.5">
          {exercise.instructions.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm leading-snug">
              <span className="text-stat mt-0.5 w-5 shrink-0 text-right font-semibold text-volt-ink">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Section>

      {exercise.coachTips.length > 0 ? (
        <Section title="Coach tips">
          <ul className="flex flex-col gap-2">
            {exercise.coachTips.map((tip) => (
              <li key={tip} className="rounded-2xl border border-volt/20 bg-volt/8 px-3.5 py-2.5 text-sm leading-snug">
                {tip}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {exercise.commonMistakes.length > 0 ? (
        <Section title="Common mistakes">
          <ul className="flex flex-col gap-1.5">
            {exercise.commonMistakes.map((m) => (
              <li key={m} className="flex gap-2 text-sm leading-snug text-muted-foreground">
                <span className="text-replace" aria-hidden="true">
                  ×
                </span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Defaults">
        <dl className="grid grid-cols-3 gap-3">
          <Stat label="Sets" value={formatRepRange(exercise.setsRange)} size="sm" />
          {exercise.repRange ? (
            <Stat label="Reps" value={formatRepRange(exercise.repRange)} size="sm" />
          ) : exercise.durationRange ? (
            <Stat label="Time" value={`${formatSeconds(exercise.durationRange[0])}–${formatSeconds(exercise.durationRange[1])}`} size="sm" />
          ) : null}
          <Stat label="Rest" value={`${formatSeconds(exercise.restRange[0])}–${formatSeconds(exercise.restRange[1])}`} size="sm" />
        </dl>
        {exercise.tempo ? <p className="text-xs text-muted-foreground">Tempo {exercise.tempo}</p> : null}
      </Section>

      {alternatives.length > 0 ? (
        <Section title="Alternatives">
          <ul className="flex flex-col gap-1.5">
            {alternatives.map((alt) => {
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{alt.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {MUSCLE_LABELS[alt.primaryMuscle]} · {alt.equipment.map((e) => EQUIPMENT_LABELS[e]).join(", ")}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </>
              )
              return (
                <li key={alt.id}>
                  {onAlternativeSelect ? (
                    <button type="button" onClick={() => onAlternativeSelect(alt.id)} className={ALT_ROW}>
                      {body}
                    </button>
                  ) : (
                    <Link href={`/exercise/${alt.slug}`} className={ALT_ROW}>
                      {body}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      ) : null}

      <ExerciseHistory exerciseId={exercise.id} units={units} />
    </div>
  )
}

/** The slot's own prescription. Tempo and RIR live here too, so short screens that trim the card still show them. */
function TodaySection({ slot, exercise, units }: { slot: WorkoutExercise; exercise: Exercise; units: Units }) {
  return (
    <Section title="Today">
      <dl className="grid grid-cols-3 gap-x-3 gap-y-4">
        <Stat label={slot.reps ? "Sets × reps" : "Sets × time"} value={formatPrescription(slot, exercise)} size="sm" />
        {slot.restSeconds > 0 ? <Stat label="Rest" value={formatSeconds(slot.restSeconds)} size="sm" /> : null}
        {slot.recommendedWeightKg != null ? (
          <Stat label="Load" value={formatWeight(slot.recommendedWeightKg, units, false)} unit={units} size="sm" />
        ) : null}
        {slot.tempo ? <Stat label="Tempo" value={slot.tempo} size="sm" /> : null}
        {slot.rir != null ? <Stat label="RIR" value={slot.rir} size="sm" /> : null}
      </dl>
      {slot.note ? <p className="text-xs leading-snug text-muted-foreground">{slot.note}</p> : null}
    </Section>
  )
}

/** The only part that needs client state: the user's own sessions for this exercise. */
function ExerciseHistory({ exerciseId, units }: { exerciseId: string; units: Units }) {
  const historyHydrated = useHistoryStore((s) => s.hydrated)
  const progress = useHistoryStore((s) => s.progress[exerciseId])
  const fmtKg = (kg: number) => formatWeight(kg, units)

  return (
    <Section title="Your history">
      {!historyHydrated ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading…
        </p>
      ) : !progress || progress.timesPerformed === 0 ? (
        <p className="text-sm text-muted-foreground">Not logged yet. Your sets will show up here after the first session.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-3 gap-3">
            <Stat label="Best weight" value={progress.bestWeightKg != null ? formatWeight(progress.bestWeightKg, units, false) : "—"} unit={progress.bestWeightKg != null ? units : undefined} size="sm" />
            <Stat label="Best reps" value={progress.bestReps ?? "—"} size="sm" />
            <Stat label="Est. 1RM" value={progress.bestE1rmKg != null ? formatWeight(progress.bestE1rmKg, units, false) : "—"} unit={progress.bestE1rmKg != null ? units : undefined} size="sm" />
          </dl>
          <ol className="flex flex-col divide-y divide-border rounded-2xl border border-border">
            {progress.recentSessions.map((session, i) => (
              <li key={`${session.workoutId}-${i}`} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-sm">
                <span className="shrink-0 text-muted-foreground">
                  {i === 0 ? "Previous" : formatRelativeDateKey(session.date)}
                </span>
                <span className="text-stat text-right">{summarizeSets(session.sets, fmtKg)}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            Performed {progress.timesPerformed} time{progress.timesPerformed === 1 ? "" : "s"}
          </p>
        </div>
      )}
    </Section>
  )
}
