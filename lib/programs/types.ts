/**
 * Assigned-program contract. A program is a fixed, coach-approved plan (weekly schedule, day
 * templates, week-by-week rules) that replaces the engine's generated workout for a user who has
 * been assigned it. Programs are static data in this folder, referenced by id only; no personal
 * data ever lives here. Weights in kg, date keys "YYYY-MM-DD".
 */
import type { Goal, MuscleGroup } from "@/lib/exercises/types"
import type { SplitDay, WorkoutPhase, WorkoutRole } from "@/lib/domain/types"

/** Program week number. A program of `weeks` weeks uses 1..weeks. */
export type ProgramWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** Day of the week as Date.getDay(): 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** What a card prescribes: the fields a week rule may change. */
export interface ProgramDose {
  sets: number
  /** Target rep range; null for timed or distance work. */
  reps: [number, number] | null
  /** Seconds per set for timed or distance work; null for rep work. */
  durationSeconds: number | null
  restSeconds: number
  /** Reps in reserve; null for warm-up, cool-down, explosive, skill and anti-movement work. */
  rir: number | null
  /** Short card note, readable mid-set. */
  note: string | null
}

/**
 * One rung of a gated progression (handstand, L-sit, knee raise to leg raise, pull-up or dip with
 * assistance). The card starts on the step the user most recently completed, so a step taken
 * with a left swipe sticks; with no history it starts on the first step.
 */
export interface ProgramStep {
  exerciseId: string
  /** Dose changes for this step (e.g. a different hold time); the rest comes from the item. */
  dose?: Partial<ProgramDose>
  /**
   * Week-specific changes for this step, applied after the item's own week changes, so a step
   * with its own dose (a sled push standing in for sprints) is not overwritten by them.
   */
  byWeek?: Partial<Record<ProgramWeek, Partial<ProgramDose>>>
}

export interface ProgramItem extends ProgramDose {
  /** Library exercise id (lib/exercises). */
  exerciseId: string
  phase: WorkoutPhase
  role: WorkoutRole
  /** Optional tempo shown on the card. */
  tempo?: string | null
  /** First week the item is programmed (inclusive). Absent = from week 1. */
  fromWeek?: ProgramWeek
  /** Last week the item is programmed (inclusive). Absent = to the end. */
  untilWeek?: ProgramWeek
  /** Week-specific changes, applied over the base dose. */
  byWeek?: Partial<Record<ProgramWeek, Partial<ProgramDose>>>
  /**
   * Gated progression steps, in order (the item's own exercise first). Each step's library
   * alternatives list the next step first, so a left swipe moves up one step.
   */
  steps?: ProgramStep[]
  /**
   * Extra swap options for the card (e.g. the plan's fallbacks), offered after the next steps and
   * before the exercise's library alternatives, so they are always reachable from Replace.
   */
  alternatives?: string[]
  /**
   * Changes for the first pass through the block only; repeats use the item as written. Used to
   * hold back step-ups after missed sessions (weekly review): `fromWeek` replaces the item's
   * first week, and `byWeek` applies after the item's own week changes.
   */
  firstBlock?: {
    fromWeek?: ProgramWeek
    byWeek?: Partial<Record<ProgramWeek, Partial<ProgramDose>>>
  }
  /**
   * Load the card from the user's logged history (engine progression) or a starting estimate.
   * Default: true for external-load lifts that are not explosive; never for bodyweight, assisted,
   * timed or distance work.
   */
  planLoad?: boolean
}

/** Estimated session length from a program week on (the last band at or before the week applies). */
export interface MinutesBand {
  fromWeek: ProgramWeek
  minutes: number
}

export interface ProgramDay {
  /** e.g. "Upper A". */
  title: string
  split: SplitDay
  focus: MuscleGroup[]
  /** Session length by week band; absent = estimated from the cards. */
  estimatedMinutes?: MinutesBand[]
  items: ProgramItem[]
  /** A rest day: the single card is optional. */
  restDay?: boolean
}

export interface ProgramDefinition {
  id: string
  title: string
  /** Goal recorded on the workouts (history, progress). */
  goal: Goal
  /** Length of the block in weeks. */
  weeks: number
  /** After the last week the program repeats from this week (no second re-entry). */
  repeatFromWeek: number
  /** Which day runs on each weekday; null = no session. */
  schedule: Record<Weekday, string | null>
  days: Record<string, ProgramDay>
  /** The block rules, in plan order (shown with the program). */
  blockRules: string[]
  /** The one-line rule for each week, shown on that week's workouts and the coach panel. */
  weekRules: Record<ProgramWeek, string>
  /** Habits that go with the program (focus, fuel, regular checks), shown with the program. */
  habits?: string[]
  /**
   * Bumped whenever the programming changes. Part of the plan key, so a day planned on the device
   * but not started is rebuilt with the new prescription. Absent = 0.
   */
  revision?: number
  /** Extra overview notes for the first pass through one week only (e.g. pre-participation screening before week 1). */
  weekNotes?: Partial<Record<ProgramWeek, string[]>>
}

/** A user's assignment: which program, from which local date. */
export interface ProgramAssignment {
  programId: string
  /** "YYYY-MM-DD", the first day of week 1. */
  startDate: string
}
