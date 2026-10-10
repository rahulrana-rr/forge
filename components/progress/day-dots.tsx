import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

import type { DayCell } from "./aggregate"

/** Seven dots for the last seven days, filled when a workout exists, weekday initials underneath. */
export function DayDots({ days, className }: { days: DayCell[]; className?: string }) {
  const trained = days.filter((d) => d.trained)
  const summary =
    trained.length === 0
      ? "No workouts in the last 7 days"
      : `Trained ${trained.length} of the last 7 days: ${trained.map((d) => d.label).join(", ")}`

  return (
    <div role="img" aria-label={summary} className={cn("grid grid-cols-7 gap-1", className)}>
      {days.map((d, i) => {
        const isToday = i === days.length - 1
        return (
          <div key={d.key} className="flex flex-col items-center gap-1.5" aria-hidden="true">
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-full transition-colors",
                d.trained ? "bg-volt text-volt-foreground shadow-volt" : "bg-surface-2",
                isToday && !d.trained && "ring-1 ring-foreground/20 ring-inset",
              )}
            >
              {d.trained ? <Check className="size-4" strokeWidth={3} /> : null}
            </span>
            <span
              className={cn("text-[0.6875rem] font-semibold", isToday ? "text-foreground" : "text-muted-foreground")}
            >
              {d.initial}
            </span>
          </div>
        )
      })}
    </div>
  )
}
