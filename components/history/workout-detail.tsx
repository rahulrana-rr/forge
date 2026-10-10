"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Ellipsis, SearchX, Trash, Trophy } from "lucide-react"
import { toast } from "sonner"

import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { CardSkeleton, StatRowSkeleton } from "@/components/app/skeletons"
import { Stat } from "@/components/app/stat"
import {
  RECORD_KIND_LABELS,
  exerciseHref,
  exerciseName,
  formatRecordValue,
  formatSetLine,
  formatVolume,
} from "@/components/progress/format"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { CompletedExercise, ExerciseLogStatus, Units, WorkoutPhase } from "@/lib/domain/types"
import { formatDateKey, formatMinutes } from "@/lib/dates"
import { getExercise, MUSCLE_GROUP_LABELS } from "@/lib/exercises"
import { formatPrescription } from "@/components/workout/prescription"
import { useHistoryStore, useProfileStore } from "@/lib/store"
import { cn } from "@/lib/utils"

import { ConfirmDialog } from "./confirm-dialog"
import { LinkButton } from "./link-button"

const PHASES: { phase: WorkoutPhase; label: string }[] = [
  { phase: "warmup", label: "Warm-up" },
  { phase: "main", label: "Main" },
  { phase: "cooldown", label: "Cool-down" },
]

const STATUS_LABELS: Record<Exclude<ExerciseLogStatus, "pending">, string> = {
  completed: "Done",
  skipped: "Skipped",
  replaced: "Replaced",
}

const STATUS_CLASSES: Record<Exclude<ExerciseLogStatus, "pending">, string> = {
  completed: "bg-success/15 text-success",
  skipped: "bg-surface-3 text-muted-foreground",
  replaced: "bg-replace/20 text-replace-foreground dark:text-replace",
}

export function WorkoutDetail({ id }: { id: string }) {
  const router = useRouter()
  const hydrated = useHistoryStore((s) => s.hydrated)
  const workout = useHistoryStore((s) => s.workouts.find((w) => w.id === id))
  const removeWorkout = useHistoryStore((s) => s.removeWorkout)
  const units = useProfileStore((s) => s.profile?.units ?? "kg")
  const [confirmOpen, setConfirmOpen] = useState(false)

  if (!hydrated) {
    return (
      <>
        <PageHeader back="/history" title="Workout" />
        <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-label="Loading workout">
          <StatRowSkeleton count={4} />
          <CardSkeleton />
        </div>
      </>
    )
  }

  if (!workout) {
    return (
      <>
        <PageHeader back="/history" title="Workout" />
        <EmptyState
          icon={<SearchX />}
          title="Workout not found"
          description="It may have been deleted on this device or not synced here yet."
          action={<LinkButton href="/history" tone="neutral">Back to history</LinkButton>}
        />
      </>
    )
  }

  function handleDelete() {
    removeWorkout(id)
    toast("Workout deleted")
    router.replace("/history")
  }

  const minutes = Math.round(workout.durationSeconds / 60)
  const byPhase = PHASES.map(({ phase, label }) => ({
    phase,
    label,
    exercises: workout.exercises.filter((e) => e.phase === phase),
  })).filter((g) => g.exercises.length > 0)

  return (
    <>
      <PageHeader
        back="/history"
        title={workout.title}
        subtitle={`${formatDateKey(workout.date)} · ${formatMinutes(workout.durationSeconds)}`}
        action={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-lg" className="size-11 rounded-xl" aria-label="More actions" />}
            >
              <Ellipsis className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44 rounded-xl p-1.5">
              <DropdownMenuItem variant="destructive" className="min-h-10 rounded-lg px-2.5" onClick={() => setConfirmOpen(true)}>
                <Trash />
                Delete workout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="flex flex-col gap-8 animate-rise">
        <div className="surface-card grid grid-cols-4 gap-2 rounded-3xl p-4">
          <Stat label="Time" value={minutes} unit="min" size="sm" />
          <Stat label="Sets" value={workout.totals.sets} size="sm" />
          <Stat label="Reps" value={workout.totals.reps} size="sm" />
          <Stat label="Volume" value={formatVolume(workout.totals.volumeKg, units, false)} unit={units} size="sm" />
        </div>

        {workout.focus.length ? (
          <section aria-label="Muscle groups" className="flex flex-wrap gap-2">
            {workout.focus.map((group) => (
              <span key={group} className="inline-flex h-9 items-center rounded-full bg-surface-2 px-3.5 text-sm font-semibold">
                {MUSCLE_GROUP_LABELS[group]}
              </span>
            ))}
          </section>
        ) : null}

        {workout.personalRecords.length ? (
          <section aria-labelledby="detail-records" className="flex flex-col gap-3">
            <h2 id="detail-records" className="text-label text-muted-foreground">
              Personal records
            </h2>
            <ul className="surface-card flex flex-col divide-y divide-border rounded-3xl px-5 py-1">
              {workout.personalRecords.map((record) => (
                <li key={`${record.exerciseId}-${record.kind}`} className="flex items-center gap-3 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-volt/12 text-volt-ink" aria-hidden="true">
                    <Trophy className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={exerciseHref(record.exerciseId)} className="block truncate text-sm font-semibold outline-none hover:underline focus-visible:underline">
                      {exerciseName(record.exerciseId)}
                    </Link>
                    <p className="text-xs text-muted-foreground">{RECORD_KIND_LABELS[record.kind]}</p>
                  </div>
                  <span className="text-stat shrink-0 text-sm font-semibold">{formatRecordValue(record, units)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {byPhase.map((group) => (
          <section key={group.phase} aria-labelledby={`detail-${group.phase}`} className="flex flex-col gap-3">
            <h2 id={`detail-${group.phase}`} className="text-label text-muted-foreground">
              {group.label}
            </h2>
            <ul className="flex flex-col gap-2">
              {group.exercises.map((exercise) => (
                <ExerciseCard key={exercise.slotId} exercise={exercise} units={units} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this workout?"
        description="It is removed from this device and from your progress totals. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </>
  )
}

function ExerciseCard({ exercise, units }: { exercise: CompletedExercise; units: Units }) {
  const done = exercise.sets.filter((s) => s.completed)
  // Shared formatting: a single rep target reads "6", never "6–6" (coach review F01), and
  // unilateral work says "per leg" or "per side" (F29).
  const prescription = formatPrescription(
    { sets: exercise.prescribedSets, reps: exercise.prescribedReps, durationSeconds: exercise.prescribedDurationSeconds },
    getExercise(exercise.exerciseId),
  )

  return (
    <li className="surface-card flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={exerciseHref(exercise.exerciseId)}
            className="block font-heading text-base font-bold tracking-tight outline-none hover:underline focus-visible:underline"
          >
            {exerciseName(exercise.exerciseId)}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">Planned {prescription}</p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_CLASSES[exercise.status])}>
          {STATUS_LABELS[exercise.status]}
        </span>
      </div>
      {done.length ? (
        <ol className="text-stat flex flex-col gap-1 text-sm" aria-label="Logged sets">
          {done.map((set) => (
            <li key={set.setNumber} className="flex items-baseline gap-3">
              <span className="w-10 shrink-0 text-xs text-muted-foreground">Set {set.setNumber}</span>
              <span className="font-semibold">{formatSetLine(set, units)}</span>
              {set.rpe != null ? <span className="text-xs text-muted-foreground">RPE {set.rpe}</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No sets logged.</p>
      )}
    </li>
  )
}
