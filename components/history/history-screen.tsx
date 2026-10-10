"use client"

import { useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { CalendarDays } from "lucide-react"

import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { StorageNotice } from "@/components/app/storage-notice"
import { ListSkeleton } from "@/components/app/skeletons"
import { monthKey, monthLabel } from "@/components/progress/format"
import { useTodayKey } from "@/components/progress/use-today-key"
import type { CompletedWorkout } from "@/lib/domain/types"
import { useHistoryStore, useProfileStore, useSyncStore } from "@/lib/store"

import { LinkButton } from "./link-button"
import { WorkoutDetail } from "./workout-detail"
import { WorkoutRow } from "./workout-row"

interface MonthGroup {
  key: string
  label: string
  workouts: CompletedWorkout[]
}

/** Groups newest-first workouts by calendar month, preserving order. */
function groupByMonth(workouts: CompletedWorkout[]): MonthGroup[] {
  const groups: MonthGroup[] = []
  for (const w of workouts) {
    const key = monthKey(w.date)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.workouts.push(w)
    else groups.push({ key, label: monthLabel(w.date), workouts: [w] })
  }
  return groups
}

/**
 * The /history page: the list, or one workout's detail when the URL has ?w=<id>. The detail lives
 * on this static page (not a dynamic /history/[id] route) so it prefetches, caches and opens
 * offline; the workout data is on the device anyway. Render inside <Suspense>.
 */
export function HistoryRoute() {
  const id = useSearchParams().get("w")
  return id ? <WorkoutDetail key={id} id={id} /> : <HistoryScreen />
}

/** Static placeholder while the search params resolve on the client. */
export function HistoryLoading() {
  return (
    <>
      <PageHeader title="History" />
      <div role="status" aria-live="polite" aria-label="Loading history">
        <ListSkeleton rows={5} />
      </div>
    </>
  )
}

export function HistoryScreen() {
  const hydrated = useHistoryStore((s) => s.hydrated)
  const signedIn = useSyncStore((st) => st.status !== "signed_out")
  const workouts = useHistoryStore((s) => s.workouts)
  const units = useProfileStore((s) => s.profile?.units ?? "kg")
  const today = useTodayKey()
  const groups = useMemo(() => groupByMonth(workouts), [workouts])

  if (!hydrated) {
    return (
      <>
        <PageHeader title="History" />
        <div role="status" aria-live="polite" aria-label="Loading history">
          <ListSkeleton rows={5} />
        </div>
      </>
    )
  }

  if (workouts.length === 0) {
    return (
      <>
        <PageHeader title="History" />
        <EmptyState
          icon={<CalendarDays />}
          title="No workouts yet"
          description="Finish a session and it shows up here, newest first."
          action={<LinkButton href="/today">Start today&apos;s workout</LinkButton>}
          className="animate-rise"
        />
      </>
    )
  }

  // Guests never sync, so "pending" would promise something that is not going to happen.
  const pending = signedIn ? workouts.reduce((n, w) => n + (w.synced ? 0 : 1), 0) : 0
  const count = `${workouts.length} ${workouts.length === 1 ? "workout" : "workouts"}`
  const subtitle = signedIn ? `${count}${pending ? ` · ${pending} waiting to sync` : ""}` : `${count} · saved on this device`

  return (
    <>
      <PageHeader title="History" subtitle={subtitle} />
      <div className="flex flex-col gap-8 animate-rise">
        {signedIn ? null : <StorageNotice />}
        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`history-${group.key}`} className="flex flex-col gap-3">
            <h2 id={`history-${group.key}`} className="text-label text-muted-foreground">
              {group.label}
            </h2>
            <ul className="flex flex-col gap-2">
              {group.workouts.map((w) => (
                <WorkoutRow key={w.id} workout={w} units={units} today={today} showSync={signedIn} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
