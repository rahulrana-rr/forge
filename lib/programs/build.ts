/**
 * Turns an assigned program into today's Workout, so every FORGE feature (cards, demos, set
 * logging, rest timer, history, progress, sync, swaps, undo) works on it unchanged. Pure apart
 * from ids (lib/ids.ts), like the engine: the clock comes in through EngineInput.now.
 *
 * Loads reuse the engine's progression: an external-load lift shows the load its logged history
 * earns (or a starting estimate the first time), at the RIR the program sets for the week.
 * Bodyweight, assisted, timed, distance and explosive work carries no load.
 */
import { daysBetween, parseDateKey } from "@/lib/dates"
import { getExercise } from "@/lib/exercises"
import type { Exercise } from "@/lib/exercises/types"
import { newId } from "@/lib/ids"
import { replaceExercise, replacementCandidates } from "@/lib/engine"
import { estimateDurationMinutes } from "@/lib/engine/duration"
import { lastPerformance, planLoad } from "@/lib/engine/progression"
import { hashString } from "@/lib/engine/random"
import { composeSlotNote } from "@/lib/engine/slot-notes"
import {
  ENGINE_VERSION,
  type EngineInput,
  type ReplaceOptions,
  type ReplacementCandidate,
  type Workout,
  type WorkoutExercise,
} from "@/lib/engine/types"
import { getProgram } from "./index"
import type {
  ProgramAssignment,
  ProgramDay,
  ProgramDefinition,
  ProgramDose,
  ProgramItem,
  ProgramWeek,
  Weekday,
} from "./types"

/* ---------------------------------------------------------------------------------------------- */
/* Calendar                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

/** Weeks since the start (1 = the start date's week), or null before the start date. */
export function calendarWeek(startDate: string, date: string): number | null {
  const days = daysBetween(startDate, date)
  return days < 0 ? null : Math.floor(days / 7) + 1
}

/**
 * The program week a date falls in: floor(days since start / 7) + 1. After the last week the
 * program repeats from `repeatFromWeek`, so a new block starts without a second re-entry
 * (7 weeks repeating from week 3: weeks 8-12 are weeks 3-7, week 13 is week 3 again).
 * null before the start date.
 */
export function programWeek(
  startDate: string,
  date: string,
  shape: Pick<ProgramDefinition, "weeks" | "repeatFromWeek"> = { weeks: 7, repeatFromWeek: 3 },
): number | null {
  const week = calendarWeek(startDate, date)
  if (week === null) return null
  if (week <= shape.weeks) return week
  const cycle = shape.weeks - shape.repeatFromWeek + 1
  return shape.repeatFromWeek + ((week - shape.weeks - 1) % cycle)
}

/** The program day scheduled on a date, with its week; null before the start or on an unscheduled day. */
export function programDayFor(
  program: ProgramDefinition,
  assignment: ProgramAssignment,
  date: string,
): { dayKey: string; day: ProgramDay; week: ProgramWeek } | null {
  const week = programWeek(assignment.startDate, date, program)
  if (week === null) return null
  const dayKey = program.schedule[parseDateKey(date).getDay() as Weekday]
  const day = dayKey ? program.days[dayKey] : undefined
  if (!dayKey || !day) return null
  return { dayKey, day, week: week as ProgramWeek }
}

/** Identifies the program plan a date gets from an assignment, or null when the engine plans it. */
export function programPlanKey(assignment: ProgramAssignment | null, date: string): string | null {
  const program = assignment ? getProgram(assignment.programId) : undefined
  if (!assignment || !program || !programDayFor(program, assignment, date)) return null
  return `${program.id}|${assignment.startDate}`
}

/** The same key read from a workout (Workout.program), or null for an engine workout. */
export function workoutPlanKey(workout: Pick<Workout, "program">): string | null {
  return workout.program ? `${workout.program.id}|${workout.program.startDate}` : null
}

/* ---------------------------------------------------------------------------------------------- */
/* Items                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

/** Whether an item is programmed in a week (fromWeek / untilWeek, inclusive). */
export function itemInWeek(item: ProgramItem, week: ProgramWeek): boolean {
  return (item.fromWeek ?? 1) <= week && week <= (item.untilWeek ?? Number.POSITIVE_INFINITY)
}

/**
 * The item's dose for a week and step: base, then the step's changes, then the item's week
 * changes, then (for a step other than the item's own exercise) the step's week changes.
 */
export function doseFor(item: ProgramItem, week: ProgramWeek, exerciseId: string = item.exerciseId): ProgramDose {
  const step = item.steps?.find((s) => s.exerciseId === exerciseId)
  const base: ProgramDose = {
    sets: item.sets,
    reps: item.reps,
    durationSeconds: item.durationSeconds,
    restSeconds: item.restSeconds,
    rir: item.rir,
    note: item.note,
  }
  const stepWeek = exerciseId !== item.exerciseId ? step?.byWeek?.[week] : undefined
  return { ...base, ...step?.dose, ...item.byWeek?.[week], ...stepWeek }
}

/** When an exercise was last completed (epoch ms), from history and progress; 0 when never. */
function lastDoneMs(exerciseId: string, input: Pick<EngineInput, "history" | "progress">): number {
  let latest = 0
  const performed = input.progress[exerciseId]?.lastPerformedAt
  const ms = performed ? Date.parse(performed) : Number.NaN
  if (Number.isFinite(ms)) latest = ms
  for (const workout of input.history) {
    if (!workout.exercises.some((e) => e.exerciseId === exerciseId && e.status === "completed")) continue
    const done = Date.parse(workout.completedAt)
    if (Number.isFinite(done) && done > latest) latest = done
  }
  return latest
}

/**
 * The step a gated item starts on: the step the user completed most recently (a left swipe to the
 * next step, logged, sticks; backing off sticks too), else the first. Items without steps use
 * their own exercise.
 */
export function currentStep(item: ProgramItem, input: Pick<EngineInput, "history" | "progress">): string {
  if (!item.steps || item.steps.length === 0) return item.exerciseId
  let best = item.steps[0].exerciseId
  let bestMs = 0
  for (const step of item.steps) {
    const ms = lastDoneMs(step.exerciseId, input)
    if (ms > bestMs) {
      best = step.exerciseId
      bestMs = ms
    }
  }
  return best
}

/** Whether a card loads from history / a starting estimate (ProgramItem.planLoad). */
function plansLoad(item: Pick<ProgramItem, "planLoad">, exercise: Exercise): boolean {
  if (item.planLoad === false) return false
  return exercise.loadType === "external" && !exercise.tags?.includes("explosive")
}

/** The card for one exercise at a dose: the program's prescription plus the engine's load. */
function slotFor(
  item: ProgramItem,
  exercise: Exercise,
  dose: ProgramDose,
  input: EngineInput,
  base: Pick<WorkoutExercise, "slotId" | "replacedFromExerciseId">,
): WorkoutExercise {
  const slot: WorkoutExercise = {
    slotId: base.slotId,
    exerciseId: exercise.id,
    phase: item.phase,
    role: item.role,
    sets: Math.max(1, dose.sets),
    reps: dose.reps,
    durationSeconds: dose.reps ? null : dose.durationSeconds,
    restSeconds: dose.restSeconds,
    tempo: item.tempo ?? exercise.tempo ?? null,
    rir: dose.rir,
    recommendedWeightKg: null,
    weightSource: null,
    note: dose.note,
    replacedFromExerciseId: base.replacedFromExerciseId,
  }
  if (item.phase !== "main" || !plansLoad(item, exercise)) return slot
  const last = lastPerformance(exercise.id, input.history, input.progress)
  const load = planLoad(exercise, dose.reps, last, input.profile, { rir: dose.rir })
  slot.recommendedWeightKg = load.weightKg
  slot.weightSource = load.weightKg != null ? load.weightSource : null
  // The program's note leads; a ramp-up instruction or a load to calibrate or check follows it.
  slot.note = composeSlotNote({ role: item.role, exercise, weightKg: load.weightKg, load, lead: dose.note })
  if (load.loadCheck && load.weightKg != null) slot.loadCheck = true
  return slot
}

/** The minutes band for a week (the last band at or before it); null when the day has none. */
function minutesFor(day: ProgramDay, week: ProgramWeek): number | null {
  let minutes: number | null = null
  for (const band of day.estimatedMinutes ?? []) if (band.fromWeek <= week) minutes = band.minutes
  return minutes
}

/* ---------------------------------------------------------------------------------------------- */
/* Workouts                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Today's workout from an assigned program: the scheduled day at the date's program week, as a
 * normal Workout. null when the program is unknown, the date is before the start, or nothing is
 * scheduled (the engine then plans the day). A rest day is a workout with one optional easy-walk
 * card. Library exercises only; ids from lib/ids.ts.
 */
export function buildProgramWorkout(program: ProgramDefinition, assignment: ProgramAssignment, input: EngineInput): Workout | null {
  const planned = programDayFor(program, assignment, input.date)
  if (!planned) return null
  const { dayKey, day, week } = planned
  const exercises: WorkoutExercise[] = []
  for (const item of day.items) {
    if (!itemInWeek(item, week)) continue
    const exerciseId = currentStep(item, input)
    const exercise = getExercise(exerciseId)
    if (!exercise) continue
    exercises.push(slotFor(item, exercise, doseFor(item, week, exerciseId), input, { slotId: newId(), replacedFromExerciseId: null }))
  }
  const blockRule = program.weekRules[week] ?? null
  const absolute = calendarWeek(assignment.startDate, input.date) ?? week
  // Block 2 starts after the last week and repeats from repeatFromWeek (no second re-entry).
  const block = absolute > program.weeks ? Math.floor((absolute - program.weeks - 1) / (program.weeks - program.repeatFromWeek + 1)) + 2 : 1
  const notes = [
    ...(blockRule ? [blockRule] : []),
    ...(block > 1 ? [`Block ${block}: the program repeats from week ${program.repeatFromWeek}.`] : []),
    ...(absolute === week ? (program.weekNotes?.[week] ?? []) : []),
  ]
  const workout: Workout = {
    id: newId(),
    date: input.date,
    title: block > 1 ? `${day.title} · Block ${block}, week ${week}` : `${day.title} · Week ${week} of ${program.weeks}`,
    split: day.split,
    focus: day.focus,
    goal: program.goal,
    estimatedMinutes: 0,
    exercises,
    generatedAt: input.now,
    seed: (input.seed ?? hashString(`${program.id}|${input.date}`)) >>> 0,
    engineVersion: ENGINE_VERSION,
    notes,
    program: {
      id: program.id,
      title: program.title,
      dayKey,
      week,
      weeks: program.weeks,
      startDate: assignment.startDate,
      blockRule,
    },
  }
  workout.estimatedMinutes = minutesFor(day, week) ?? estimateDurationMinutes(workout)
  return workout
}

/** buildProgramWorkout for an assignment that may be absent or name an unknown program. */
export function programWorkoutFor(assignment: ProgramAssignment | null, input: EngineInput): Workout | null {
  const program = assignment ? getProgram(assignment.programId) : undefined
  return assignment && program ? buildProgramWorkout(program, assignment, input) : null
}

/* ---------------------------------------------------------------------------------------------- */
/* Swaps                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

/** The program item a slot of a program workout came from (matched by its original exercise). */
export function programItemFor(workout: Workout, slot: WorkoutExercise): ProgramItem | null {
  const info = workout.program
  const day = info ? getProgram(info.id)?.days[info.dayKey] : undefined
  if (!info || !day) return null
  const week = info.week as ProgramWeek
  const ids = new Set([slot.replacedFromExerciseId, slot.exerciseId].filter((id): id is string => !!id))
  const matches = (item: ProgramItem) => ids.has(item.exerciseId) || !!item.steps?.some((s) => ids.has(s.exerciseId))
  return day.items.find((item) => item.phase === slot.phase && itemInWeek(item, week) && matches(item)) ?? null
}

/**
 * Where a left swipe goes, best first: the item's later steps (the next step up), the item's own
 * alternatives, then the current exercise's library alternatives. Never the current exercise, an excluded or already
 * tried one, or one already elsewhere in the workout.
 */
export function programSwapOptions(workout: Workout, slotId: string, exclude: Iterable<string> = []): string[] {
  const slot = workout.exercises.find((e) => e.slotId === slotId)
  const current = slot ? getExercise(slot.exerciseId) : undefined
  if (!slot || !current) return []
  const item = programItemFor(workout, slot)
  const steps = item?.steps?.map((s) => s.exerciseId) ?? []
  const at = steps.indexOf(slot.exerciseId)
  const nextSteps = at >= 0 ? steps.slice(at + 1) : steps
  const skip = new Set([...exclude, slot.exerciseId])
  for (const e of workout.exercises) if (e.slotId !== slotId) skip.add(e.exerciseId)
  const out: string[] = []
  for (const id of [...nextSteps, ...(item?.alternatives ?? []), ...current.alternativeExercises]) {
    if (skip.has(id) || out.includes(id) || !getExercise(id)) continue
    out.push(id)
  }
  return out
}

/** A slot's shape: rep work or timed / distance work. */
function repWork(exercise: Exercise): boolean {
  return exercise.loadType === "external" || exercise.loadType === "bodyweight" || exercise.loadType === "assisted"
}

/**
 * The slot rebuilt for another exercise at the program's dose: a step's own dose; any other
 * exercise of the same shape (reps or time) keeps the card's sets, reps, rest and RIR (no note); a
 * different shape keeps the sets and rest and takes the exercise's own default reps or time.
 */
function reslot(workout: Workout, slot: WorkoutExercise, next: Exercise, input: EngineInput): WorkoutExercise {
  const item = programItemFor(workout, slot)
  const week = (workout.program?.week ?? 1) as ProgramWeek
  const replacedFrom = slot.replacedFromExerciseId ?? slot.exerciseId
  const base = { slotId: slot.slotId, replacedFromExerciseId: replacedFrom === next.id ? null : replacedFrom }
  const asItem: ProgramItem = item ?? {
    exerciseId: slot.exerciseId,
    phase: slot.phase,
    role: slot.role,
    sets: slot.sets,
    reps: slot.reps,
    durationSeconds: slot.durationSeconds,
    restSeconds: slot.restSeconds,
    rir: slot.rir,
    note: slot.note,
  }
  const isStep = !!asItem.steps?.some((s) => s.exerciseId === next.id) || asItem.exerciseId === next.id
  const current: ProgramDose = isStep
    ? doseFor(asItem, week, next.id)
    : // A substitute keeps the dose, not the item's note: that names the item's own steps and cues.
      { sets: slot.sets, reps: slot.reps, durationSeconds: slot.durationSeconds, restSeconds: slot.restSeconds, rir: slot.rir, note: null }
  const sameShape = (current.reps !== null) === repWork(next)
  const dose: ProgramDose = sameShape
    ? current
    : {
        sets: current.sets,
        reps: repWork(next) ? (next.repRange ?? [8, 12]) : null,
        durationSeconds: repWork(next) ? null : (next.durationRange?.[0] ?? 30),
        restSeconds: current.restSeconds,
        rir: null,
        note: null,
      }
  return slotFor({ ...asItem, tempo: null }, next, dose, input, base)
}

/**
 * replaceExercise for a program workout. A left swipe (no `withExerciseId`) moves to the next
 * programSwapOptions entry, falling back to the engine's pick; a manual pick takes the chosen
 * exercise. Either way the card keeps the program's dose (see reslot). null when nothing fits.
 */
export function replaceProgramExercise(workout: Workout, slotId: string, input: EngineInput, options: ReplaceOptions = {}): Workout | null {
  const slot = workout.exercises.find((e) => e.slotId === slotId)
  if (!slot) return null
  let nextId: string | undefined = options.withExerciseId ?? programSwapOptions(workout, slotId, options.exclude)[0]
  if (!nextId) nextId = replaceExercise(workout, slotId, input, options)?.exercises.find((e) => e.slotId === slotId)?.exerciseId
  const next = nextId ? getExercise(nextId) : undefined
  if (!next || next.id === slot.exerciseId) return null
  if (workout.exercises.some((e) => e.slotId !== slotId && e.exerciseId === next.id)) return null
  const rebuilt = reslot(workout, slot, next, input)
  return { ...workout, exercises: workout.exercises.map((e) => (e.slotId === slotId ? rebuilt : e)) }
}

/** The manual picker's list for a program card: the program's own options first, then the engine's. */
export function programReplacementCandidates(workout: Workout, slotId: string, input: EngineInput, limit = 8): ReplacementCandidate[] {
  const slot = workout.exercises.find((e) => e.slotId === slotId)
  if (!slot) return []
  const item = programItemFor(workout, slot)
  const steps = new Set(item?.steps?.map((s) => s.exerciseId) ?? [])
  const own = programSwapOptions(workout, slotId).map((exerciseId, i) => ({
    exerciseId,
    score: 100 - i,
    reason: steps.has(exerciseId) ? "A step in your program" : "Program alternative",
  }))
  const seen = new Set(own.map((c) => c.exerciseId))
  const engine = replacementCandidates(workout, slotId, input, limit).filter((c) => !seen.has(c.exerciseId))
  return [...own, ...engine].slice(0, Math.max(0, limit))
}
