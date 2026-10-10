"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

import { SectionLabel } from "@/components/app/section-label"
import { Stat } from "@/components/app/stat"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ExerciseProgress, Units } from "@/lib/domain/types"
import { formatDateKey, formatRelativeDateKey } from "@/lib/dates"
import { getExercise } from "@/lib/exercises"
import { formatWeight } from "@/lib/units"

import { sessionBestE1rm } from "./aggregate"
import {
  exerciseHref,
  exerciseName,
  formatSetsCompact,
  formatVolume,
  isoToDateKey,
} from "./format"
import { Sparkline, type SparkPoint } from "./sparkline"

interface ExerciseOption {
  value: string
  label: string
}

/** "today", "yesterday" or "last Tue, 30 Sep". */
function lastTrained(key: string, today: string): string {
  const relative = formatRelativeDateKey(key, today)
  return relative === "Today" || relative === "Yesterday"
    ? relative.toLowerCase()
    : `last ${relative}`
}

const UNTRACKED_CATEGORIES = new Set(["warmup", "cooldown", "stretching", "mobility"])

/** Warm-up, mobility and stretching items are preparation, not lifts worth charting. */
function isTrackedExercise(id: string): boolean {
  const ex = getExercise(id)
  return !!ex && !UNTRACKED_CATEGORIES.has(ex.category)
}

/** Pick an exercise with history: bests, recent sessions and an e1RM sparkline. */
export function ExerciseProgressSection({
  progress,
  units,
  today,
}: {
  progress: Record<string, ExerciseProgress>
  units: Units
  today: string
}) {
  const options = useMemo<ExerciseOption[]>(
    () =>
      Object.values(progress)
        .filter((p) => p.timesPerformed > 0 && isTrackedExercise(p.exerciseId))
        .sort((a, b) =>
          (a.lastPerformedAt ?? "") < (b.lastPerformedAt ?? "") ? 1 : -1
        )
        .map((p) => ({
          value: p.exerciseId,
          label: exerciseName(p.exerciseId),
        })),
    [progress]
  )
  const [picked, setPicked] = useState<string | null>(null)
  const selectedId =
    picked && progress[picked] ? picked : (options[0]?.value ?? null)
  const entry = selectedId ? progress[selectedId] : undefined

  const sparkPoints = useMemo<SparkPoint[]>(() => {
    if (!entry) return []
    const points: SparkPoint[] = []
    for (const session of [...entry.recentSessions].reverse()) {
      const value = sessionBestE1rm(session)
      if (value == null) continue
      points.push({
        key: session.workoutId,
        value,
        label: formatDateKey(session.date),
      })
    }
    return points
  }, [entry])

  return (
    <section
      aria-labelledby="progress-exercise"
      className="flex flex-col gap-3"
    >
      <h2 id="progress-exercise" className="text-label text-muted-foreground">
        Exercise progress
      </h2>
      <div className="flex flex-col gap-6 rounded-3xl p-5 surface-card">
        {options.length === 0 || !entry || !selectedId ? (
          <p className="text-sm text-muted-foreground">
            Complete an exercise with logged sets and you can track it here.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <label htmlFor="exercise-progress-select" className="sr-only">
                Exercise
              </label>
              <Select
                value={selectedId}
                onValueChange={(value) => setPicked(value)}
                items={options}
              >
                <SelectTrigger
                  id="exercise-progress-select"
                  className="w-full rounded-2xl border-border bg-surface-2 px-4 text-base font-semibold data-[size=default]:h-12 dark:bg-surface-2 dark:hover:bg-surface-3"
                >
                  <SelectValue placeholder="Choose an exercise" />
                </SelectTrigger>
                <SelectContent className="rounded-2xl">
                  {options.map((o) => (
                    <SelectItem
                      key={o.value}
                      value={o.value}
                      className="min-h-11 rounded-xl px-3"
                    >
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {entry.timesPerformed}{" "}
                  {entry.timesPerformed === 1 ? "session" : "sessions"}
                  {entry.lastPerformedAt
                    ? ` · ${lastTrained(isoToDateKey(entry.lastPerformedAt), today)}`
                    : ""}
                </span>
                <Link
                  href={exerciseHref(selectedId)}
                  className="inline-flex min-h-8 items-center gap-0.5 font-semibold text-foreground outline-none hover:underline focus-visible:underline"
                >
                  Details
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-5">
              <Stat
                label="Best weight"
                value={formatWeight(entry.bestWeightKg, units, false)}
                unit={entry.bestWeightKg != null ? units : undefined}
                size="sm"
              />
              <Stat
                label="Best reps"
                value={entry.bestReps ?? "—"}
                unit={entry.bestReps != null ? "reps" : undefined}
                size="sm"
              />
              <Stat
                label="Est. 1RM"
                value={formatWeight(entry.bestE1rmKg, units, false)}
                unit={entry.bestE1rmKg != null ? units : undefined}
                size="sm"
              />
              <Stat
                label="Best set volume"
                value={
                  entry.bestVolumeKg != null
                    ? formatVolume(entry.bestVolumeKg, units, false)
                    : "—"
                }
                unit={entry.bestVolumeKg != null ? units : undefined}
                size="sm"
              />
            </div>

            <div className="flex flex-col gap-3">
              <SectionLabel>Recent sessions</SectionLabel>
              {entry.recentSessions.length ? (
                <ul className="flex flex-col divide-y divide-border">
                  {entry.recentSessions.map((session, i) => {
                    const relative = formatRelativeDateKey(session.date, today)
                    const tag =
                      i === 0
                        ? relative === "Today"
                          ? "Today"
                          : "Latest"
                        : "Previous"
                    return (
                      <li
                        key={session.workoutId}
                        className="flex items-start justify-between gap-4 py-2.5"
                      >
                        <div className="flex shrink-0 flex-col">
                          <span
                            className={`text-label ${i === 0 ? "text-volt-ink" : "text-muted-foreground"}`}
                          >
                            {tag}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {relative === "Today"
                              ? formatDateKey(session.date)
                              : relative}
                          </span>
                        </div>
                        <span className="text-right text-stat text-sm leading-snug font-semibold">
                          {formatSetsCompact(session.sets, units)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No sessions logged yet.
                </p>
              )}
            </div>

            {sparkPoints.length > 0 ? (
              <div className="flex flex-col gap-3">
                <SectionLabel>Estimated 1RM</SectionLabel>
                <Sparkline
                  points={sparkPoints}
                  ariaLabel={`Estimated one-rep max over the last ${sparkPoints.length} sessions, oldest first: ${sparkPoints
                    .map((p) => formatWeight(p.value, units))
                    .join(", ")}.`}
                  formatValue={(v) => formatWeight(v, units)}
                />
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
