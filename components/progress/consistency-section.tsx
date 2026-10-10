"use client"

import { useMemo } from "react"

import { SectionLabel } from "@/components/app/section-label"
import { Stat } from "@/components/app/stat"
import type { CompletedWorkout, StreakInfo } from "@/lib/domain/types"

import { lastSevenDays, weekAxisLabels, weekLabel, weeklyBuckets } from "./aggregate"
import { BarChart, type BarDatum } from "./bar-chart"
import { DayDots } from "./day-dots"

const WEEKS = 12

/** Streak stats, the last-seven-days dot row and a 12-week workouts-per-week column chart. */
export function ConsistencySection({
  workouts,
  streak,
  today,
}: {
  workouts: CompletedWorkout[]
  streak: StreakInfo
  today: string
}) {
  const days = useMemo(() => lastSevenDays(workouts, today), [workouts, today])
  const weeks = useMemo(() => weeklyBuckets(workouts, WEEKS, today), [workouts, today])
  const bars = useMemo<BarDatum[]>(() => {
    const labels = weekAxisLabels(weeks)
    return weeks.map((w, i) => ({
      key: w.weekStart,
      value: w.workouts,
      label: weekLabel(w, today),
      axisLabel: labels[i],
    }))
  }, [weeks, today])

  const thisWeek = weeks[weeks.length - 1]?.workouts ?? 0
  const total = weeks.reduce((sum, w) => sum + w.workouts, 0)
  const chartLabel = `Workouts per week over the last ${WEEKS} weeks, oldest first: ${weeks
    .map((w) => w.workouts)
    .join(", ")}. ${total} workouts in total.`

  return (
    <section aria-labelledby="progress-consistency" className="flex flex-col gap-3">
      <h2 id="progress-consistency" className="text-label text-muted-foreground">
        Consistency
      </h2>
      <div className="surface-card flex flex-col gap-6 rounded-3xl p-5">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Streak" value={streak.current} unit={streak.current === 1 ? "workout" : "workouts"} />
          <Stat label="Best" value={streak.longest} unit={streak.longest === 1 ? "workout" : "workouts"} />
          <Stat label="This week" value={thisWeek} unit={thisWeek === 1 ? "workout" : "workouts"} />
        </div>
        <DayDots days={days} />
        <div className="flex flex-col gap-3">
          <SectionLabel>Workouts per week</SectionLabel>
          <BarChart data={bars} ariaLabel={chartLabel} formatValue={(v) => String(v)} plotHeight={96} />
        </div>
      </div>
    </section>
  )
}
