import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { formatVolume } from "@/components/progress/format"
import { Badge } from "@/components/ui/badge"
import type { CompletedWorkout, Units } from "@/lib/domain/types"
import { formatMinutes, formatRelativeDateKey } from "@/lib/dates"
import { cn } from "@/lib/utils"

import { workoutHref } from "./links"

/** One history list row: title, date, duration, sets, volume, PR badge and a sync dot. */
export function WorkoutRow({
  workout,
  units,
  today,
  showSync = true,
}: {
  workout: CompletedWorkout
  units: Units
  today: string
  /** Hide the sync dot for guests: their history lives on this device only. */
  showSync?: boolean
}) {
  const hasPr = workout.personalRecords.length > 0
  const sets = workout.totals.sets

  return (
    <li>
      <Link
        href={workoutHref(workout.id)}
        className="surface-card flex min-h-[4.5rem] items-center gap-3 rounded-2xl p-4 transition-[border-color,transform] outline-none hover:border-foreground/20 focus-visible:ring-3 focus-visible:ring-ring active:scale-[0.99]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-heading text-base font-bold tracking-tight">{workout.title}</h3>
            {hasPr ? (
              <Badge className="bg-volt text-volt-foreground">
                PR
                <span className="sr-only">
                  {" "}
                  · {workout.personalRecords.length} personal {workout.personalRecords.length === 1 ? "record" : "records"}
                </span>
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatRelativeDateKey(workout.date, today)} · {formatMinutes(workout.durationSeconds)}
          </p>
          <p className="text-stat mt-2 flex gap-4 text-sm">
            <span>
              <span className="font-semibold text-foreground">{sets}</span>{" "}
              <span className="text-muted-foreground">{sets === 1 ? "set" : "sets"}</span>
            </span>
            <span>
              <span className="font-semibold text-foreground">{formatVolume(workout.totals.volumeKg, units, false)}</span>{" "}
              <span className="text-muted-foreground">{units}</span>
            </span>
          </p>
        </div>
        {showSync ? (
          <span
            role="img"
            aria-label={workout.synced ? "Synced" : "Waiting to sync"}
            className={cn("size-2 shrink-0 rounded-full", workout.synced ? "bg-success" : "bg-muted-foreground/40 ring-1 ring-muted-foreground/60")}
          />
        ) : null}
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  )
}
