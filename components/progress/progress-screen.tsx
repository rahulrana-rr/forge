"use client"

import { TrendingUp } from "lucide-react"

import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { CardSkeleton, StatRowSkeleton } from "@/components/app/skeletons"
import { LinkButton } from "@/components/history/link-button"
import { useHistoryStore, useProfileStore } from "@/lib/store"

import { ConsistencySection } from "./consistency-section"
import { ExerciseProgressSection } from "./exercise-progress-section"
import { GoalSection } from "./goal-section"
import { RecordsSection } from "./records-section"
import { useTodayKey } from "./use-today-key"
import { VolumeSection } from "./volume-section"

export function ProgressScreen() {
  const hydrated = useHistoryStore((s) => s.hydrated)
  const workouts = useHistoryStore((s) => s.workouts)
  const progress = useHistoryStore((s) => s.progress)
  const streakOf = useHistoryStore((s) => s.streak)
  const units = useProfileStore((s) => s.profile?.units ?? "kg")
  const goal = useProfileStore((s) => s.profile?.goal)
  const plannedPerWeek = useProfileStore((s) => s.profile?.trainingDaysPerWeek)
  const today = useTodayKey()

  if (!hydrated) {
    return (
      <>
        <PageHeader title="Progress" />
        <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-label="Loading progress">
          <StatRowSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </>
    )
  }

  if (workouts.length === 0) {
    return (
      <>
        <PageHeader title="Progress" />
        <EmptyState
          icon={<TrendingUp />}
          title="Nothing to chart yet"
          description="Finish your first workout and your streak, weekly volume and records show up here."
          action={<LinkButton href="/today">Go to today&apos;s workout</LinkButton>}
          className="animate-rise"
        />
      </>
    )
  }

  // Cheap (sorts date keys); recomputed when the history store changes.
  const streak = streakOf()

  return (
    <>
      <PageHeader title="Progress" subtitle={`${workouts.length} ${workouts.length === 1 ? "workout" : "workouts"} logged`} />
      <div className="flex flex-col gap-8 animate-rise">
        {goal && plannedPerWeek ? (
          <GoalSection workouts={workouts} goal={goal} plannedPerWeek={plannedPerWeek} today={today} />
        ) : null}
        <ConsistencySection workouts={workouts} streak={streak} today={today} />
        <VolumeSection workouts={workouts} units={units} today={today} />
        <RecordsSection workouts={workouts} units={units} today={today} />
        <ExerciseProgressSection progress={progress} units={units} today={today} />
      </div>
    </>
  )
}
