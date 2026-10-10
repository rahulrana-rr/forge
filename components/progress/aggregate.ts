/**
 * Pure aggregation over completed workouts for the Progress screen: weekly buckets, the
 * seven-day dot row, latest personal records and per-session e1RM. No I/O, no Date.now();
 * callers pass `today` so the maths stays deterministic.
 */
import type { CompletedWorkout, ExerciseSession, PersonalRecord } from "@/lib/domain/types"
import type { Goal } from "@/lib/exercises/types"
import { addDays, dateKey, daysBetween, formatRelativeDateKey, parseDateKey } from "@/lib/dates"
import { epley1rm, monthKey, monthShort } from "./format"

export interface WeekBucket {
  /** Monday of the week, as a date key. */
  weekStart: string
  workouts: number
  sets: number
  volumeKg: number
}

/** Monday-based start of the week containing `key`. */
export function weekStartOf(key: string): string {
  const d = parseDateKey(key)
  const offset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - offset)
  return dateKey(d)
}

/** Per-week totals for the last `weeks` weeks ending with the week containing `today`, oldest first. */
export function weeklyBuckets(workouts: readonly CompletedWorkout[], weeks: number, today: string): WeekBucket[] {
  const thisWeek = weekStartOf(today)
  const buckets: WeekBucket[] = []
  const index = new Map<string, WeekBucket>()
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = addDays(thisWeek, -7 * i)
    const bucket: WeekBucket = { weekStart, workouts: 0, sets: 0, volumeKg: 0 }
    buckets.push(bucket)
    index.set(weekStart, bucket)
  }
  for (const w of workouts) {
    const bucket = index.get(weekStartOf(w.date))
    if (!bucket) continue
    bucket.workouts += 1
    bucket.sets += w.totals.sets
    bucket.volumeKg += w.totals.volumeKg
  }
  return buckets
}

/** Short month under the first bucket and wherever the month changes; undefined elsewhere. */
export function weekAxisLabels(buckets: readonly WeekBucket[]): (string | undefined)[] {
  let previous: string | null = null
  return buckets.map((b) => {
    const m = monthKey(b.weekStart)
    if (m === previous) return undefined
    previous = m
    return monthShort(b.weekStart)
  })
}

/** "This week" or "Week of 15 Sep". */
export function weekLabel(bucket: WeekBucket, today: string): string {
  if (weekStartOf(today) === bucket.weekStart) return "This week"
  const d = parseDateKey(bucket.weekStart)
  return `Week of ${d.getDate()} ${monthShort(bucket.weekStart)}`
}

export interface DayCell {
  key: string
  trained: boolean
  /** Weekday initial. */
  initial: string
  /** Spoken label, e.g. "Today", "Tue, 7 Oct". */
  label: string
}

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"]

/** The last seven days ending today, oldest first. */
export function lastSevenDays(workouts: readonly CompletedWorkout[], today: string): DayCell[] {
  const trained = new Set(workouts.map((w) => w.date))
  const out: DayCell[] = []
  for (let i = 6; i >= 0; i--) {
    const key = addDays(today, -i)
    out.push({
      key,
      trained: trained.has(key),
      initial: WEEKDAY_INITIALS[parseDateKey(key).getDay()] ?? "",
      label: formatRelativeDateKey(key, today),
    })
  }
  return out
}

export interface RecordEntry {
  record: PersonalRecord
  workoutId: string
  date: string
}

/** Newest `limit` personal records across all workouts. */
export function latestRecords(workouts: readonly CompletedWorkout[], limit = 10): RecordEntry[] {
  const all: RecordEntry[] = []
  for (const w of workouts) {
    for (const record of w.personalRecords) all.push({ record, workoutId: w.id, date: w.date })
  }
  all.sort((a, b) =>
    a.record.achievedAt < b.record.achievedAt ? 1 : a.record.achievedAt > b.record.achievedAt ? -1 : 0,
  )
  return all.slice(0, limit)
}

/** Best Epley e1RM among loaded, completed sets of a session; null when nothing was loaded. */
export function sessionBestE1rm(session: ExerciseSession): number | null {
  let best: number | null = null
  for (const s of session.sets) {
    if (!s.completed || s.weightKg == null || s.weightKg <= 0 || s.reps == null || s.reps <= 0) continue
    const e = epley1rm(s.weightKg, s.reps)
    best = best == null ? e : Math.max(best, e)
  }
  return best
}

/** What "progress toward the goal" means per goal: strength → e1RM, muscle gain → weekly sets, else training minutes. */
export type GoalMetric = "e1rm" | "sets" | "minutes"

export function goalMetricFor(goal: Goal): GoalMetric {
  if (goal === "strength") return "e1rm"
  if (goal === "muscle_gain") return "sets"
  return "minutes"
}

export interface GoalTrend {
  metric: GoalMetric
  /** Per-week average over the last 4 weeks (sets or minutes); 0 for e1rm. */
  recent: number
  /** Same for the 4 weeks before; null when nothing was logged then. */
  previous: number | null
  /** e1rm only: mean % change of the best e1RM across lifts logged in both windows; null when none. */
  changePct: number | null
  /** e1rm only: how many lifts the change is based on. */
  lifts: number
}

const TREND_DAYS = 28

/** 0 for the last 28 days including today, 1 for the 28 before that, null otherwise. */
function trendWindow(date: string, today: string): 0 | 1 | null {
  const diff = daysBetween(date, today)
  if (diff < 0) return null
  if (diff < TREND_DAYS) return 0
  if (diff < TREND_DAYS * 2) return 1
  return null
}

/** Goal-specific trend: the last four weeks against the four before. Pure; `today` is a date key. */
export function goalTrend(workouts: readonly CompletedWorkout[], goal: Goal, today: string): GoalTrend {
  const metric = goalMetricFor(goal)
  if (metric === "e1rm") {
    const best: [Map<string, number>, Map<string, number>] = [new Map(), new Map()]
    for (const w of workouts) {
      const win = trendWindow(w.date, today)
      if (win === null) continue
      for (const e of w.exercises) {
        if (e.phase !== "main") continue
        for (const s of e.sets) {
          if (!s.completed || s.weightKg == null || s.reps == null) continue
          const e1rm = epley1rm(s.weightKg, s.reps)
          if (e1rm > 0) best[win].set(e.exerciseId, Math.max(best[win].get(e.exerciseId) ?? 0, e1rm))
        }
      }
    }
    const changes: number[] = []
    for (const [id, recent] of best[0]) {
      const previous = best[1].get(id)
      if (previous) changes.push(recent / previous - 1)
    }
    const changePct = changes.length ? (changes.reduce((a, b) => a + b, 0) / changes.length) * 100 : null
    return { metric, recent: 0, previous: null, changePct, lifts: changes.length }
  }

  const totals: [number, number] = [0, 0]
  let previousLogged = false
  for (const w of workouts) {
    const win = trendWindow(w.date, today)
    if (win === null) continue
    if (win === 1) previousLogged = true
    totals[win] += metric === "sets" ? w.totals.sets : w.durationSeconds / 60
  }
  const weeks = TREND_DAYS / 7
  return {
    metric,
    recent: totals[0] / weeks,
    previous: previousLogged ? totals[1] / weeks : null,
    changePct: null,
    lifts: 0,
  }
}
