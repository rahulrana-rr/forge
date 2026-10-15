/**
 * Swap one slot for a comparable exercise, keeping the slot id and prescription shape.
 */
import { muscleGroupOf, muscleGroupsOf } from "@/lib/exercises"
import { DEFAULT_LIBRARY, generationPool, isProgramOnly, type Library } from "./library"
import {
  DIFFICULTY_RANK,
  MOVEMENT_PATTERN_LABELS,
  MUSCLE_GROUP_LABELS,
  type Exercise,
  type Mechanics,
  type MovementPattern,
  type MuscleGroup,
} from "@/lib/exercises/types"
import type { EngineInput, ReplaceOptions, ReplacementCandidate, Workout, WorkoutExercise } from "./types"
import { createRng, defaultSeed, hashString } from "./random"
import {
  fitsFinisher,
  goalCompatible,
  inferSlotKind,
  isConditioning,
  isMainCategory,
  isRedundantWith,
  mainSlotAllows,
  matchesSlot,
  passesProfileFilter,
  slotSpecFor,
  type MatchLevel,
} from "./selection"
import {
  applyShortCoreDose,
  finisherBudgetSeconds,
  prescribe,
  prescribeFinisher,
  prescribeRir,
  SHORT_SESSION_MINUTES,
  type MainRole,
  type Prescription,
} from "./prescriptions"
import { lastPerformance, planLoad } from "./progression"
import { isDynamicDrill, isLightCardio, forGroups, prescribeWarmupItem } from "./warmup"
import { isBreathing, isStretch, prescribeCooldownItem } from "./cooldown"
import { estimateDurationMinutes } from "./duration"
import { cappedGroupsOf, computeRecovery, coreWeeklyCap, weeklyCap, weeklySoftCeiling, WEEKLY_SOFT_CEILING_FACTOR } from "./recovery"
import { composeSlotNote } from "./slot-notes"
import type { SlotSpec } from "./splits"

/**
 * What a stand-in slot was planned to train. Generation records it on a slot it had to fill
 * through secondary muscles, so a swap can bring the planned lift back (WorkoutExercise.intendedSlot).
 */
export interface IntendedSlot {
  patterns: MovementPattern[]
  groups: MuscleGroup[]
  mechanics?: Mechanics
  /** The template role the slot had before the stand-in demoted it. */
  role?: MainRole
}

export function intendedSlotOf(slot: WorkoutExercise): IntendedSlot | null {
  if (slot.phase !== "main" || slot.role === "finisher") return null
  return slot.intendedSlot ?? null
}

function intendedSpec(slot: WorkoutExercise): SlotSpec | null {
  const intended = intendedSlotOf(slot)
  if (!intended || intended.patterns.length === 0 || intended.groups.length === 0) return null
  return {
    key: "intended",
    role: intended.role ?? (slot.role as MainRole),
    patterns: intended.patterns,
    groups: intended.groups,
    mechanics: intended.mechanics,
    priority: 0,
    kind: inferSlotKind(intended.patterns, intended.groups),
  }
}

/** The planned slot's own match levels: never a secondary-muscle stand-in. */
const INTENDED_LEVELS: readonly MatchLevel[] = [0, 1, 2]

function fitsIntended(candidate: Exercise, spec: SlotSpec | null): boolean {
  return !!spec && INTENDED_LEVELS.some((level) => matchesSlot(candidate, spec, level))
}

function samePhaseClass(current: Exercise, candidate: Exercise, phase: WorkoutExercise["phase"]): boolean {
  if (phase === "main") return isMainCategory(candidate)
  if (phase === "warmup") return isLightCardio(current) ? isLightCardio(candidate) : isDynamicDrill(candidate)
  return isBreathing(current) ? isBreathing(candidate) : isStretch(candidate)
}

/**
 * A main-slot swap keeps the slot's job, judged from the current exercise as generation judges a
 * template slot: never across the push/pull line or the body, no conditioning or stretching, and
 * trunk work only for trunk work. An isometric hold is not swapped for ballistic or heavy barbell
 * work.
 */
function keepsSlotJob(current: Exercise, candidate: Exercise, role: MainRole): boolean {
  if (!mainSlotAllows(candidate, slotSpecFor(current, role))) return false
  if ((candidate.category === "core") !== (current.category === "core")) return false
  if (current.loadType === "timed" && (candidate.warmupRequired || !!candidate.tags?.some((t) => t === "explosive" || t === "olympic"))) {
    return false
  }
  return true
}

/** Steady-state cardio (bike, rower, brisk walk): the main block of a steady conditioning day. */
function isSteadyCardio(exercise: Exercise): boolean {
  return exercise.category === "cardio" && !!exercise.tags?.includes("steady_state") && !!exercise.durationRange
}

/** A conditioning-led day's steady block, which keeps its steady kind and its duration on a swap. */
function steadySwapSlot(workout: Workout, current: Exercise): boolean {
  return workout.split === "conditioning" && isSteadyCardio(current)
}

/** Hard filter a replacement must pass: profile rules, same phase class, not already in the workout. */
export function validReplacement(
  workout: Workout,
  slot: WorkoutExercise,
  current: Exercise,
  candidate: Exercise,
  input: EngineInput,
  exclude: ReadonlySet<string>,
  lib: Library = DEFAULT_LIBRARY,
): boolean {
  if (candidate.id === current.id) return false
  // Assigned-program steps are offered only inside a program workout (lib/exercises/types.ts).
  if (!workout.program && isProgramOnly(candidate)) return false
  if (!passesProfileFilter(candidate, input.profile)) return false
  if (!samePhaseClass(current, candidate, slot.phase)) return false
  if (exclude.has(candidate.id)) return false
  if (workout.exercises.some((e) => e.exerciseId === candidate.id)) return false
  if (slot.phase === "main" && slot.role !== "finisher" && candidate.category === "cardio") return false
  // A finisher is swapped only for what generation would put there: conditioning work, not a
  // heavy barbell lift and not a 20-minute walk. On a conditioning-led day the steady-state block
  // is the day's main work (generate.ts steadyPlan): it swaps for other steady cardio (coach round
  // 2, R17).
  if (slot.phase === "main" && slot.role === "finisher") {
    const steadyBlock = steadySwapSlot(workout, current)
    if (steadyBlock ? !isSteadyCardio(candidate) || !goalCompatible(candidate, input.profile.goal) : !fitsFinisher(candidate)) return false
  }
  if (slot.phase === "main" && slot.role !== "finisher") {
    // The planned lift of a stand-in slot is always a valid way back, even across groups.
    if (!fitsIntended(candidate, intendedSpec(slot)) && !keepsSlotJob(current, candidate, slot.role as MainRole)) return false
    // Generation never puts two members of one variation family in a session; neither does a swap.
    const others = workout.exercises.filter((e) => e.phase === "main" && e.role !== "finisher" && e.slotId !== slot.slotId)
    for (const e of others) {
      const other = lib.get(e.exerciseId)
      if (other && isRedundantWith(candidate, other, lib.get)) return false
    }
  }
  return true
}

interface Scored {
  exercise: Exercise
  score: number
  reasons: string[]
  /** Same muscle group and the same movement (or a listed alternative): the closest swaps. */
  close: boolean
  /** Restores the planned lift of a stand-in slot. */
  intended: boolean
  /** Matches the current exercise itself (group, pattern or listed alternative), not only the plan. */
  ownMatch: boolean
  /** Restores the planned lift although its group is over this week's volume target. */
  overCap: boolean
}

/** The implement that defines where an exercise happens: a rack, a dumbbell rack, a cable stack… */
const IMPLEMENT_ORDER = [
  "barbell",
  "trap_bar",
  "ez_bar",
  "smith_machine",
  "machine",
  "cable",
  "landmine",
  "dumbbell",
  "kettlebell",
  "band",
  "suspension",
  "pull_up_bar",
  "dip_station",
] as const

function mainImplement(exercise: Exercise): string {
  return IMPLEMENT_ORDER.find((e) => exercise.equipment.includes(e)) ?? "bodyweight"
}

/** Abduction or adduction drill offered for a slot whose exercise is neither. */
function sideMovementMismatch(current: Exercise, candidate: Exercise): boolean {
  return (["abduction", "adduction"] as const).some((t) => !!candidate.tags?.includes(t) && !current.tags?.includes(t))
}

function scoreReplacement(
  current: Exercise,
  candidate: Exercise,
  slot: WorkoutExercise,
  input: EngineInput,
  jitter: number,
  intended: SlotSpec | null,
  overCap: (candidate: Exercise) => boolean,
): Scored | null {
  const reasons: string[] = []
  let score = 0
  const currentGroup = muscleGroupOf(current)
  const candidateGroups = muscleGroupsOf(candidate)
  const sharesPrimary = muscleGroupOf(candidate) === currentGroup
  const sharesAny = candidateGroups.includes(currentGroup) || muscleGroupsOf(current).includes(muscleGroupOf(candidate))
  // Clamshells and lateral walks are labelled hip extension, but they are not what a hip thrust
  // or a glute bridge slot is for.
  const samePattern = candidate.movementPattern === current.movementPattern && !sideMovementMismatch(current, candidate)
  const altIndex = current.alternativeExercises.indexOf(candidate.id)
  const listed = altIndex >= 0
  const forIntent = slot.phase === "main" && fitsIntended(candidate, intended)
  const capped = forIntent && overCap(candidate)

  if (slot.phase === "main") {
    if (forIntent) {
      const pattern = intended?.patterns.map((p) => MOVEMENT_PATTERN_LABELS[p].toLowerCase()).join(" or ") ?? ""
      reasons.push(`Planned ${pattern} for this slot${capped ? " (over this week's volume target)" : ""}`)
    }
    if (sharesPrimary) {
      score += 40
      reasons.push(`Same muscle group (${MUSCLE_GROUP_LABELS[currentGroup].toLowerCase()})`)
    } else if (sharesAny) {
      score += 15
      reasons.push(`Also trains ${MUSCLE_GROUP_LABELS[currentGroup].toLowerCase()}`)
    }
    if (samePattern) {
      score += 20
      reasons.push("Same movement pattern")
    }
    // A shared secondary muscle alone is not a swap: a row is not offered for a press because both
    // touch the rear delts, nor a deadlift for a plank because both brace the trunk. Finishers are
    // matched by fitsFinisher instead.
    if (!sharesPrimary && !samePattern && !listed && !forIntent && slot.role !== "finisher") return null
    if (candidate.mechanics === current.mechanics) score += 8
    if (candidate.loadType === current.loadType) score += 3
    // Alternatives are listed best first, so the order carries the coach's preference.
    if (listed) {
      score += Math.max(6, 18 - altIndex * 4)
      reasons.push("Listed alternative")
    }
    if (candidate.variationOf === current.id || current.variationOf === candidate.id) score += 2
    // A swipe left often means the kit is taken: a different implement is the more useful swap,
    // as long as it still trains the same muscle group.
    if (sharesPrimary && mainImplement(candidate) !== mainImplement(current)) {
      score += 6
      reasons.push("Different equipment")
    }
  } else {
    const wanted = forGroups(current)
    const overlap = forGroups(candidate).filter((g) => wanted.includes(g)).length
    score += overlap * 10
    if (overlap > 0) reasons.push("Same focus")
    if (samePattern) score += 5
  }

  const diffGap = Math.abs(DIFFICULTY_RANK[candidate.difficulty] - DIFFICULTY_RANK[current.difficulty])
  score += 5 - diffGap * 3
  if (input.profile.preferredExerciseIds.includes(candidate.id)) {
    score += 10
    reasons.push("One of your favourites")
  }
  if (goalCompatible(candidate, input.profile.goal)) score += 5
  score += jitter
  if (reasons.length === 0) reasons.push("Fits your equipment and level")
  const close = sharesPrimary && (samePattern || listed)
  const ownMatch = slot.phase !== "main" || slot.role === "finisher" || sharesPrimary || samePattern || listed
  return { exercise: candidate, score, reasons, close, intended: forIntent, ownMatch, overCap: capped }
}

/** Sets that keep a group worth programming under its weekly cap (generate.ts MIN_CAPPED_SETS). */
const MIN_ROOM_SETS = 2

/**
 * Whether a lift would take its group past this week's volume: the weekly cap against the plan's
 * other sessions, or the soft ceiling against the last 7 days, counting the sets the rest of
 * today's workout already holds (generate.ts weeklyRemaining).
 */
function overCapCheck(workout: Workout, slot: WorkoutExercise, input: EngineInput, lib: Library): (candidate: Exercise) => boolean {
  let recovery: ReturnType<typeof computeRecovery> | null = null
  const { profile } = input
  const cap = weeklyCap(profile.experience)
  const ceiling = weeklySoftCeiling(profile.experience)
  return (candidate) => {
    recovery ??= computeRecovery(input.history, input.date, lib, Math.max(1, profile.trainingDaysPerWeek - 1))
    const groups = cappedGroupsOf(candidate, muscleGroupOf(candidate)).filter((g) => g !== "cardio" && g !== "full_body")
    return groups.some((g) => {
      let planned = 0
      for (const e of workout.exercises) {
        if (e.phase !== "main" || e.role === "finisher" || e.slotId === slot.slotId) continue
        const ex = lib.get(e.exerciseId)
        if (ex && cappedGroupsOf(ex, muscleGroupOf(ex)).includes(g)) planned += e.sets
      }
      const r = recovery?.[g]
      if (!r) return false
      // Core spec C04: the trunk has its own weekly cap (generate.ts weeklyRemaining).
      const groupCap = g === "core" ? coreWeeklyCap(profile.goal, profile.experience) : cap
      const groupCeiling = g === "core" ? Math.round(groupCap * WEEKLY_SOFT_CEILING_FACTOR) : ceiling
      return Math.min(groupCap - r.setsBudget - planned, groupCeiling - r.setsLast7 - planned) < MIN_ROOM_SETS
    })
  }
}

/** How many planned-slot lifts lead a stand-in's list, leaving room for the stand-in's own swaps. */
const MAX_INTENDED_FIRST = 3

function rankReplacements(
  workout: Workout,
  slot: WorkoutExercise,
  current: Exercise,
  input: EngineInput,
  lib: Library,
  exclude: ReadonlySet<string>,
): Scored[] {
  const rng = createRng(hashString(`${slot.slotId}|${input.seed ?? defaultSeed(input.profile.id, input.date)}`))
  const intended = intendedSpec(slot)
  const overCap = overCapCheck(workout, slot, input, lib)
  const scored: Scored[] = []
  for (const candidate of lib.all) {
    if (!validReplacement(workout, slot, current, candidate, input, exclude, lib)) continue
    const result = scoreReplacement(current, candidate, slot, input, rng.next() * 3, intended, overCap)
    if (result) scored.push(result)
  }
  const byScore = (a: Scored, b: Scored) => b.score - a.score || a.exercise.id.localeCompare(b.exercise.id)
  // A stand-in's list opens with the best few lifts the slot was planned for, so the user (and the
  // coach) can bring the planned lift back knowingly. The rest of the planned-slot lifts are kept
  // only when they are also close to the stand-in itself.
  const leading = new Set(scored.filter((s) => s.intended).sort(byScore).slice(0, MAX_INTENDED_FIRST))
  const role = slot.role as MainRole
  const rest = scored.filter((s) => !leading.has(s) && (!s.intended || (s.ownMatch && keepsSlotJob(current, s.exercise, role))))
  // A swap keeps the slot's job. Candidates are ranked in tiers, so the first pick is always the
  // closest match: the same group through the same movement or a listed alternative (bench press →
  // dumbbell bench press), then other same-group compounds for a compound slot, never a cable fly
  // while a chest compound is left. Candidates that only share a secondary muscle are not listed.
  const tier = (s: Scored): number => {
    if (slot.phase !== "main" || slot.role === "finisher") return 0
    const compoundSlot = slot.role === "primary_compound" || slot.role === "secondary_compound"
    const sameGroup = muscleGroupOf(s.exercise) === muscleGroupOf(current)
    const sameMechanics = !compoundSlot || s.exercise.mechanics === "compound"
    if (sameGroup) return sameMechanics ? (s.close ? 0 : 1) : 2
    return sameMechanics ? 3 : 4
  }
  const ranked = rest
    .map((s) => ({ s, t: tier(s) }))
    .sort((a, b) => a.t - b.t || byScore(a.s, b.s))
    .map(({ s }) => s)
  return [...[...leading].sort(byScore), ...ranked]
}

export function replacementCandidates(
  workout: Workout,
  slotId: string,
  input: EngineInput,
  limit = 8,
  lib: Library = DEFAULT_LIBRARY,
): ReplacementCandidate[] {
  const slot = workout.exercises.find((e) => e.slotId === slotId)
  if (!slot) return []
  const current = lib.get(slot.exerciseId)
  if (!current) return []
  return rankReplacements(workout, slot, current, input, lib, new Set())
    .slice(0, Math.max(0, limit))
    .map((s) => {
      const candidate: ReplacementCandidate = { exerciseId: s.exercise.id, score: Math.round(s.score * 10) / 10, reason: s.reasons.join(" · ") }
      if (s.overCap) candidate.overCap = true
      return candidate
    })
}

/** generate.ts's rest-day session note: a swap keeps the reduced dose. */
const REST_DAY_NOTE = /^Rest day recommended/
/** Reps in reserve are never prescribed above this (generate.ts MAX_RIR). */
const MAX_RIR = 4

function rebuildSlot(
  workout: Workout,
  slot: WorkoutExercise,
  previous: Exercise,
  next: Exercise,
  input: EngineInput,
  lib: Library,
): WorkoutExercise {
  const { profile } = input
  // Bringing back the lift a stand-in replaced restores the slot's planned role (a squat back in
  // the primary slot is programmed and ramped as the primary), and the slot is no longer a stand-in.
  const intended = intendedSlotOf(slot)
  const restores = !!intended && fitsIntended(next, intendedSpec(slot))
  const role: WorkoutExercise["role"] = restores && intended?.role ? intended.role : slot.role
  const main = slot.phase === "main"
  const work = main && role !== "finisher"
  // A session generated as a rest-day session keeps its reduced dose: minimum sets, one more rep in reserve.
  const restDay = (workout.notes ?? []).some((n) => REST_DAY_NOTE.test(n))
  const last = main ? lastPerformance(next.id, input.history, input.progress) : null
  let rx: Prescription
  if (role === "finisher" && steadySwapSlot(workout, previous) && next.durationRange && slot.durationSeconds !== null) {
    // A steady block keeps the minutes generation sized it to, within the new exercise's range.
    const base = prescribeFinisher(next, profile.goal, profile.experience, slot.durationSeconds)
    const [lo, hi] = next.durationRange
    rx = { ...base, sets: 1, minSets: 1, maxSets: 1, durationSeconds: Math.max(lo, Math.min(hi, slot.durationSeconds)) }
  } else if (role === "finisher") {
    rx = prescribeFinisher(next, profile.goal, profile.experience, finisherBudgetSeconds(profile.durationPreferenceMinutes, profile.goal))
  } else if (main) {
    rx = prescribe(next, profile.goal, profile.experience, role as MainRole, {
      last,
      pool: workout.program ? lib.all : generationPool(lib),
      allows: (e) => passesProfileFilter(e, profile),
    })
    const prescribedSets = rx.sets
    rx.sets = restDay ? rx.minSets : Math.max(rx.minSets, Math.min(slot.sets, rx.maxSets))
    // A progression note written for more sets ("one more set today") no longer describes the slot.
    if (rx.sets < prescribedSets) {
      rx.note = null
      rx.suggestedExerciseId = null
    }
    // Core spec C16: a short session's trunk work keeps the short dose whichever drill fills it.
    if (next.category === "core" && !isConditioning(next) && profile.durationPreferenceMinutes <= SHORT_SESSION_MINUTES) applyShortCoreDose(rx, next)
    // Keep the rest the user already saw unless the new exercise is a different kind of work.
    if ((slot.reps !== null) === (rx.reps !== null) && role === slot.role) rx.restSeconds = slot.restSeconds
  } else {
    // The builders' own light prescriptions: short impact pulse raisers, primer rep caps, and the
    // short cool-down's bottom-of-range holds (coach round 2, R25/R18).
    rx =
      slot.phase === "warmup"
        ? prescribeWarmupItem(next, profile.durationPreferenceMinutes)
        : prescribeCooldownItem(next, profile.durationPreferenceMinutes)
  }
  let load = main ? planLoad(next, rx.reps, last, profile, { rir: rx.rir }) : null
  if (work && load) {
    // As in generation: RIR depends on whether today's load is proven, known once it is planned.
    const settled = prescribeRir(next, profile.goal, profile.experience, role as MainRole, { last, weightSource: load.weightSource })
    const rir = settled !== null && restDay ? Math.min(MAX_RIR, settled + 1) : settled
    if (rir !== rx.rir) {
      rx = { ...rx, rir }
      load = planLoad(next, rx.reps, last, profile, { rir })
    }
  }
  const weightKg = load?.weightKg ?? null
  const note = !load ? null : work ? composeSlotNote({ role, exercise: next, weightKg, load, progression: rx.note, experience: profile.experience }) : load.note
  const rebuilt: WorkoutExercise = {
    ...slot,
    exerciseId: next.id,
    role,
    sets: rx.sets,
    reps: rx.reps,
    durationSeconds: rx.durationSeconds,
    restSeconds: rx.restSeconds,
    tempo: rx.tempo,
    rir: rx.rir,
    recommendedWeightKg: weightKg,
    weightSource: weightKg != null ? (load?.weightSource ?? null) : null,
    note,
    replacedFromExerciseId: slot.replacedFromExerciseId ?? previous.id,
  }
  delete rebuilt.loadCheck
  delete rebuilt.suggestedExerciseId
  if (load?.loadCheck && weightKg !== null) rebuilt.loadCheck = true
  if (work && rx.suggestedExerciseId) rebuilt.suggestedExerciseId = rx.suggestedExerciseId
  if (restores) rebuilt.intendedSlot = null
  return rebuilt
}

export function replaceExercise(
  workout: Workout,
  slotId: string,
  input: EngineInput,
  options: ReplaceOptions = {},
  lib: Library = DEFAULT_LIBRARY,
): Workout | null {
  const slot = workout.exercises.find((e) => e.slotId === slotId)
  if (!slot) return null
  const current = lib.get(slot.exerciseId)
  if (!current) return null
  const exclude = new Set(options.exclude ?? [])

  let next: Exercise | undefined
  if (options.withExerciseId) {
    const manual = lib.get(options.withExerciseId)
    if (!manual || !validReplacement(workout, slot, current, manual, input, exclude, lib)) return null
    next = manual
  } else {
    // The automatic swap never pushes a capped group past its weekly volume: it takes the best
    // swap for the stand-in itself and leaves the planned lift to a deliberate manual pick.
    const ranked = rankReplacements(workout, slot, current, input, lib, exclude)
    next = (ranked.find((s) => !s.intended) ?? ranked[0])?.exercise
  }
  if (!next) return null

  const rebuilt = rebuildSlot(workout, slot, current, next, input, lib)
  const exercises = workout.exercises.map((e) => (e.slotId === slotId ? rebuilt : e))
  const updated: Workout = { ...workout, exercises }
  updated.estimatedMinutes = estimateDurationMinutes(updated, lib)
  return updated
}
