"use client"

import { useMemo } from "react"

import { Stat } from "@/components/app/stat"
import type { CompletedWorkout, TrainingDays } from "@/lib/domain/types"
import { GOAL_LABELS, type Goal } from "@/lib/exercises/types"

import { goalTrend, weeklyBuckets, type GoalTrend } from "./aggregate"

/** Planned-vs-done sessions this week plus a goal-specific four-week trend. */
export function GoalSection({
  workouts,
  goal,
  plannedPerWeek,
  today,
}: {
  workouts: CompletedWorkout[]
  goal: Goal
  plannedPerWeek: TrainingDays
  today: string
}) {
  const done = useMemo(() => weeklyBuckets(workouts, 1, today)[0]?.workouts ?? 0, [workouts, today])
  const trend = useMemo(() => goalTrend(workouts, goal, today), [workouts, goal, today])
  const percent = Math.min(100, Math.round((done / plannedPerWeek) * 100))

  return (
    <section aria-labelledby="progress-goal" className="flex flex-col gap-3">
      <h2 id="progress-goal" className="text-label text-muted-foreground">
        Goal · {GOAL_LABELS[goal]}
      </h2>
      <div className="surface-card flex flex-col gap-6 rounded-3xl p-5">
        <div className="flex flex-col gap-3">
          <Stat label="This week" value={`${done} of ${plannedPerWeek}`} unit="planned sessions" />
          <div
            role="progressbar"
            aria-label="Planned sessions done this week"
            aria-valuemin={0}
            aria-valuemax={plannedPerWeek}
            aria-valuenow={Math.min(done, plannedPerWeek)}
            aria-valuetext={`${done} of ${plannedPerWeek}`}
            className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
          >
            <div className="h-full rounded-full bg-volt-ink transition-[width] duration-500" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <TrendStat trend={trend} />
      </div>
    </section>
  )
}

function TrendStat({ trend }: { trend: GoalTrend }) {
  if (trend.metric === "e1rm") {
    if (trend.changePct === null) {
      return <p className="text-sm text-muted-foreground">Log weights on the same lifts for two months to see your strength trend.</p>
    }
    const pct = Math.round(trend.changePct)
    return (
      <Stat
        label="Est. 1RM vs the 4 weeks before"
        value={`${pct > 0 ? "+" : ""}${pct}%`}
        unit={`across ${trend.lifts} ${trend.lifts === 1 ? "lift" : "lifts"}`}
      />
    )
  }
  const label = trend.metric === "sets" ? "Sets per week, last 4 weeks" : "Minutes per week, last 4 weeks"
  return (
    <Stat
      label={label}
      value={Math.round(trend.recent)}
      unit={trend.previous === null ? undefined : `vs ${Math.round(trend.previous)} the 4 weeks before`}
    />
  )
}
