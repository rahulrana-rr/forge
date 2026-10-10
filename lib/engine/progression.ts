/**
 * Progressive overload: recommend the next working weight from history, and progress the reps,
 * holds and sets of work that has no load to add (bodyweight and timed exercises).
 */
import { getExercise, muscleGroupOf } from "@/lib/exercises"
import { DIFFICULTY_RANK, type Exercise, type MuscleGroup } from "@/lib/exercises/types"
import type { CompletedExercise, CompletedWorkout, ExerciseProgress, SetLog, Units, UserProfile, WorkoutRole } from "@/lib/domain/types"
import { formatWeight, fromKg, loadStep, roundToStep, toKg } from "@/lib/units"
import { difficultyAllowed, equipmentAllowed, kitTagsAllowed, limitationsAllow } from "./selection"
import { estimateStartingLoad, KETTLEBELL_STEP, UPPER_ESTIMATE_FACTOR } from "./starting-load"
import { slowerEccentricTempo } from "./prescriptions"
import { HEAVY_BUILD_UP_SETS } from "./duration"

export type LoadKind = "barbell" | "dumbbell" | "kettlebell" | "machine" | "other"

const LOWER_GROUPS: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(["quads", "hamstrings", "glutes", "calves"])

export function loadKindOf(exercise: Exercise): LoadKind {
  const eq = exercise.equipment
  if (eq.includes("barbell") || eq.includes("trap_bar") || eq.includes("ez_bar") || eq.includes("smith_machine") || eq.includes("landmine")) return "barbell"
  if (eq.includes("dumbbell")) return "dumbbell"
  // Bells come in fixed sizes (4 kg / 5 lb apart), not the 2 kg dumbbell step.
  if (eq.includes("kettlebell")) return "kettlebell"
  if (eq.includes("machine") || eq.includes("cable")) return "machine"
  return "other"
}

/** Load step in the user's units for a load kind. */
function stepOf(units: Units, kind: LoadKind): number {
  return kind === "kettlebell" ? KETTLEBELL_STEP[units] : loadStep(units, kind)
}

/** Nearest load the user can set up, in kg. Kettlebells round to a standard bell. */
function roundLoad(kg: number, units: Units, kind: LoadKind): number {
  if (kind !== "kettlebell") return roundToStep(kg, units, kind)
  const step = KETTLEBELL_STEP[units]
  return toKg(Math.round(fromKg(kg, units) / step) * step, units)
}

/** Heaviest load at or below `kg` the user can set up, in kg. */
function floorLoad(kg: number, units: Units, kind: LoadKind): number {
  const step = stepOf(units, kind)
  return toKg(Math.floor(fromKg(kg, units) / step + 1e-9) * step, units)
}

/** Epley estimated one-rep max. */
export function e1rm(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30)
}

/** Weight that yields roughly `reps` reps at a given e1RM. */
export function weightForReps(e1rmKg: number, reps: number): number {
  return e1rmKg / (1 + reps / 30)
}

/** One logged session of an exercise. */
export interface PerformanceRecord {
  sets: SetLog[]
  /** The rep range prescribed at the time, when known. */
  prescribedReps: [number, number] | null
  date: string
  /** Seconds per set prescribed at the time (timed work), when known. */
  prescribedDurationSeconds?: number | null
  /** Working sets prescribed at the time, when known. */
  prescribedSets?: number | null
  /**
   * Tempo prescribed at the time, when known (a slower lowering earned at the rep ceiling is kept).
   * Optional: completed workouts do not record it yet.
   */
  prescribedTempo?: string | null
  /**
   * Rest between sets prescribed at the time, when known (a conditioning block's shortened rest is
   * kept). Optional: completed workouts do not record it yet.
   */
  prescribedRestSeconds?: number | null
}

export interface LastPerformance extends PerformanceRecord {
  /**
   * The load was a first-session guess: the session was logged from a starting estimate, or it is
   * the first time this exercise was ever logged. Optional; absent means "not known to be".
   */
  calibration?: boolean
  /** The session before the last one, when known (double progression on big load jumps). */
  previous?: PerformanceRecord | null
}

/**
 * Prescription fields a completed exercise may carry once lib/domain/types.ts records them
 * (additive, optional). Read when present so an earned tempo or a shortened conditioning rest
 * carries over (coach round 2, R12); absent on today's records.
 */
type RecordedPrescription = { prescribedTempo?: string | null; prescribedRestSeconds?: number | null }

function completedEntries(exerciseId: string, history: readonly CompletedWorkout[]) {
  const sorted = history.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const out: { workoutId: string; record: PerformanceRecord; estimate: boolean }[] = []
  for (const workout of sorted) {
    for (const entry of workout.exercises) {
      if (entry.exerciseId !== exerciseId || entry.status !== "completed") continue
      const sets = entry.sets.filter((s) => s.completed)
      if (sets.length === 0) continue
      // A session logged from a starting estimate is a calibration session (CompletedExercise.weightSource).
      const estimate = entry.weightSource === "estimate"
      const recorded = entry as CompletedExercise & RecordedPrescription
      out.push({
        workoutId: workout.id,
        estimate,
        record: {
          sets,
          prescribedReps: entry.prescribedReps,
          date: workout.date,
          prescribedDurationSeconds: entry.prescribedDurationSeconds,
          prescribedSets: entry.prescribedSets,
          prescribedTempo: recorded.prescribedTempo ?? null,
          prescribedRestSeconds: recorded.prescribedRestSeconds ?? null,
        },
      })
      break
    }
    if (out.length >= 2) break
  }
  return out
}

/** Most recent completed performance of an exercise, from history first, then progress. */
export function lastPerformance(
  exerciseId: string,
  history: readonly CompletedWorkout[],
  progress: Record<string, ExerciseProgress>,
): LastPerformance | null {
  const entries = completedEntries(exerciseId, history)
  const sessions = progress[exerciseId]?.recentSessions ?? []
  const timesPerformed = progress[exerciseId]?.timesPerformed
  const [latest, before] = entries
  if (latest) {
    let previous: PerformanceRecord | null = before?.record ?? null
    if (!previous) {
      const older = sessions.find((s) => s.workoutId !== latest.workoutId && s.date <= latest.record.date)
      const sets = older?.sets.filter((s) => s.completed) ?? []
      if (older && sets.length > 0) previous = { sets, prescribedReps: null, date: older.date }
    }
    const firstTime = previous === null && (timesPerformed ?? 1) <= 1
    return { ...latest.record, calibration: latest.estimate || firstTime, previous }
  }
  const [session, older] = sessions
  if (session) {
    const sets = session.sets.filter((s) => s.completed)
    if (sets.length > 0) {
      const olderSets = older?.sets.filter((s) => s.completed) ?? []
      const previous = older && olderSets.length > 0 ? { sets: olderSets, prescribedReps: null, date: older.date } : null
      return { sets, prescribedReps: null, date: session.date, calibration: previous === null && (timesPerformed ?? 1) <= 1, previous }
    }
  }
  return null
}

export interface WeightRecommendation {
  weightKg: number | null
  note: string | null
}

export interface ProgressionOptions {
  /** Target reps in reserve for today's working sets. Unknown is treated as 3 (conservative). */
  rir?: number | null
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function sameRange(a: [number, number] | null, b: [number, number]): boolean {
  return a !== null && a[0] === b[0] && a[1] === b[1]
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1]
}

/** Logged RPE at or below this means the set ended with 4 or more reps in reserve: it was easy. */
const EASY_RPE = 6
/** Most a recalibration from logged effort may add in one session. */
const MAX_RECALIBRATION_JUMP = 0.25
/**
 * Most a first session logged as easy (every rated set at RPE 6 or lower) may add at once (coach
 * round 2, R10): the starting guess was far under the lifter, and +25% a session took weeks to
 * converge. The e1RM itself still bounds the jump (reserve read from RPE is capped).
 */
const MAX_CALIBRATION_JUMP = 0.5
/** Reps in reserve read from an RPE are capped: the scale is only meaningful near failure. */
const MAX_RESERVE_FROM_RPE = 6
/** A recalibrated load is still new: it aims for at least this many reps in reserve. */
const MIN_RECALIBRATION_RIR = 2
/**
 * Load jumps bigger than this share wait for a second top-of-range session, whatever the
 * implement (coach round 2, R11): a 2 kg dumbbell step is +50% on 4 kg, and a kettlebell's next
 * bell is often +25% or more.
 */
const BIG_JUMP_SHARE = 0.1
/** A load translated through e1RM to a rep window that shares no rep with the last one is discounted. */
const TRANSLATION_DISCOUNT = 0.95

function ratedSets(sets: readonly SetLog[]): SetLog[] {
  return sets.filter((s) => s.rpe != null && s.rpe >= 1 && s.rpe <= 10)
}

function reserveOf(set: SetLog): number {
  return set.rpe != null ? Math.min(MAX_RESERVE_FROM_RPE, Math.max(0, 10 - set.rpe)) : 0
}

/** Next heavier load after `lastWeight`: +pct rounded to the step, at least one step; the next bell for kettlebells. */
function nextLoad(lastWeight: number, pct: number, units: Units, kind: LoadKind): number {
  if (kind === "kettlebell") {
    const step = KETTLEBELL_STEP[units]
    return toKg((Math.floor(fromKg(lastWeight, units) / step + 1e-9) + 1) * step, units)
  }
  const stepKg = toKg(stepOf(units, kind), units)
  let next = roundLoad(lastWeight * (1 + pct), units, kind)
  if (next <= lastWeight) next = roundLoad(lastWeight + stepKg, units, kind)
  if (next <= lastWeight) next = lastWeight + stepKg
  return next
}

/** Best estimated 1RM of the logged sets, counting the reserve a logged RPE reports. */
function bestE1rm(weighted: readonly SetLog[]): number {
  return Math.max(...weighted.map((s) => e1rm(s.weightKg ?? 0, (s.reps ?? 0) + reserveOf(s))))
}

/**
 * The load for a rep window that shares no rep with the last one (or after missed reps in a
 * changed window): through e1RM to the middle of today's window plus the planned reserve, then
 * discounted, because a different kind of set is a new load (coach round 2, R03).
 */
function translatedLoad(weighted: readonly SetLog[], reps: [number, number], rir: number, units: Units, kind: LoadKind): number {
  const stepKg = toKg(stepOf(units, kind), units)
  const target = Math.round((reps[0] + reps[1]) / 2) + rir
  return Math.max(stepKg, roundLoad(weightForReps(bestE1rm(weighted), target) * TRANSLATION_DISCOUNT, units, kind))
}

/**
 * Recommend the working weight for an external-load prescription. Last session is judged against
 * its own rep window, so a lift whose window differs between two templates (6–10 as a primary on
 * one day, 7–11 as a secondary on another) still progresses (coach round 2, R03).
 * - every set reached the top of last session's window (or of today's, when that is lower) →
 *   +2.5% upper / +5% lower, rounded up to the load step (kettlebells: the next standard bell)
 *   - and the logged RPE says the sets were easy (≤ 6), or the load was a first-session guess and
 *     RPE was logged → recalibrate through e1RM from reps + reserve, aiming at today's RIR from the
 *     bottom of the range, never more than +25% (+50% for a first session logged as easy) and
 *     never less than the normal step
 *   - today's window starts at more reps than last session's → the step is capped at the load
 *     the logged sets support for today's bottom rep count (no discount), never below the last load
 *   - any load whose step is more than ~10% heavier (a light dumbbell, the next bell) → own the
 *     top of the range in two sessions at that load before the jump, unless logged effort supports
 *     it (coach round 2, R11)
 * - a set missed the bottom of last session's window → repeat the load (in a changed window, when
 *   it also falls short of today's bottom: the discounted e1RM translation, never above the last load)
 * - otherwise → same load
 * - today's window shares no rep with last session's → translate through e1RM to today's window
 *   plus the planned RIR, discounted
 * Returns null without usable history or for non-external loads.
 */
export function recommendWeight(
  exercise: Exercise,
  reps: [number, number] | null,
  last: LastPerformance | null,
  units: Units,
  options: ProgressionOptions = {},
): WeightRecommendation {
  if (!last) return { weightKg: null, note: null }
  const kind = loadKindOf(exercise)
  const weighted = last.sets.filter((s) => s.weightKg !== null && s.weightKg > 0 && s.reps !== null && s.reps > 0)

  if (exercise.loadType === "timed" || exercise.loadType === "distance") return { weightKg: null, note: null }

  if (exercise.loadType === "bodyweight" || exercise.loadType === "assisted") {
    if (weighted.length === 0) return { weightKg: null, note: null }
    const lastWeight = Math.max(...weighted.map((s) => s.weightKg ?? 0))
    return { weightKg: round2(lastWeight), note: `Last time: ${formatWeight(lastWeight, units)} added.` }
  }

  if (weighted.length === 0 || !reps) return { weightKg: null, note: null }
  const lastWeight = Math.max(...weighted.map((s) => s.weightKg ?? 0))
  const lastReps = weighted.map((s) => s.reps ?? 0)
  const rir = options.rir ?? 3
  const lastWindow = last.prescribedReps
  const changed = lastWindow !== null && !sameRange(lastWindow, reps)

  if (lastWindow !== null && changed && !overlaps(lastWindow, reps)) {
    const weight = translatedLoad(weighted, reps, rir, units, kind)
    return { weightKg: round2(weight), note: `Rep range changed: ${formatWeight(weight, units)} targets ${reps[0]}–${reps[1]} reps.` }
  }

  // Judge last session by the window it was prescribed: today's may differ by a rep or two.
  const window = lastWindow ?? reps
  const topHit = lastReps.every((r) => r >= Math.min(window[1], reps[1]))
  const missed = lastReps.some((r) => r < window[0])
  if (topHit) {
    const pct = LOWER_GROUPS.has(muscleGroupOf(exercise)) ? 0.05 : 0.025
    let step = nextLoad(lastWeight, pct, units, kind)
    const rated = ratedSets(weighted)
    const easy = rated.length > 0 && rated.every((s) => (s.rpe ?? 10) <= EASY_RPE)

    // Logged effort says how far from failure the sets ended: recalibrate instead of one step.
    let recalibrated: number | null = null
    if (rated.length > 0 && (easy || last.calibration)) {
      const e1 = Math.min(...rated.map((s) => e1rm(s.weightKg ?? 0, (s.reps ?? 0) + reserveOf(s))))
      const targetReps = reps[0] + Math.max(MIN_RECALIBRATION_RIR, rir)
      const jump = last.calibration && easy ? MAX_CALIBRATION_JUMP : MAX_RECALIBRATION_JUMP
      const capped = Math.min(weightForReps(e1, targetReps), lastWeight * (1 + jump))
      recalibrated = floorLoad(capped, units, kind)
    }
    if (recalibrated !== null && recalibrated > step) {
      return {
        weightKg: round2(recalibrated),
        note: `Up from ${formatWeight(lastWeight, units)}: your logged effort says it was light, so this jumps more than one step.`,
      }
    }

    // Today's window asks for more reps at the bottom: step only as far as the logged sets support.
    if (changed && reps[0] > window[0]) {
      const supports = floorLoad(weightForReps(bestE1rm(weighted), reps[0]), units, kind)
      if (supports < step) step = Math.max(lastWeight, supports)
      if (step <= lastWeight) {
        return {
          weightKg: round2(lastWeight),
          note: `Same ${formatWeight(lastWeight, units)}; today's range starts at ${reps[0]} reps, so aim for ${reps[1]} on every set.`,
        }
      }
    }

    const bigJump = step - lastWeight > BIG_JUMP_SHARE * lastWeight + 1e-9
    const supported = recalibrated !== null && recalibrated >= step
    if (bigJump && !easy && !supported && !toppedBefore(last, lastWeight)) {
      return { weightKg: round2(lastWeight), note: bigJumpHoldNote(lastWeight, step, reps, units, kind) }
    }
    return { weightKg: round2(step), note: `Up from ${formatWeight(lastWeight, units)}: you hit the top of the range last time.` }
  }
  // Missed last session's window and short of today's too: a new load through e1RM, never heavier.
  if (missed && changed && lastReps.some((r) => r < reps[0])) {
    const weight = Math.min(lastWeight, translatedLoad(weighted, reps, rir, units, kind))
    if (weight < lastWeight) {
      return { weightKg: round2(weight), note: `Rep range changed: ${formatWeight(weight, units)} targets ${reps[0]}–${reps[1]} reps.` }
    }
  }
  if (missed) {
    return { weightKg: round2(lastWeight), note: `Stay at ${formatWeight(lastWeight, units)} and own every rep this time.` }
  }
  return { weightKg: round2(lastWeight), note: `Same ${formatWeight(lastWeight, units)}; aim for ${reps[1]} reps on every set.` }
}

/**
 * Card note for a load held because its next step is a big jump. Kettlebells name the next bell;
 * slot-notes.ts and lib/coach/notes.ts key on the "Stay at …: the next bell" / "the next step" wording.
 */
function bigJumpHoldNote(lastWeight: number, step: number, reps: [number, number], units: Units, kind: LoadKind): string {
  const next = kind === "kettlebell" ? "bell" : "step"
  return `Stay at ${formatWeight(lastWeight, units)}: the next ${next} (${formatWeight(step, units)}) is a big jump. Hit ${reps[1]} reps on every set once more, then move up.`
}

/** Whether the session before `last` was at the same load with every set at the top of its range. */
function toppedBefore(last: LastPerformance, weightKg: number): boolean {
  const previous = last.previous
  const range = previous?.prescribedReps ?? last.prescribedReps
  if (!previous || !range) return false
  const weighted = previous.sets.filter((s) => s.weightKg !== null && s.weightKg > 0 && s.reps !== null)
  if (weighted.length === 0) return false
  const sameLoad = Math.abs(Math.max(...weighted.map((s) => s.weightKg ?? 0)) - weightKg) < 0.01
  return sameLoad && weighted.every((s) => (s.reps ?? 0) >= range[1])
}

export interface PlannedLoad extends WeightRecommendation {
  /** "history" = progression from logged sets, "estimate" = conservative first-session guess. */
  weightSource: "history" | "estimate" | null
  /**
   * The last logged load looks like a logging slip (far above the profile's starting estimate, with
   * no session before it at a similar load): it is shown unchanged with a check note and is not
   * progressed until a second session at that load confirms it.
   */
  loadCheck?: boolean
}

/**
 * A logged load more than this many times the upper end of the profile's estimate (the raw
 * starting value × UPPER_ESTIMATE_FACTOR, so 6× the conservative guess) is checked before it
 * progresses. Coach round 2 (R10): 3× the deliberately light guess flagged genuine loads of trained
 * lifters (an advanced lifter's 10 kg lateral raise) as slips.
 */
export const LOAD_CHECK_FACTOR = 3
/** A jump from the session before larger than this share is not yet confirmed by it. */
const LOAD_CHECK_CONFIRM_JUMP = 1.3

/** Card note for a logged load that looks like a slip; notes.ts keys on the "Check your logged weight" prefix. */
export function loadCheckNote(exercise: Exercise): string {
  const perHand = loadKindOf(exercise) === "dumbbell" && !exercise.tags?.includes("single_implement")
  return `Check your logged weight${perHand ? " (per dumbbell?)" : ""}: confirm it before it goes up.`
}

function heaviestKg(sets: readonly SetLog[] | undefined): number | null {
  const loads = (sets ?? []).filter((s) => (s.weightKg ?? 0) > 0 && (s.reps ?? 0) > 0).map((s) => s.weightKg ?? 0)
  return loads.length > 0 ? Math.max(...loads) : null
}

/**
 * Whether the last logged load needs checking: more than LOAD_CHECK_FACTOR × the upper end of the
 * profile's estimate (40 kg "per hand" on a beginner woman's seated dumbbell press, whose starting
 * value is about 2 kg), and not confirmed by the session before it at a similar load. Gradual progression past the threshold
 * is never flagged, because each session confirms the next. A lift without a heuristic (machines,
 * cables) is never checked.
 */
function needsLoadCheck(
  exercise: Exercise,
  reps: [number, number] | null,
  last: LastPerformance,
  profile: Pick<UserProfile, "weightKg" | "gender" | "experience" | "units">,
): number | null {
  const logged = heaviestKg(last.sets)
  if (logged === null) return null
  const raw = estimateStartingLoad(exercise, profile, reps).rawKg
  const reference = raw !== null ? raw * UPPER_ESTIMATE_FACTOR : null
  if (reference === null || reference <= 0 || logged <= LOAD_CHECK_FACTOR * reference) return null
  const before = heaviestKg(last.previous?.sets)
  if (before !== null && logged <= before * LOAD_CHECK_CONFIRM_JUMP) return null
  return logged
}

/**
 * Card note for every starting estimate: the first set calibrates it. Coach round 2 (R10): it says
 * how far to move when set 1 is far too light (about 3% per spare rep, Epley), not just "go up".
 */
export const STARTING_GUESS_NOTE =
  "Starting guess: if set 1 leaves more than 4 reps in reserve, go up about 10–20% before set 2; if you cannot reach the bottom of the range, go down. Log the load that matches the target RIR."

/**
 * Every "find your working weight" note starts with this; slot-notes.ts and lib/coach/notes.ts
 * key on it, and lib/coach/apply.ts rewrites its "until … reps leave about N in reserve" clause.
 */
export const FIND_WORKING_WEIGHT_PREFIX = "Find your working weight: "
/** The band version of the note (band-only lifts), for a band-specific code in lib/coach/notes.ts. */
export const FIND_BAND_PREFIX = `${FIND_WORKING_WEIGHT_PREFIX}start with a light band`

interface FindWeightContext {
  /** The lift starts from an empty bar (barbell, EZ bar). */
  bar: boolean
  /** The only resistance is a band. */
  band: boolean
  /** A heavy compound (warmupRequired) with a trained lifter's unknown load: more build-up sets. */
  heavy: boolean
  /** Trunk work (core spec C15): no build-up sets; the first working set sets the load. */
  trunk: boolean
}

/**
 * "Find your working weight": the build-up sets are named as extra, so a 2-set slot still gets two
 * sets at the target effort (coach round 2, R04). A trained lifter's heavy compound builds up over
 * 3–4 sets, other lifts over 1–2. A band lift picks a band and says how to progress it. Trunk work
 * (core spec C15) has no build-up: the first set sets the weight, held to the reps in reserve when
 * the slot has an RIR target (`rir` set) and to position when it does not (`rir` null).
 */
function findWorkingWeightNote(reps: [number, number], rir: number | null, { bar, band, heavy, trunk }: FindWeightContext): string {
  const target = `until ${reps[0]}–${reps[1]} reps leave about ${rir ?? 3} in reserve`
  if (band) {
    return `${FIND_BAND_PREFIX} and move to a stronger one ${target}, then do your working sets with it. When every set reaches the top of the range, use a heavier band or stand farther from the anchor.`
  }
  if (trunk) {
    const effort = rir === null ? "without losing position" : target
    return `${FIND_WORKING_WEIGHT_PREFIX}the first set sets the weight: pick a load you control for every rep with a 2 s pause ${effort}, then keep it for your working sets and log it.`
  }
  const start = bar ? "start with the empty bar" : "start light"
  const sets = heavy ? HEAVY_BUILD_UP_SETS : "1–2"
  return `${FIND_WORKING_WEIGHT_PREFIX}${start} and add weight over ${sets} build-up sets ${target}, then do your working sets at that load and log it.`
}

/**
 * Olympic and skill lifts have no body-weight estimate (technique, not muscle, limits the load).
 * Their first session still says how to choose one: build up only while every rep stays clean.
 */
function techniqueLoadNote(bar: boolean): string {
  const start = bar ? "start with the empty bar" : "start light"
  return `${FIND_WORKING_WEIGHT_PREFIX}${start} and add weight over a few build-up sets only while every rep stays fast and technically clean, then do your working sets at that load and log it.`
}

const TECHNIQUE_LIMITED_TAGS: readonly string[] = ["olympic", "skill"]

/**
 * The load shown on a main-phase card: progression from history when the user has logged this
 * lift with a weight, otherwise a conservative starting estimate from body weight, gender and
 * experience (see starting-load.ts) with a calibration note, otherwise a "find your working
 * weight" note for every other external-load lift with a rep target (machines, cables and bands
 * included, coach round 2 R04), otherwise nothing.
 */
export function planLoad(
  exercise: Exercise,
  reps: [number, number] | null,
  last: LastPerformance | null,
  profile: Pick<UserProfile, "weightKg" | "gender" | "experience" | "units">,
  options: ProgressionOptions = {},
): PlannedLoad {
  const rec = recommendWeight(exercise, reps, last, profile.units, options)
  if (rec.weightKg != null) {
    const unconfirmed = last && exercise.loadType === "external" ? needsLoadCheck(exercise, reps, last, profile) : null
    if (unconfirmed !== null) return { weightKg: round2(unconfirmed), note: loadCheckNote(exercise), weightSource: "history", loadCheck: true }
    return { ...rec, weightSource: "history" }
  }
  const estimate = estimateStartingLoad(exercise, profile, reps)
  if (estimate.weightKg != null) return { weightKg: estimate.weightKg, note: STARTING_GUESS_NOTE, weightSource: "estimate" }
  // A free bar (barbell, trap bar, EZ bar, a landmine's bar) is the lightest set-up: start there.
  const bar = exercise.equipment.some((e) => e === "barbell" || e === "trap_bar" || e === "ez_bar")
  if (estimate.findWorkingWeight && reps) {
    const trunk = exercise.category === "core"
    // A trunk drill with no RIR target (anti-movement work, core spec C14) is held to position.
    const rir = trunk && options.rir === null ? null : Math.max(MIN_RECALIBRATION_RIR, options.rir ?? 3)
    const heavy = exercise.warmupRequired && profile.experience !== "beginner"
    return { weightKg: null, note: findWorkingWeightNote(reps, rir, { bar, band: estimate.band ?? false, heavy, trunk }), weightSource: null }
  }
  if (reps && exercise.loadType === "external" && exercise.tags?.some((t) => TECHNIQUE_LIMITED_TAGS.includes(t))) {
    return { weightKg: null, note: techniqueLoadNote(bar), weightSource: null }
  }
  return { weightKg: null, note: rec.note, weightSource: null }
}

// ---------------------------------------------------------------------------------------------
// Work with no load to add: bodyweight reps and timed holds.

export interface UnloadedProgression {
  sets: number
  reps: [number, number] | null
  durationSeconds: number | null
  note: string | null
  /** A harder variation to suggest once reps and sets are at their ceiling (suggested, never swapped in). */
  nextExerciseId: string | null
  /**
   * The tempo to prescribe when the progression slows the lowering (reps and sets at their ceiling,
   * no harder variation). Optional; absent means the tempo is unchanged. The card shows it, so card
   * and note agree (coach round 2, R12).
   */
  tempo?: string | null
}

// slowerEccentricTempo lives in prescriptions.ts (the live prescription path uses it too, and
// prescriptions.ts must not import this module at runtime); it is re-exported here.
export { slowerEccentricTempo }

/** Seconds of lowering in a tempo string, or null. */
function eccentricSeconds(tempo: string): number | null {
  const first = tempo.split("-")[0]?.trim() ?? ""
  return /^\d+$/.test(first) ? Number(first) : null
}

export interface UnloadedProgressionOptions {
  /** Used to vet a harder variation (equipment, experience, limitations, exclusions). Without it, none is suggested. */
  profile?: Pick<UserProfile, "equipment" | "experience" | "limitations" | "excludedExerciseIds">
  lookup?: (id: string) => Exercise | undefined
  /** Finishers are sized to a time budget and never progress here. */
  role?: WorkoutRole
}

/** Reps added to a bodyweight window once every set reached its top. */
const REP_STEP = 3
/** Seconds added to a timed block once every set was held for the full time. */
const HOLD_STEP_SECONDS = 5
/** Rep counts limited by technique or power, not by fatigue: more reps is not progress. */
const FIXED_REP_TAGS: readonly string[] = ["olympic", "skill", "complex", "explosive"]

/**
 * A harder variation of an unloaded exercise the user can do: the parent of a regression (knee
 * push-up → push-up) or a listed alternative of the same pattern rated harder, that passes the
 * user's equipment, experience, limitations and exclusions.
 */
export function harderVariation(
  exercise: Exercise,
  profile: Pick<UserProfile, "equipment" | "experience" | "limitations" | "excludedExerciseIds"> & Partial<Pick<UserProfile, "equipmentPreset">>,
  lookup: (id: string) => Exercise | undefined = getExercise,
): Exercise | null {
  const ids = [exercise.variationOf, ...exercise.alternativeExercises].filter((id): id is string => !!id)
  for (const id of ids) {
    const candidate = lookup(id)
    if (!candidate || candidate.id === exercise.id) continue
    if (candidate.loadType !== "bodyweight" && candidate.loadType !== "timed") continue
    if (candidate.movementPattern !== exercise.movementPattern) continue
    const harder = DIFFICULTY_RANK[candidate.difficulty] > DIFFICULTY_RANK[exercise.difficulty]
    const regressionOf = candidate.id === exercise.variationOf && (exercise.tags?.includes("beginner_friendly") ?? false)
    if (!harder && !regressionOf) continue
    if (!equipmentAllowed(candidate, profile.equipment) || !kitTagsAllowed(candidate, profile) || !difficultyAllowed(candidate, profile.experience)) continue
    if (!limitationsAllow(candidate, profile) || profile.excludedExerciseIds.includes(candidate.id)) continue
    return candidate
  }
  return null
}

/**
 * Double progression for unloaded work, from the last logged session.
 * - bodyweight reps: every prescribed set reached the top of the window (and no logged RPE says the
 *   reserve was below today's RIR) → the window moves up ~3 reps inside the exercise's own range;
 *   at the range's ceiling one set is added within the slot's bounds; with sets maxed too, a harder
 *   variation is suggested. A set below the bottom of the window repeats the prescription.
 * - timed holds: every set held for the full time → +5 s per block up to the exercise's longest
 *   duration, then the same set and variation steps.
 * A window or hold earned earlier is kept (not reset to the slot default). With reps and sets at
 * their ceiling and no harder variation, the lowering slows by a second and the new tempo is
 * returned with the note (coach round 2, R12). Returns null when there is nothing to change: no
 * usable history, loaded or assisted work, explosive or skill lifts, finishers, or a prescription
 * that changed for another reason.
 */
export function progressUnloaded(
  exercise: Exercise,
  rx: {
    sets: number
    reps: [number, number] | null
    durationSeconds: number | null
    rir: number | null
    maxSets: number
    /** Today's prescribed tempo; undefined falls back to the exercise's own. */
    tempo?: string | null
  },
  last: LastPerformance | null,
  options: UnloadedProgressionOptions = {},
): UnloadedProgression | null {
  if (!last || options.role === "finisher") return null
  if (exercise.tags?.some((t) => FIXED_REP_TAGS.includes(t))) return null
  if (last.sets.some((s) => s.weightKg != null && s.weightKg !== 0)) return null
  const prescribedSets = last.prescribedSets ?? last.sets.length
  const enoughSets = last.sets.length >= prescribedSets
  const reserveOk = ratedSets(last.sets).every((s) => 10 - (s.rpe ?? 10) >= (rx.rir ?? 0))
  // Sets earned at the ceiling earlier are kept, within the slot's bounds.
  const carriedSets = Math.min(rx.maxSets, Math.max(rx.sets, prescribedSets))

  /**
   * Reps or hold already at the exercise's ceiling and every set topped: a set, then a harder
   * variation, then (reps only) a slower lowering written into the tempo.
   */
  const earned = last.prescribedTempo ?? null
  const ceilingStep = (
    target: Pick<UnloadedProgression, "reps" | "durationSeconds">,
    done: string,
    holdAdvice = "keep the position strict, or try a harder variation with Replace.",
  ): UnloadedProgression => {
    if (carriedSets < rx.maxSets) {
      return { ...target, sets: carriedSets + 1, note: `${done}: one more set today.`, nextExerciseId: null }
    }
    const next = options.profile ? harderVariation(exercise, options.profile, options.lookup) : null
    if (next) {
      return { ...target, sets: carriedSets, note: `${done}: you are ready for ${next.name}. Swap it in with Replace.`, nextExerciseId: next.id }
    }
    if (target.reps) {
      // The slower tempo is built from the one prescribed (a slower one earned last time is kept).
      const base = rx.tempo === undefined ? (exercise.tempo ?? null) : rx.tempo
      const baseSeconds = base ? eccentricSeconds(base) : null
      const earnedSeconds = earned ? eccentricSeconds(earned) : null
      const from = earned && earnedSeconds !== null && (baseSeconds === null || earnedSeconds > baseSeconds) ? earned : base
      const tempo = slowerEccentricTempo(from)
      const seconds = tempo ? eccentricSeconds(tempo) : null
      if (tempo && seconds !== null) {
        return { ...target, sets: carriedSets, note: `${done}: lower each rep over ${seconds} s (tempo ${tempo}) to keep it challenging.`, nextExerciseId: null, tempo }
      }
      return { ...target, sets: carriedSets, note: `${done}: you are ready for a harder variation. Pick one with Replace.`, nextExerciseId: null }
    }
    return { ...target, sets: carriedSets, note: `${done}: ${holdAdvice}`, nextExerciseId: null }
  }

  if (exercise.loadType === "bodyweight" && rx.reps && exercise.repRange) {
    const range = exercise.repRange
    const base = rx.reps
    const lastWindow = last.prescribedReps
    let window: [number, number]
    if (lastWindow === null || sameRange(lastWindow, base)) window = base
    else if (
      lastWindow[0] > base[0] &&
      lastWindow[1] - lastWindow[0] === base[1] - base[0] &&
      lastWindow[0] >= range[0] &&
      lastWindow[1] <= range[1]
    ) window = lastWindow
    else return null
    const reps = last.sets.map((s) => s.reps ?? 0)
    const topped = enoughSets && reserveOk && reps.length > 0 && reps.every((r) => r >= window[1])
    const missed = reps.some((r) => r < window[0])
    const atCeiling = window[1] >= range[1]
    if (topped && !atCeiling) {
      const shift = Math.min(REP_STEP, range[1] - window[1])
      const next: [number, number] = [window[0] + shift, window[1] + shift]
      return { sets: rx.sets, reps: next, durationSeconds: null, note: `Top of the range last time: aim for ${next[0]}–${next[1]} reps today.`, nextExerciseId: null }
    }
    if (topped) {
      return ceilingStep({ reps: window, durationSeconds: null }, `${window[1]} reps on every set`)
    }
    const sets = atCeiling ? carriedSets : rx.sets
    if (window === base && sets === rx.sets) return null
    const note = missed ? `Same ${window[0]}–${window[1]} reps: own every rep before moving on.` : `Aim for ${window[1]} reps on every set.`
    return { sets, reps: window, durationSeconds: null, note, nextExerciseId: null }
  }

  if (exercise.loadType === "timed" && rx.durationSeconds != null && exercise.durationRange) {
    const longest = exercise.durationRange[1]
    const base = rx.durationSeconds
    const lastTarget = last.prescribedDurationSeconds ?? null
    let target: number
    if (lastTarget === null || lastTarget === base) target = base
    else if (lastTarget > base && lastTarget <= longest) target = lastTarget
    else return null
    const held = last.sets.map((s) => s.durationSeconds ?? 0)
    const topped = enoughSets && held.length > 0 && held.every((d) => d >= target)
    const atCeiling = target >= longest
    if (topped && !atCeiling) {
      const next = Math.min(longest, target + HOLD_STEP_SECONDS)
      return { sets: rx.sets, reps: null, durationSeconds: next, note: `Held the full ${target} s last time: ${next} s per set today.`, nextExerciseId: null }
    }
    if (topped) {
      return ceilingStep({ reps: null, durationSeconds: target }, `The full ${target} s on every set`)
    }
    const sets = atCeiling ? carriedSets : rx.sets
    if (target === base && sets === rx.sets) return null
    return { sets, reps: null, durationSeconds: target, note: `Same ${target} s: hold every set for the full time.`, nextExerciseId: null }
  }

  return null
}

// ---------------------------------------------------------------------------------------------
// Conditioning finishers.

/** A conditioning block's work: rounds, reps or seconds per round, and rest between rounds. */
export interface FinisherWork {
  sets: number
  reps: [number, number] | null
  durationSeconds: number | null
  restSeconds: number
}

export interface FinisherProgression extends FinisherWork {
  /** What moved since last time; null when the block is held at every ceiling. */
  note: string | null
}

/** Seconds of work added per round, and rest taken off, when every round was completed. */
const FINISHER_WORK_STEP_SECONDS = 5
const FINISHER_REST_STEP_SECONDS = 5

/**
 * Progression for a conditioning finisher (coach round 2, R12: finishers repeated the same dose
 * for weeks). When every round of the last session was completed, one lever moves per session,
 * starting from what was done last time when that is ahead of today's budget-sized base:
 * +5 s of work per round up to the exercise's longest block, then one more round up to its
 * set range, then 5 s less rest down to its shortest rest. At every ceiling the block done last
 * time is kept (note null). Returns null without history, when a round was missed or cut short,
 * or when nothing differs from today's base. Completed workouts do not record rest yet, so a
 * shortened rest carries over only when the caller supplies `last.prescribedRestSeconds`.
 */
export function progressFinisher(exercise: Exercise, rx: FinisherWork, last: LastPerformance | null): FinisherProgression | null {
  if (!last) return null
  const plannedRounds = last.prescribedSets ?? null
  const done = last.sets.filter((s) => s.completed)
  if (plannedRounds === null || plannedRounds <= 0 || done.length < plannedRounds) return null

  const lastWork = last.prescribedDurationSeconds ?? null
  if (rx.durationSeconds !== null) {
    // A block logged shorter than it was prescribed is not a completed round.
    const target = lastWork ?? rx.durationSeconds
    if (done.some((s) => s.durationSeconds != null && s.durationSeconds < target)) return null
  } else if (rx.reps) {
    const floor = last.prescribedReps?.[0] ?? rx.reps[0]
    if (done.some((s) => s.reps != null && s.reps < floor)) return null
  }

  const sets = Math.max(rx.sets, plannedRounds)
  const work = rx.durationSeconds !== null ? Math.max(rx.durationSeconds, lastWork ?? 0) : null
  const rest = Math.min(rx.restSeconds, last.prescribedRestSeconds ?? rx.restSeconds)
  const carried: FinisherWork = { sets, reps: rx.reps, durationSeconds: work, restSeconds: rest }

  const longest = exercise.durationRange?.[1] ?? null
  if (work !== null && longest !== null && work < longest) {
    const next = Math.min(longest, work + FINISHER_WORK_STEP_SECONDS)
    return { ...carried, durationSeconds: next, note: `Held the full ${work} s every round last time: ${next} s per round today.` }
  }
  if (sets < exercise.setsRange[1]) {
    return { ...carried, sets: sets + 1, note: "Every round done last time: one more set today." }
  }
  const shortest = exercise.restRange[0]
  if (rest > shortest) {
    const next = Math.max(shortest, rest - FINISHER_REST_STEP_SECONDS)
    return { ...carried, restSeconds: next, note: `Every round done last time: ${next} s rest between rounds today.` }
  }
  const same = carried.sets === rx.sets && carried.durationSeconds === rx.durationSeconds && carried.restSeconds === rx.restSeconds
  return same ? null : { ...carried, note: null }
}
