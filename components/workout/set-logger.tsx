"use client"

import { useMemo, useState } from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Stepper } from "@/components/workout/stepper"
import {
  asksForRir,
  defaultRepsFor,
  formatSeconds,
  isTimedSlot,
  loadKindFor,
  summarizeSets,
  usesWeight,
} from "@/components/workout/prescription"
import type { ExerciseSession, SetLog, Units } from "@/lib/domain/types"
import type { WorkoutExercise } from "@/lib/engine/types"
import type { Exercise } from "@/lib/exercises/types"
import { formatWeight, fromKg, loadStep, toKg } from "@/lib/units"
import { cn } from "@/lib/utils"

interface Row {
  /** Weight in the user's display units (not kg). null when the exercise has no external load. */
  weight: number | null
  reps: number | null
  seconds: number | null
  /** Reps the lifter says were left in reserve (one tap), or null when not given. */
  rir: number | null
}

/** One-tap reps-in-reserve choices; the last one means "5 or more". */
const RIR_CHOICES = [0, 1, 2, 3, 4, 5] as const


export interface SetLoggerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  slot: WorkoutExercise
  exercise: Exercise | undefined
  units: Units
  /** Most recent session for this exercise, if any (useHistoryStore.progress[id].recentSessions[0]). */
  lastSession?: ExerciseSession
  /** "Log & done": completes the slot with these sets. */
  onLog: (sets: SetLog[]) => void
  /** "Save for later": updates the planned prescription without completing. */
  onSave: (patch: { sets: number; weightKg: number | null; reps: number | null; durationSeconds: number | null }) => void
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

/** Stepper ceiling in display units: ~500 kg either way, on a round lb value (5 lb steps). */
function maxWeightFor(units: Units): number {
  return units === "kg" ? 500 : 1100
}

function initialRows(slot: WorkoutExercise, exercise: Exercise | undefined, units: Units, last?: ExerciseSession): Row[] {
  const timed = isTimedSlot(slot)
  const weighted = usesWeight(exercise)
  const step = loadStep(units, loadKindFor(exercise))
  const lastSets = last?.sets.filter((s) => s.completed) ?? []
  return Array.from({ length: Math.max(1, slot.sets) }, (_, i) => {
    const prev = lastSets[i] ?? lastSets[lastSets.length - 1]
    const kg = slot.recommendedWeightKg ?? prev?.weightKg ?? null
    return {
      weight: weighted ? (kg != null ? roundTo(fromKg(kg, units), step) : 0) : null,
      // Bottom of the range: confirming the defaults holds the load; logging more reps earns progression.
      reps: timed ? null : (defaultRepsFor(slot) ?? prev?.reps ?? 10),
      seconds: timed ? (slot.durationSeconds ?? prev?.durationSeconds ?? 30) : null,
      rir: null,
    }
  })
}

/**
 * Bottom drawer for logging the current exercise set by set. Prefilled from the prescription
 * (and the last session when there is no recommendation), with big press-and-hold steppers.
 */
export function SetLogger({ open, onOpenChange, slot, exercise, units, lastSession, onLog, onSave }: SetLoggerProps) {
  // Remount per slot/exercise so state resets when the card changes.
  const key = `${slot.slotId}:${slot.exerciseId}:${slot.sets}:${slot.recommendedWeightKg ?? "x"}`
  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="down" showSwipeHandle>
      {open ? (
        <SetLoggerBody
          key={key}
          slot={slot}
          exercise={exercise}
          units={units}
          lastSession={lastSession}
          onLog={onLog}
          onSave={onSave}
          close={() => onOpenChange(false)}
        />
      ) : null}
    </Drawer>
  )
}

function SetLoggerBody({
  slot,
  exercise,
  units,
  lastSession,
  onLog,
  onSave,
  close,
}: Omit<SetLoggerProps, "open" | "onOpenChange"> & { close: () => void }) {
  const [initial] = useState<Row[]>(() => initialRows(slot, exercise, units, lastSession))
  const [rows, setRows] = useState<Row[]>(initial)
  const timed = isTimedSlot(slot)
  const weighted = usesWeight(exercise)
  const weightStep = loadStep(units, loadKindFor(exercise))
  // A barbell never weighs less than the empty bar: the first tap up from zero lands on it.
  // Standard Olympic bar only: EZ bars, landmines and Smith machines weigh less or vary.
  const barWeight = exercise?.equipment.includes("barbell") ? (units === "kg" ? 20 : 45) : 0
  const snapToBar = (prev: number | null, next: number) =>
    barWeight > 0 && (prev ?? 0) < barWeight && next > (prev ?? 0) && next < barWeight ? barWeight : next
  const lastSummary = useMemo(
    () => (lastSession ? summarizeSets(lastSession.sets, (kg) => formatWeight(kg, units)) : null),
    [lastSession, units],
  )

  // Editing set 1 carries the change to later sets that still match it: most lifters keep one
  // load across working sets, so this saves a tap per set without overwriting deliberate edits.
  const update = (i: number, patch: Partial<Row>) =>
    setRows((prev) => {
      const first = prev[0]
      return prev.map((r, idx) => {
        if (idx === i) return { ...r, ...patch }
        if (i !== 0 || !first) return r
        const next = { ...r }
        if (patch.weight !== undefined && r.weight === first.weight) next.weight = patch.weight
        if (patch.reps !== undefined && r.reps === first.reps) next.reps = patch.reps
        if (patch.seconds !== undefined && r.seconds === first.seconds) next.seconds = patch.seconds
        if (patch.rir !== undefined && r.rir === first.rir) next.rir = patch.rir
        return next
      })
    })
  const addSet = () => setRows((prev) => [...prev, { ...(prev[prev.length - 1] ?? initialRows(slot, exercise, units)[0]) }])
  const removeSet = (i: number) => setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))

  const asksRir = (r: Row) => asksForRir(slot, weighted, timed, r.reps)
  const toSetLogs = (): SetLog[] =>
    rows.map((r, i) => ({
      setNumber: i + 1,
      weightKg: r.weight != null ? toKg(r.weight, units) : null,
      reps: r.reps,
      durationSeconds: r.seconds,
      ...(r.rir != null && asksRir(r) ? { rpe: 10 - r.rir } : {}),
      completed: true,
    }))

  const handleLog = () => {
    onLog(toSetLogs())
    close()
  }
  const handleSave = () => {
    const first = rows[0]
    onSave({
      sets: rows.length,
      weightKg: first?.weight != null ? toKg(first.weight, units) : null,
      // Only a rep target the user changed rewrites the planned range; the prefilled default is not a choice.
      reps: first?.reps != null && first.reps !== initial[0]?.reps ? first.reps : null,
      durationSeconds: first?.seconds ?? null,
    })
    close()
  }

  return (
    <DrawerContent className="mx-auto w-full max-w-lg">
      <DrawerHeader className="text-left">
        <DrawerTitle className="font-heading text-xl font-bold tracking-tight uppercase">
          {exercise?.name ?? "Log sets"}
        </DrawerTitle>
        <DrawerDescription>
          {lastSummary
            ? `Last: ${lastSummary}`
            : weighted && slot.weightSource === "estimate"
              ? "Starting estimate filled in. Change it to what you actually lifted, and tap how many reps you had left."
              : weighted
                ? "First time on this lift. Enter the weight you used so the next session can build on it."
                : "First time logging this one. Go by feel."}
        </DrawerDescription>
      </DrawerHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <ol className="flex flex-col gap-3" aria-label="Sets">
          {rows.map((row, i) => (
            <li key={i} className="surface-card flex flex-col gap-3 rounded-2xl p-3">
              <div className="flex items-center justify-between">
                <span className="text-label text-muted-foreground">Set {i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeSet(i)}
                  disabled={rows.length <= 1}
                  aria-label={`Remove set ${i + 1}`}
                  className="flex size-11 items-center justify-center rounded-xl text-muted-foreground transition-colors outline-none hover:bg-surface-2 hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-30 [&_svg]:size-4"
                >
                  <Trash2Icon aria-hidden="true" />
                </button>
              </div>
              <div className={cn("grid gap-4", weighted && !timed ? "grid-cols-2" : "grid-cols-1")}>
                {weighted && row.weight != null ? (
                  <Stepper
                    label={`Set ${i + 1} weight`}
                    value={row.weight}
                    display={Number.isInteger(row.weight) ? String(row.weight) : row.weight.toFixed(1)}
                    unit={units}
                    step={weightStep}
                    min={exercise?.loadType === "assisted" ? -200 : 0}
                    max={maxWeightFor(units)}
                    onChange={(weight) => update(i, { weight: snapToBar(row.weight, weight) })}
                  />
                ) : null}
                {timed ? (
                  <Stepper
                    label={`Set ${i + 1} time`}
                    value={row.seconds ?? 0}
                    display={formatSeconds(row.seconds ?? 0)}
                    unit="time"
                    step={5}
                    min={5}
                    max={3600}
                    onChange={(seconds) => update(i, { seconds })}
                  />
                ) : (
                  <Stepper
                    label={`Set ${i + 1} reps`}
                    value={row.reps ?? 0}
                    unit="reps"
                    step={1}
                    min={1}
                    max={100}
                    onChange={(reps) => update(i, { reps })}
                  />
                )}
              </div>
              {asksRir(row) ? (
                <div className="flex flex-col gap-2">
                  <span id={`rir-${i}`} className="text-label text-muted-foreground">
                    Reps left in the tank
                  </span>
                  <div role="group" aria-labelledby={`rir-${i}`} className="grid grid-cols-6 gap-1.5">
                    {RIR_CHOICES.map((n) => {
                      const pressed = row.rir === n
                      return (
                        <button
                          key={n}
                          type="button"
                          aria-pressed={pressed}
                          aria-label={n === 5 ? "5 or more reps left" : `${n} rep${n === 1 ? "" : "s"} left`}
                          onClick={() => update(i, { rir: pressed ? null : n })}
                          className={cn(
                            "flex h-11 items-center justify-center rounded-xl text-sm font-semibold tabular-nums transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring",
                            pressed ? "bg-volt text-volt-foreground" : "bg-surface-2 text-foreground hover:bg-surface-2/70",
                          )}
                        >
                          {n === 5 ? "5+" : n}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        <Button
          type="button"
          variant="ghost"
          onClick={addSet}
          className="mt-3 h-11 w-full rounded-xl text-sm"
        >
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          Add set
        </Button>
      </div>

      <DrawerFooter className="pb-safe">
        <Button
          type="button"
          onClick={handleLog}
          className="h-14 w-full rounded-2xl bg-volt text-base font-semibold text-volt-foreground hover:bg-volt/90"
        >
          Log &amp; done
        </Button>
        <Button type="button" variant="outline" onClick={handleSave} className="h-12 w-full rounded-2xl text-sm">
          Save for later
        </Button>
      </DrawerFooter>
    </DrawerContent>
  )
}
