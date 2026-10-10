"use client"

import { useMemo } from "react"

import { Stat } from "@/components/app/stat"
import type { CompletedWorkout, Units } from "@/lib/domain/types"
import { fromKg } from "@/lib/units"

import { weekAxisLabels, weekLabel, weeklyBuckets } from "./aggregate"
import { BarChart, type BarDatum } from "./bar-chart"
import { compactNumber, formatVolume } from "./format"

const WEEKS = 8

/** Eight weeks of total volume (weight × reps over loaded sets) in the user's units. */
export function VolumeSection({
  workouts,
  units,
  today,
}: {
  workouts: CompletedWorkout[]
  units: Units
  today: string
}) {
  const weeks = useMemo(() => weeklyBuckets(workouts, WEEKS, today), [workouts, today])
  const bars = useMemo<BarDatum[]>(() => {
    const labels = weekAxisLabels(weeks)
    return weeks.map((w, i) => ({
      key: w.weekStart,
      value: fromKg(w.volumeKg, units),
      label: weekLabel(w, today),
      axisLabel: labels[i],
    }))
  }, [weeks, units, today])

  const totalKg = weeks.reduce((sum, w) => sum + w.volumeKg, 0)
  const thisWeekKg = weeks[weeks.length - 1]?.volumeKg ?? 0
  const format = (v: number) => `${compactNumber(v)} ${units}`
  const chartLabel = `Weekly volume over the last ${WEEKS} weeks in ${units}, oldest first: ${bars
    .map((b) => compactNumber(b.value))
    .join(", ")}. ${formatVolume(totalKg, units)} in total.`

  return (
    <section aria-labelledby="progress-volume" className="flex flex-col gap-3">
      <h2 id="progress-volume" className="text-label text-muted-foreground">
        Volume
      </h2>
      <div className="surface-card flex flex-col gap-6 rounded-3xl p-5">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="This week" value={formatVolume(thisWeekKg, units, false)} unit={units} />
          <Stat label={`Last ${WEEKS} weeks`} value={formatVolume(totalKg, units, false)} unit={units} />
        </div>
        {totalKg > 0 ? (
          <BarChart data={bars} ariaLabel={chartLabel} formatValue={format} formatCap={compactNumber} plotHeight={96} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Log a weight on your sets and weekly volume will build up here.
          </p>
        )}
      </div>
    </section>
  )
}
