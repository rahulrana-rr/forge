"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { motion, useReducedMotion } from "motion/react"
import { ArrowLeftIcon, FlameIcon, TrophyIcon } from "lucide-react"
import { toast } from "sonner"

import { BigButton } from "@/components/app/big-button"
import { workoutHref } from "@/components/history/links"
import { SectionLabel } from "@/components/app/section-label"
import { Stat } from "@/components/app/stat"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDateKey, formatDuration } from "@/lib/dates"
import type { PersonalRecord, Units, WorkoutTotals } from "@/lib/domain/types"
import { getExercise, muscleGroupOf } from "@/lib/exercises"
import { MUSCLE_GROUP_LABELS, type MuscleGroup } from "@/lib/exercises/types"
import { haptic } from "@/lib/haptics"
import { useHistoryStore, useProfileStore, useWorkoutStore } from "@/lib/store"
import { formatWeight } from "@/lib/units"
import { cn } from "@/lib/utils"

export interface WorkoutCompleteProps {
  /** "preview": every slot acted on, not yet saved. "saved": finish() has run. */
  mode: "preview" | "saved"
  units: Units
  /** Preview only: return to the deck (when the user ended early, or to undo the last card). */
  onBack?: () => void
  /** Label for the onBack button. Defaults to "Back to workout". */
  backLabel?: string
  className?: string
}

const PR_LABEL: Record<PersonalRecord["kind"], string> = {
  weight: "Heaviest set",
  reps_at_weight: "Most reps",
  e1rm: "Est. 1RM",
  volume: "Set volume",
}

function prValue(pr: PersonalRecord, units: Units): string {
  switch (pr.kind) {
    case "weight":
    case "e1rm":
    case "volume":
      return formatWeight(pr.value, units)
    case "reps_at_weight":
      return pr.weightKg != null ? `${pr.value} × ${formatWeight(pr.weightKg, units)}` : `${pr.value} reps`
    default:
      return String(pr.value)
  }
}

function dismissKey(id: string) {
  return `forge:today-dismissed:${id}`
}
function readDismissed(id: string | null): boolean {
  if (!id) return false
  try {
    return window.sessionStorage.getItem(dismissKey(id)) === "1"
  } catch {
    return false
  }
}

/** Shown when the deck is exhausted (pre-save) and after the workout is saved. */
export function WorkoutComplete({ mode, units, onBack, backLabel = "Back to workout", className }: WorkoutCompleteProps) {
  const reducedMotion = useReducedMotion()
  const active = useWorkoutStore((s) => s.active)
  const historyWorkouts = useHistoryStore((s) => s.workouts)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const savedId = active?.savedWorkoutId ?? null
  const [dismissed, setDismissed] = useState(() => readDismissed(savedId))

  const saved = useHistoryStore((s) => (mode === "saved" && savedId ? s.workouts.find((w) => w.id === savedId) : undefined))
  const preview = useMemo(() => {
    // `active` is the dependency: the summary is derived from its logs.
    void active
    return mode === "preview" ? useWorkoutStore.getState().previewSummary() : null
  }, [mode, active])
  // The allowed gap between sessions follows the plan, so a plan change updates the streak too.
  const trainingDays = useProfileStore((s) => s.profile?.trainingDaysPerWeek)
  const streak = useMemo(() => {
    void historyWorkouts
    void trainingDays
    return useHistoryStore.getState().streak()
  }, [historyWorkouts, trainingDays])

  const totals: WorkoutTotals | null = saved?.totals ?? preview?.totals ?? null
  const records: PersonalRecord[] = saved?.personalRecords ?? preview?.personalRecords ?? []
  const durationSeconds = saved?.durationSeconds ?? preview?.durationSeconds ?? 0
  const title = saved?.title ?? active?.workout.title ?? "Workout"
  const date = saved?.date ?? active?.workout.date ?? ""

  // "Trained" = primary muscle groups of completed main-phase work, in workout order. Warm-up
  // and cool-down items and secondary muscles would turn this into a list of everything.
  const groups = useMemo(() => {
    const ids = saved
      ? saved.exercises.filter((e) => e.status === "completed" && e.phase === "main").map((e) => e.exerciseId)
      : active
        ? active.workout.exercises
            .filter((slot) => slot.phase === "main" && active.logs[slot.slotId]?.status === "completed")
            .map((slot) => slot.exerciseId)
        : []
    const out: MuscleGroup[] = []
    for (const id of ids) {
      const ex = getExercise(id)
      if (!ex) continue
      const g = muscleGroupOf(ex)
      if (!out.includes(g)) out.push(g)
    }
    return out
  }, [saved, active])

  const save = () => {
    const result = useWorkoutStore.getState().finish()
    if (result) {
      haptic("success")
      toast.success("Saved")
    } else {
      toast.error("Nothing completed, so there is nothing to save")
    }
  }
  const discard = () => {
    const s = useWorkoutStore.getState()
    s.discard()
    s.ensureToday()
    setConfirmDiscard(false)
  }
  const done = () => {
    try {
      if (savedId) window.sessionStorage.setItem(dismissKey(savedId), "1")
    } catch {
      // per-tab convenience only
    }
    setDismissed(true)
  }
  const trainAgain = () => {
    const s = useWorkoutStore.getState()
    s.discard()
    s.ensureToday()
  }

  const stats = totals ? (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-6 gap-x-2 gap-y-4">
        <Stat label="Time" value={formatDuration(durationSeconds)} size="sm" align="center" className="col-span-3" />
        <Stat label="Exercises" value={totals.exercisesCompleted} size="sm" align="center" className="col-span-3" />
        <Stat label="Sets" value={totals.sets} size="sm" align="center" className="col-span-2" />
        <Stat label="Reps" value={totals.reps} size="sm" align="center" className="col-span-2" />
        <Stat label="Volume" value={formatWeight(totals.volumeKg, units, false)} unit={units} size="sm" align="center" className="col-span-2" />
      </dl>
      {totals.caloriesEstimate != null && totals.caloriesEstimate > 0 ? (
        <p className="text-center text-xs text-muted-foreground">
          About <span className="text-stat font-semibold text-foreground">{totals.caloriesEstimate}</span> kcal, a rough
          estimate from body weight and time
        </p>
      ) : null}
    </div>
  ) : null

  if (mode === "saved" && dismissed) {
    return (
      <div className={cn("flex flex-col gap-5 pt-6", className)}>
        <header>
          <p className="text-label text-muted-foreground">{date ? formatDateKey(date) : "Today"}</p>
          <h1 className="font-heading text-3xl font-extrabold tracking-tight uppercase">Done for today</h1>
        </header>
        <section className="surface-card flex flex-col gap-4 rounded-3xl p-5">
          <p className="font-heading text-lg font-bold tracking-tight">{title}</p>
          {stats}
          {streak.current > 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <FlameIcon className="size-4 text-replace" aria-hidden="true" />
              <span className="text-stat font-semibold text-foreground">{streak.current}</span> workout streak
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            {savedId ? (
              <BigButton tone="neutral" nativeButton={false} render={<Link href={workoutHref(savedId)} />}>
                View history
              </BigButton>
            ) : null}
            <BigButton tone="ghost" onClick={trainAgain}>
              Train again
            </BigButton>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className={cn("flex min-h-full flex-col gap-6 pt-6 pb-40", className)}>
      {mode === "preview" && onBack ? (
        <Button variant="ghost" onClick={onBack} className="-ml-2 h-11 w-fit rounded-xl text-muted-foreground">
          <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
          {backLabel}
        </Button>
      ) : null}
      <header className="flex flex-col gap-2">
        <motion.p
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-label text-volt-ink"
        >
          {mode === "saved" ? "Saved" : "Nice work"}
        </motion.p>
        <motion.h1
          initial={reducedMotion ? false : { opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="font-heading text-5xl leading-[0.9] font-black tracking-tight uppercase"
        >
          Workout
          <br />
          complete
        </motion.h1>
        <p className="text-base text-muted-foreground">
          {title}
          {date ? ` · ${formatDateKey(date)}` : ""}
        </p>
      </header>

      <section className="surface-card rounded-3xl p-4">{stats}</section>

      {groups.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionLabel>Trained</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {groups.map((g) => (
              <Badge key={g} variant="secondary" className="h-7 px-3 text-xs font-semibold">
                {MUSCLE_GROUP_LABELS[g]}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {records.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionLabel>Personal records</SectionLabel>
          <ul className="flex flex-col gap-2">
            {records.map((pr, i) => {
              const ex = getExercise(pr.exerciseId)
              return (
                <motion.li
                  key={`${pr.exerciseId}-${pr.kind}`}
                  initial={reducedMotion ? false : { opacity: 0, scale: 0.9, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 22, delay: 0.15 + i * 0.06 }}
                  className="flex items-center gap-3 rounded-2xl border border-volt/30 bg-volt/10 px-4 py-3 shadow-volt"
                >
                  <TrophyIcon className="size-5 shrink-0 text-volt-ink" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{ex?.name ?? pr.exerciseId}</span>
                    <span className="block text-xs text-muted-foreground">{PR_LABEL[pr.kind]}</span>
                  </span>
                  <span className="text-stat text-lg font-bold text-volt-ink">{prValue(pr, units)}</span>
                </motion.li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {streak.current > 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <FlameIcon className="size-4 text-replace" aria-hidden="true" />
          <span className="text-stat font-semibold text-foreground">{streak.current}</span> workout streak
          {streak.longest > streak.current ? <span className="text-xs">· best {streak.longest}</span> : null}
        </p>
      ) : null}

      <div className="glass fixed inset-x-0 bottom-0 z-30 border-t border-border px-5 pt-3 pb-nav">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-2">
          {mode === "preview" ? (
            <>
              <BigButton tone="volt" onClick={save} className="shadow-volt">
                Save workout
              </BigButton>
              <BigButton tone="ghost" onClick={() => setConfirmDiscard(true)}>
                Discard
              </BigButton>
            </>
          ) : (
            <>
              {savedId ? (
                <BigButton tone="volt" nativeButton={false} render={<Link href={workoutHref(savedId)} />}>
                  View history
                </BigButton>
              ) : null}
              <BigButton tone="neutral" onClick={done}>
                Done
              </BigButton>
            </>
          )}
        </div>
      </div>

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this workout?</DialogTitle>
            <DialogDescription>Logged sets will be lost and a fresh plan will be generated for today.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="h-11 rounded-xl" />}>Keep</DialogClose>
            <Button variant="destructive" className="h-11 rounded-xl" onClick={discard}>
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
