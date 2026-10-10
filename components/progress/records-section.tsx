"use client"

import { useMemo } from "react"
import Link from "next/link"
import { Trophy } from "lucide-react"

import type { CompletedWorkout, Units } from "@/lib/domain/types"
import { formatRelativeDateKey } from "@/lib/dates"

import { latestRecords } from "./aggregate"
import { RECORD_KIND_LABELS, exerciseHref, exerciseName, formatRecordValue } from "./format"

const LIMIT = 10

/** The ten most recent personal records across all workouts. */
export function RecordsSection({
  workouts,
  units,
  today,
}: {
  workouts: CompletedWorkout[]
  units: Units
  today: string
}) {
  const entries = useMemo(() => latestRecords(workouts, LIMIT), [workouts])

  return (
    <section aria-labelledby="progress-records" className="flex flex-col gap-3">
      <h2 id="progress-records" className="text-label text-muted-foreground">
        Personal records
      </h2>
      <div className="surface-card rounded-3xl px-5 py-2">
        {entries.length ? (
          <ul className="divide-y divide-border">
            {entries.map(({ record, workoutId, date }) => (
              <li key={`${workoutId}-${record.exerciseId}-${record.kind}`} className="flex items-center gap-3 py-3">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-volt/12 text-volt-ink"
                  aria-hidden="true"
                >
                  <Trophy className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={exerciseHref(record.exerciseId)}
                    className="block truncate text-sm font-semibold outline-none hover:underline focus-visible:underline"
                  >
                    {exerciseName(record.exerciseId)}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {RECORD_KIND_LABELS[record.kind]} · {formatRelativeDateKey(date, today)}
                  </p>
                </div>
                <span className="text-stat shrink-0 text-sm font-semibold">{formatRecordValue(record, units)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-3 text-sm text-muted-foreground">
            Beat a previous best on any exercise and it lands here. The first session of an exercise sets the
            baseline.
          </p>
        )}
      </div>
    </section>
  )
}
