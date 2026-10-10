/**
 * Duration estimation and fitting a plan to the user's time budget.
 */
import type { Exercise, Goal } from "@/lib/exercises/types"
import { DEFAULT_LIBRARY, type Library } from "./library"
import type { Workout, WorkoutExercise } from "./types"
import { GOAL_PRESCRIPTIONS, heavyEnoughToRamp, isPlyometricPrimer, isTimed, protectedRestSeconds, restCeiling, type MainRole } from "./prescriptions"

/** Seconds per rep when neither the exercise nor a tempo says otherwise; also the floor for tempos. */
export const SECONDS_PER_REP = 3
export const TRANSITION_SECONDS = 45
export const LIGHT_TRANSITION_SECONDS = 10
/** Ramp-up sets before a heavy compound. */
export const RAMP_UP_SECONDS = 120
export const RAMP_UP_NOTE = "Ramp up over 2 lighter sets before your working sets."
/**
 * The ramp-up sentence on a starting estimate (coach round 2, R10): the lighter sets build up to the
 * estimate, and the starting-guess note that follows says how far to move from it.
 */
export const BUILD_UP_NOTE = "Build up to the starting load over 2 lighter sets before your working sets."
/**
 * Build-up sets a trained lifter takes to find a heavy compound's unknown working load
 * (progression.ts findWorkingWeightNote), and the time they take: about 45–60 s each (R10).
 */
export const HEAVY_BUILD_UP_SETS = "3–4"
export const HEAVY_BUILD_UP_SECONDS = 180
/** One lighter feeder set before a heavy lift programmed outside the compound slots. */
export const FEEDER_SET_SECONDS = 60
export const FEEDER_SET_NOTE = "Do 1 lighter feeder set before your working sets."
/** Fraction of the preference below which the plan is considered too short. */
export const FIT_FLOOR = 0.85
/** Fraction of the preference above which sets, then rests, are trimmed. */
export const FIT_CEILING = 1.05
/** Fraction of the preference above which whole exercises are dropped (lowest priority first). */
export const DROP_CEILING = 1.15

/**
 * Heavy lifts the library flags for ramp-up sets, in either compound slot: a deadlift second
 * after a leg press needs its lighter sets as much as one programmed first. When the working
 * load is known (`weightKg`), a load within two steps of the implement's minimum needs none.
 */
export function needsRampUp(role: WorkoutExercise["role"], exercise: Exercise | undefined, weightKg?: number | null): boolean {
  if (!exercise?.warmupRequired) return false
  return (role === "primary_compound" || role === "secondary_compound") && heavyEnoughToRamp(exercise, weightKg)
}

/**
 * A heavy lift (warmupRequired) in an accessory or isolation slot, such as a stand-in barbell row
 * or a leg press after squats: one lighter feeder set, not a full ramp.
 */
export function needsFeederSet(role: WorkoutExercise["role"], exercise: Exercise | undefined, weightKg?: number | null): boolean {
  if (!exercise?.warmupRequired) return false
  return (role === "accessory" || role === "isolation") && heavyEnoughToRamp(exercise, weightKg)
}

/** Ramp-up time budgeted before the working sets of a main-phase slot. */
export function rampUpSeconds(role: WorkoutExercise["role"], exercise: Exercise | undefined, weightKg?: number | null): number {
  if (needsRampUp(role, exercise, weightKg)) return RAMP_UP_SECONDS
  if (needsFeederSet(role, exercise, weightKg)) return FEEDER_SET_SECONDS
  return 0
}

/**
 * Seconds per rep from a tempo string: the sum of its four phases, an explosive "X" counting as
 * 1 s ("3-0-1-1" = 5 s, "2-1-X-0" = 4 s), never below SECONDS_PER_REP. null when unparseable.
 */
export function tempoSecondsPerRep(tempo: string | null | undefined): number | null {
  if (!tempo) return null
  const parts = tempo.split("-").map((p) => p.trim())
  if (parts.length !== 4) return null
  let sum = 0
  for (const p of parts) {
    if (/^x$/i.test(p)) sum += 1
    else if (/^\d+$/.test(p)) sum += Number(p)
    else return null
  }
  return Math.max(SECONDS_PER_REP, sum)
}

/**
 * Seconds one rep takes (per side for unilateral work): the exercise's own figure for complexes
 * and skill lifts, else the prescribed tempo, else SECONDS_PER_REP.
 */
export function secondsPerRep(exercise: Exercise | undefined, tempo: string | null | undefined): number {
  return exercise?.secondsPerRep ?? tempoSecondsPerRep(tempo) ?? SECONDS_PER_REP
}

export interface TimedWork {
  sets: number
  reps: [number, number] | null
  durationSeconds: number | null
  restSeconds: number
  /** Prescribed tempo; undefined falls back to the exercise's own tempo, null means none. */
  tempo?: string | null
  /**
   * Planned working load in kg: a load too light to ramp from gets no ramp time. null means the card
   * shows no load (the lifter finds it); undefined means not planned yet.
   */
  recommendedWeightKg?: number | null
  /** The card note, when known: a trained lifter's "find your working weight" build-up takes longer. */
  note?: string | null
}

/**
 * Lighter sets budgeted before a main-phase slot's working sets: the ramp-up or feeder set of a
 * heavy lift; a trained lifter's 3–4 build-up sets to find a heavy compound's unknown load (R10);
 * and one build-up set for any other external-load lift with no load shown, which always carries a
 * "find your working weight" note (machines, cables, bands; R04). Trunk work has none (core spec C15).
 */
function lighterSetSeconds(work: TimedWork, role: WorkoutExercise["role"], exercise: Exercise | undefined): number {
  // Core spec C15: trunk work never builds up to its load; the first working set finds it.
  if (exercise?.category === "core") return 0
  const ramp = rampUpSeconds(role, exercise, work.recommendedWeightKg)
  const unknownLoad = work.recommendedWeightKg === null && !!work.reps
  if (ramp === RAMP_UP_SECONDS && unknownLoad && !!work.note?.includes(`over ${HEAVY_BUILD_UP_SETS} build-up sets`)) return HEAVY_BUILD_UP_SECONDS
  if (ramp === 0 && unknownLoad && role !== "finisher" && exercise?.loadType === "external") return FEEDER_SET_SECONDS
  return ramp
}

/**
 * Seconds for a block of work: per-set work (reps × seconds per rep, or the timed duration) +
 * rest between sets + transition + ramp-up or feeder sets for heavy lifts.
 */
export function estimateWorkSeconds(work: TimedWork, phase: WorkoutExercise["phase"], role: WorkoutExercise["role"], exercise: Exercise | undefined): number {
  const unilateral = exercise?.isUnilateral ? 2 : 1
  const tempo = work.tempo === undefined ? exercise?.tempo : work.tempo
  let perSet: number
  if (work.durationSeconds !== null) perSet = work.durationSeconds * unilateral
  else if (work.reps) perSet = ((work.reps[0] + work.reps[1]) / 2) * secondsPerRep(exercise, tempo) * unilateral
  else perSet = 30
  const sets = Math.max(1, work.sets)
  const rest = work.restSeconds * (sets - 1)
  const transition = phase === "main" ? TRANSITION_SECONDS : LIGHT_TRANSITION_SECONDS
  const ramp = phase === "main" ? lighterSetSeconds(work, role, exercise) : 0
  return perSet * sets + rest + transition + ramp
}

export function estimateSlotSeconds(slot: WorkoutExercise, exercise: Exercise | undefined): number {
  return estimateWorkSeconds(slot, slot.phase, slot.role, exercise)
}

export function estimateWorkoutSeconds(exercises: readonly WorkoutExercise[], lib: Library = DEFAULT_LIBRARY): number {
  let total = 0
  for (const slot of exercises) total += estimateSlotSeconds(slot, lib.get(slot.exerciseId))
  return total
}

export function estimateDurationMinutes(workout: Pick<Workout, "exercises">, lib: Library = DEFAULT_LIBRARY): number {
  return Math.max(1, Math.round(estimateWorkoutSeconds(workout.exercises, lib) / 60))
}

export interface FittableSlot {
  slot: WorkoutExercise
  exercise: Exercise
  minSets: number
  maxSets: number
  /** Rest floor the slot may be trimmed to (goal minimum). */
  minRest: number
  /** Rest ceiling the slot may grow to when there is spare time; never above `restCeiling` for the slot. */
  maxRest?: number
  priority: number
  /** Muscle group whose weekly budget extra sets draw on (absent: uncapped, e.g. finishers). */
  group?: string
}

const TRIM_ORDER: Record<WorkoutExercise["role"], number> = {
  finisher: 0,
  isolation: 1,
  accessory: 2,
  secondary_compound: 3,
  primary_compound: 4,
  warmup: 9,
  cooldown: 9,
}

/**
 * Conditioning goals keep their conditioning block: isolation, then accessory work give up time
 * first (coach round 2, R01). The block's rounds are protected by the caller's minSets.
 */
const CONDITIONING_TRIM_ORDER: Record<WorkoutExercise["role"], number> = {
  ...TRIM_ORDER,
  isolation: 0,
  accessory: 1,
  finisher: 2,
}

/** Isolation or unloaded work, which gives up a set or rest before a loaded compound in the same tier (R22). */
function lightWork(exercise: Exercise): boolean {
  return exercise.mechanics === "isolation" || (exercise.loadType !== "external" && exercise.loadType !== "assisted")
}

export interface FitOptions {
  /**
   * Seconds the caller will still add after fitting (a conditioning finisher not yet planned).
   * The too-short passes leave room for them instead of growing sets and rests into it.
   */
  reserveSeconds?: number
}

/**
 * Rest floor while trimming: the caller's floor, raised for jump primers and heavy strength and
 * hypertrophy compounds (at a load heavy enough to ramp from), which keep their recovery however
 * short the session.
 */
function trimRestFloor(f: FittableSlot, goal: Goal): number {
  return Math.max(f.minRest, protectedRestSeconds(f.exercise, goal, f.slot.role as MainRole, f.slot.recommendedWeightKg))
}

/** Longest rest a slot may grow to: the coach ceiling at its planned load, and the caller's own cap. */
function growRestCeiling(f: FittableSlot, goal: Goal): number {
  return Math.min(restCeiling(f.exercise, goal, f.slot.role as MainRole, f.slot.recommendedWeightKg), f.maxRest ?? Number.POSITIVE_INFINITY)
}

/** A loaded compound in the given slot whose rest is ordered against the other compound slot (jump primers and timed work are not). */
function restOrdered(f: FittableSlot, goal: Goal, role: "primary_compound" | "secondary_compound"): boolean {
  return f.slot.phase === "main" && f.slot.role === role && !isTimed(f.exercise) && !isPlyometricPrimer(f.exercise, goal, role)
}

/**
 * Coach review R20: the day's primary compound rests at least as long as its secondary (a 4 kg
 * incline press was resting 105 s while the goblet squat primary rested 85 s). The primary is
 * raised towards the secondary's rest within its own ceiling; a secondary still longer comes down
 * to the primary, never below its own floor. Mutates the slots.
 */
function orderCompoundRests(slots: readonly FittableSlot[], goal: Goal): void {
  const secondaries = slots.filter((f) => restOrdered(f, goal, "secondary_compound"))
  if (secondaries.length === 0) return
  for (const p of slots.filter((f) => restOrdered(f, goal, "primary_compound"))) {
    const longest = Math.max(...secondaries.map((s) => s.slot.restSeconds))
    if (p.slot.restSeconds >= longest) continue
    p.slot.restSeconds = Math.max(p.slot.restSeconds, Math.min(longest, growRestCeiling(p, goal)))
    for (const s of secondaries) {
      if (s.slot.restSeconds > p.slot.restSeconds) s.slot.restSeconds = Math.max(p.slot.restSeconds, trimRestFloor(s, goal))
    }
  }
}

/**
 * Scale set counts (and then rests) so the whole session fits the preference.
 * Mutates the slots in `main`. Returns the list of main slots to keep (lowest-priority
 * slots are dropped only as a last resort and never below 3).
 */
export function fitToDuration(
  main: FittableSlot[],
  fixedSeconds: number,
  preferenceMinutes: number,
  goal: Goal,
  /** Extra sets each group may still take (weekly cap); growth never exceeds it. Decremented in place. */
  groupRoom?: Map<string, number>,
  options: FitOptions = {},
): FittableSlot[] {
  const target = preferenceMinutes * 60
  const lower = Math.max(0, target * FIT_FLOOR - Math.max(0, options.reserveSeconds ?? 0))
  const kept = main.slice()
  const total = () => fixedSeconds + kept.reduce((sum, f) => sum + estimateSlotSeconds(f.slot, f.exercise), 0)
  // With tempo-aware estimates the preference is a budget: trim as soon as it is clearly exceeded,
  // in seconds and in the minutes the card shows (31.5 min would read "32 min" on a 30 min plan).
  const over = () => {
    const seconds = total()
    return seconds > target * FIT_CEILING || Math.round(seconds / 60) > preferenceMinutes * FIT_CEILING
  }
  // The primary's rest never drops below the secondary's while trimming, and the secondary's never
  // grows past the primary's while filling spare time (coach review R20).
  orderCompoundRests(kept, goal)
  const longestSecondaryRest = () =>
    Math.max(0, ...kept.filter((f) => restOrdered(f, goal, "secondary_compound")).map((f) => f.slot.restSeconds))
  const shortestPrimaryRest = () =>
    Math.min(Number.POSITIVE_INFINITY, ...kept.filter((f) => restOrdered(f, goal, "primary_compound")).map((f) => f.slot.restSeconds))
  const restFloor = (f: FittableSlot) =>
    restOrdered(f, goal, "primary_compound") ? Math.max(trimRestFloor(f, goal), longestSecondaryRest()) : trimRestFloor(f, goal)
  const ceilingFor = (f: FittableSlot) =>
    restOrdered(f, goal, "secondary_compound") ? Math.min(growRestCeiling(f, goal), shortestPrimaryRest()) : growRestCeiling(f, goal)

  // Within a tier, isolation or unloaded work gives up time before a loaded compound, then the
  // lower-priority slot (higher number), then the one with more sets or longer rest (R22).
  const trimOrder = GOAL_PRESCRIPTIONS[goal].conditioning ? CONDITIONING_TRIM_ORDER : TRIM_ORDER
  const tieBreak = (a: FittableSlot, b: FittableSlot) =>
    trimOrder[a.slot.role] - trimOrder[b.slot.role] || Number(lightWork(b.exercise)) - Number(lightWork(a.exercise)) || b.priority - a.priority

  // Too long: trim sets from the least important slots first, never below the floor.
  let guard = 0
  while (over() && guard++ < 64) {
    const candidates = kept.filter((f) => f.slot.sets > Math.max(f.slot.role === "finisher" ? 1 : 2, f.minSets))
    if (candidates.length === 0) break
    candidates.sort((a, b) => tieBreak(a, b) || b.slot.sets - a.slot.sets)
    const pick = candidates[0]
    if (!pick) break
    pick.slot.sets -= 1
  }
  // Still too long: shorten rests towards the goal floor in 15 s steps.
  guard = 0
  while (over() && guard++ < 64) {
    const candidates = kept.filter((f) => f.slot.phase === "main" && f.slot.restSeconds - 15 >= restFloor(f))
    if (candidates.length === 0) break
    candidates.sort((a, b) => tieBreak(a, b) || b.slot.restSeconds - a.slot.restSeconds)
    const pick = candidates[0]
    if (!pick) break
    pick.slot.restSeconds -= 15
  }
  // Still too long: drop the lowest-priority slots while keeping at least 3.
  guard = 0
  while (total() > target * DROP_CEILING && kept.length > 3 && guard++ < 16) {
    let worst = kept[0]
    for (const f of kept) if (worst && f.priority > worst.priority) worst = f
    if (!worst) break
    kept.splice(kept.indexOf(worst), 1)
  }
  // Too short: add sets to the big lifts first (finisher last), within their allowed maximum
  // and the group's remaining weekly room.
  // Consumed in place, so a second fitting pass over the same plan cannot spend the room twice.
  const room = groupRoom ?? new Map<string, number>()
  const hasRoom = (f: FittableSlot) => f.group === undefined || !room.has(f.group) || (room.get(f.group) ?? 0) > 0
  guard = 0
  while (total() < lower && guard++ < 64) {
    const candidates = kept.filter((f) => f.slot.sets < f.maxSets && hasRoom(f))
    if (candidates.length === 0) break
    candidates.sort((a, b) => TRIM_ORDER[b.slot.role] - TRIM_ORDER[a.slot.role] || a.slot.sets - b.slot.sets)
    const pick = candidates[0]
    if (!pick) break
    pick.slot.sets += 1
    if (pick.group !== undefined && room.has(pick.group)) room.set(pick.group, (room.get(pick.group) ?? 0) - 1)
  }
  // Still short: lengthen rests up to the slot's ceiling (the goal maximum for compounds, near the
  // exercise's own range for everything else), biggest lifts first.
  guard = 0
  while (total() < lower && guard++ < 64) {
    const candidates = kept.filter((f) => f.slot.role !== "finisher" && f.slot.restSeconds + 15 <= ceilingFor(f))
    if (candidates.length === 0) break
    candidates.sort((a, b) => TRIM_ORDER[b.slot.role] - TRIM_ORDER[a.slot.role] || a.slot.restSeconds - b.slot.restSeconds)
    const pick = candidates[0]
    if (!pick) break
    pick.slot.restSeconds += 15
  }
  return kept
}
