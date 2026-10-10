/**
 * Muscle-group freshness and weekly volume derived from completed history.
 */
import { muscleGroupOf, muscleGroupsOf } from "@/lib/exercises"
import { DEFAULT_LIBRARY, type Library } from "./library"
import { ALL_MUSCLE_GROUPS, type Exercise, type Goal, type MuscleGroup } from "@/lib/exercises/types"
import type { CompletedWorkout, Experience, SplitDay } from "@/lib/domain/types"
import { daysBetween } from "@/lib/dates"
import { coreFamily, isConditioning, type CoreFamily } from "./selection"

export interface GroupRecovery {
  /** Last date the group was loaded by a primary/secondary compound (or ≥ 6 sets). */
  lastHeavyDate: string | null
  /** Whole days since that date relative to the workout day; null without history. */
  daysSinceHeavy: number | null
  lastTrainedDate: string | null
  daysSinceTrained: number | null
  /** Direct working sets (exercise primary group) in the 7 days before the workout day. */
  setsLast7: number
  /**
   * Direct working sets in the sessions that make up "this week" for the cap: the most recent
   * `budgetSessions` sessions inside the 7-day window (all of them when not given). Training
   * every other day puts four sessions in a rolling 7-day window; a 3-day plan's week is the
   * last two sessions plus today, not all four.
   */
  setsBudget: number
}

export type RecoveryMap = Record<MuscleGroup, GroupRecovery>

export const WEEKLY_SET_CAPS: Record<Experience, number> = { beginner: 10, intermediate: 14, advanced: 18 }

/**
 * The raw 7-day count may run over the weekly cap when sessions bunch up, but never past this
 * factor: a soft ceiling on top of the per-week budget (coaching heuristic, not a study figure).
 */
export const WEEKLY_SOFT_CEILING_FACTOR = 1.3

/** Minimum whole days a heavily trained group should rest before being hit heavy again. */
export const HEAVY_REST_DAYS = 2

export interface RecentSplit {
  date: string
  split: SplitDay
  title: string
}

function emptyRecovery(): GroupRecovery {
  return { lastHeavyDate: null, daysSinceHeavy: null, lastTrainedDate: null, daysSinceTrained: null, setsLast7: 0, setsBudget: 0 }
}

function completedSets(sets: { completed: boolean }[]): number {
  return sets.filter((s) => s.completed).length
}

/** A workout counts as a training session once at least one main-phase set was completed. */
function isSession(workout: CompletedWorkout): boolean {
  return workout.exercises.some((e) => e.phase === "main" && e.status === "completed" && completedSets(e.sets) > 0)
}

/**
 * Groups whose weekly volume a completed set counts against: the primary group, plus the trunk
 * for core-category work whose primary muscle maps elsewhere (a Copenhagen plank is adductor
 * work on paper, trunk work in practice).
 */
export function cappedGroupsOf(exercise: { category: string }, primary: MuscleGroup): MuscleGroup[] {
  return exercise.category === "core" && primary !== "core" ? [primary, "core"] : [primary]
}

/** Groups a completed workout loaded heavily (primary/secondary compounds or ≥ 6 sets). */
export function heavyGroupsOfWorkout(workout: CompletedWorkout, lib: Library = DEFAULT_LIBRARY): MuscleGroup[] {
  const heavy = new Set<MuscleGroup>()
  const setsByGroup = new Map<MuscleGroup, number>()
  for (const entry of workout.exercises) {
    if (entry.phase !== "main" || entry.status !== "completed") continue
    // Conditioning finishers are not direct volume for the muscle they happen to use.
    if (entry.role === "finisher") continue
    const done = completedSets(entry.sets)
    if (done === 0) continue
    const exercise = lib.get(entry.exerciseId)
    if (!exercise) continue
    const group = muscleGroupOf(exercise)
    setsByGroup.set(group, (setsByGroup.get(group) ?? 0) + done)
    if (entry.role === "primary_compound" || entry.role === "secondary_compound") heavy.add(group)
  }
  for (const [group, sets] of setsByGroup) if (sets >= 6) heavy.add(group)
  return [...heavy]
}

/**
 * Recovery state for every muscle group as of `date`. History is newest first but order is not assumed.
 * `budgetSessions` limits `setsBudget` to the most recent sessions of the 7-day window (for a
 * plan of N days a week: N - 1, today being the Nth).
 */
export function computeRecovery(
  history: readonly CompletedWorkout[],
  date: string,
  lib: Library = DEFAULT_LIBRARY,
  budgetSessions?: number,
): RecoveryMap {
  const map = Object.fromEntries(ALL_MUSCLE_GROUPS.map((g) => [g, emptyRecovery()])) as RecoveryMap
  const sorted = history.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  let sessionsInWindow = 0
  for (const workout of sorted) {
    const age = daysBetween(workout.date, date)
    if (age < 0) continue
    const inWindow = age < 7 && isSession(workout)
    if (inWindow) sessionsInWindow++
    const countsForBudget = inWindow && (budgetSessions === undefined || sessionsInWindow <= budgetSessions)
    for (const group of heavyGroupsOfWorkout(workout, lib)) {
      const rec = map[group]
      if (rec.lastHeavyDate === null) {
        rec.lastHeavyDate = workout.date
        rec.daysSinceHeavy = age
      }
    }
    for (const entry of workout.exercises) {
      if (entry.phase !== "main" || entry.status !== "completed") continue
      const done = completedSets(entry.sets)
      if (done === 0) continue
      const exercise = lib.get(entry.exerciseId)
      if (!exercise) continue
      const groups = muscleGroupsOf(exercise)
      groups.forEach((group) => {
        const rec = map[group]
        if (rec.lastTrainedDate === null) {
          rec.lastTrainedDate = workout.date
          rec.daysSinceTrained = age
        }
      })
      // Direct sets only (primary group, plus the trunk for core-category work), and never
      // conditioning finishers.
      if (age < 7 && entry.role !== "finisher") {
        for (const group of cappedGroupsOf(exercise, muscleGroupOf(exercise))) {
          map[group].setsLast7 += done
          if (countsForBudget) map[group].setsBudget += done
        }
      }
    }
  }
  return map
}

export interface TrainingFrequency {
  /** Training sessions in the 7 days up to and including the workout day. */
  sessionsLast7: number
  /** Consecutive calendar days with a session, counting back from the workout day (or the day before). */
  streak: number
}

/** How densely the user has been training, for the rest-day guard. */
export function trainingFrequency(history: readonly CompletedWorkout[], date: string): TrainingFrequency {
  const ages = new Set<number>()
  let sessionsLast7 = 0
  for (const workout of history) {
    if (!isSession(workout)) continue
    const age = daysBetween(workout.date, date)
    if (age < 0) continue
    ages.add(age)
    if (age < 7) sessionsLast7++
  }
  let day = ages.has(0) ? 0 : 1
  let streak = 0
  while (ages.has(day)) {
    streak++
    day++
  }
  return { sessionsLast7, streak }
}

/** Raw 7-day sets a group may reach before even a maintenance dose is withheld. */
export function weeklySoftCeiling(experience: Experience): number {
  return Math.round(WEEKLY_SET_CAPS[experience] * WEEKLY_SOFT_CEILING_FACTOR)
}

export function isFresh(recovery: RecoveryMap, group: MuscleGroup, minDays: number = HEAVY_REST_DAYS): boolean {
  const days = recovery[group].daysSinceHeavy
  return days === null || days >= minDays
}

/** Smallest days-since-heavy across a set of groups; Infinity when none were trained. */
export function freshnessScore(recovery: RecoveryMap, groups: readonly MuscleGroup[]): number {
  let min = Number.POSITIVE_INFINITY
  for (const g of groups) {
    const days = recovery[g].daysSinceHeavy
    if (days !== null && days < min) min = days
  }
  return min
}

/** Splits trained in the last `days` days, newest first. */
export function recentSplits(history: readonly CompletedWorkout[], date: string, days = 7): RecentSplit[] {
  return history
    .filter((w) => {
      const age = daysBetween(w.date, date)
      return age >= 0 && age < days
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((w) => ({ date: w.date, split: w.split, title: w.title }))
}

export function weeklyCap(experience: Experience): number {
  return WEEKLY_SET_CAPS[experience]
}

/**
 * Core spec C04: direct trunk sets a week by goal and experience, [floor, cap], in place of the
 * general 10/14/18 cap. Strength lifters' main lifts load the trunk heavily, so they need less
 * direct work; hypertrophy volume data (Schoenfeld, Ogborn and Krieger 2017) support a higher
 * ceiling for muscle gain. No trunk-specific dose-response study exists: coaching judgment. The
 * floor is an audit target at 45 minutes or more, not an engine rule (the hard floor is C01/C02).
 */
export const CORE_WEEKLY_SETS: Record<Goal, Record<Experience, [number, number]>> = {
  strength: { beginner: [4, 6], intermediate: [4, 8], advanced: [6, 10] },
  muscle_gain: { beginner: [4, 6], intermediate: [6, 10], advanced: [8, 12] },
  fat_loss: { beginner: [4, 8], intermediate: [6, 10], advanced: [6, 10] },
  general_fitness: { beginner: [4, 8], intermediate: [6, 10], advanced: [6, 10] },
  endurance: { beginner: [4, 8], intermediate: [6, 10], advanced: [8, 12] },
}

/** The weekly direct-set cap for the trunk (core spec C04). */
export function coreWeeklyCap(goal: Goal, experience: Experience): number {
  return CORE_WEEKLY_SETS[goal][experience][1]
}

/** Trunk work in the rolling 7 days before (and including) the workout day (core spec C02, C07). */
export interface CoreExposure {
  /** Sessions in the 7-day window with a direct core set. */
  sessionsLast7: number
  /** Whole days since the most recent session with a direct core set; null when there is none. */
  daysSinceCore: number | null
  /** Training sessions in the 7-day window (with or without core). */
  sessionsInWindow: number
  /** Trunk families with a direct set in the window. */
  familiesLast7: Set<CoreFamily>
  /** The family of the most recent core session (its first core exercise with a family). */
  lastFamily: CoreFamily | null
  /** Sessions in the window with a flexion or rotation set. */
  flexionLast7: number
  /**
   * Sessions in the window with core that `designated` does not mark as a protected core day (the
   * room the plan's other days may take under MAX_CORE_DAYS). Equals sessionsLast7 without it.
   */
  extraLast7: number
}

/**
 * Direct trunk work: a completed main-phase entry (never a finisher) whose exercise is core category
 * or has the trunk as its primary group, excluding conditioning drills (mountain climbers, C13).
 * Secondary muscles do not count: a squat lists the abs, and would otherwise count as core.
 */
function isDirectCore(exercise: Exercise): boolean {
  if (isConditioning(exercise)) return false
  return exercise.category === "core" || muscleGroupOf(exercise) === "core"
}

/**
 * Core spec C02: trunk exposure from history, with the same 7-day window and session rule as
 * computeRecovery. `designated` tells which past sessions were protected core days (generate.ts
 * passes the rotation's coreDays) for `extraLast7`.
 */
export function coreExposure(
  history: readonly CompletedWorkout[],
  date: string,
  lib: Library = DEFAULT_LIBRARY,
  designated?: (workout: CompletedWorkout) => boolean,
): CoreExposure {
  const out: CoreExposure = {
    sessionsLast7: 0,
    daysSinceCore: null,
    sessionsInWindow: 0,
    familiesLast7: new Set(),
    lastFamily: null,
    flexionLast7: 0,
    extraLast7: 0,
  }
  const sorted = history.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  for (const workout of sorted) {
    const age = daysBetween(workout.date, date)
    if (age < 0) continue
    const families: CoreFamily[] = []
    let core = false
    for (const entry of workout.exercises) {
      if (entry.phase !== "main" || entry.status !== "completed" || entry.role === "finisher") continue
      if (completedSets(entry.sets) === 0) continue
      const exercise = lib.get(entry.exerciseId)
      if (!exercise || !isDirectCore(exercise)) continue
      core = true
      const family = coreFamily(exercise)
      if (family) families.push(family)
    }
    if (core && out.daysSinceCore === null) {
      out.daysSinceCore = age
      out.lastFamily = families[0] ?? null
    }
    if (age >= 7 || !isSession(workout)) continue
    out.sessionsInWindow++
    if (!core) continue
    out.sessionsLast7++
    for (const f of families) out.familiesLast7.add(f)
    if (families.includes("flexion_rotation")) out.flexionLast7++
    if (!designated || !designated(workout)) out.extraLast7++
  }
  return out
}
