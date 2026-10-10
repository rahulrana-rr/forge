/**
 * Workout generation orchestrator. Pure: every decision flows from the input and the seed.
 */
import { muscleGroupOf } from "@/lib/exercises"
import { DEFAULT_LIBRARY, type Library } from "./library"
import {
  ALL_MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  type BodyArea,
  type Exercise,
  type Goal,
  type MovementPattern,
  type MuscleGroup,
} from "@/lib/exercises/types"
import type { CompletedWorkout, UserProfile } from "@/lib/domain/types"
import { daysBetween } from "@/lib/dates"
import { ENGINE_VERSION, type EngineInput, type Workout, type WorkoutExercise } from "./types"
import { createRng, defaultSeed, hashString, type Rng } from "./random"
import {
  applyShortCoreDose,
  finisherBudgetSeconds,
  FIRST_HOLD_NOTE_PREFIX,
  SHORT_SESSION_MINUTES,
  fitsFinisherBudget,
  GOAL_PRESCRIPTIONS,
  prescribe,
  prescribeFinisher,
  prescribeRest,
  prescribeRir,
  protectedRestSeconds,
  repRangeFitsGoal,
  restCeiling,
  type MainRole,
  type Prescription,
} from "./prescriptions"
import {
  CORE_DAYS_TARGET,
  coreDays,
  FINISHER_SLOT,
  liftingSlotCap,
  MAX_CORE_DAYS,
  mainSlotCount,
  mainSlotRange,
  rotationFor,
  slotsForCount,
  spareSlots,
  templateForHistory,
  type SlotSpec,
  type SplitTemplate,
} from "./splits"
import {
  cappedGroupsOf,
  computeRecovery,
  coreExposure,
  coreWeeklyCap,
  freshnessScore,
  isFresh,
  trainingFrequency,
  weeklyCap,
  weeklySoftCeiling,
  WEEKLY_SOFT_CEILING_FACTOR,
  type CoreExposure,
  type RecoveryMap,
  type TrainingFrequency,
} from "./recovery"
import {
  goalCompatible,
  isConditioning,
  isUnloadedPlyometric,
  supportLiftStatus,
  passesProfileFilter,
  rankCandidates,
  selectForSlot,
  slotCandidates,
  type MatchLevel,
  type ScoreContext,
} from "./selection"
import { lastPerformance, planLoad, progressFinisher, type LastPerformance } from "./progression"
import { buildWarmup, type PlannedItem } from "./warmup"
import { buildCooldown } from "./cooldown"
import {
  estimateSlotSeconds,
  estimateWorkSeconds,
  FIT_CEILING,
  FIT_FLOOR,
  fitToDuration,
  SECONDS_PER_REP,
  TRANSITION_SECONDS,
  type FittableSlot,
} from "./duration"
import { composeSlotNote } from "./slot-notes"

/** Minimum main-phase exercises the engine tries to guarantee. */
export const MIN_MAIN_EXERCISES = 3
/** How many days back a workout still counts for "where are we in the rotation". */
export const ROTATION_LOOKBACK_DAYS = 10

export function sortedHistory(history: readonly CompletedWorkout[]): CompletedWorkout[] {
  return history.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export interface TemplateChoice {
  template: SplitTemplate
  /** The day the rotation would have given without recovery checks. */
  natural: SplitTemplate
  reason: "start" | "rotation" | "freshness"
}

/** Next rotation day: the one after the last trained day unless its groups are not recovered. */
export function chooseTemplate(
  rotation: SplitTemplate[],
  history: readonly CompletedWorkout[],
  recovery: RecoveryMap,
  date: string,
): TemplateChoice {
  const recent = sortedHistory(history).filter((w) => {
    const age = daysBetween(w.date, date)
    return age >= 0 && age <= ROTATION_LOOKBACK_DAYS
  })
  let lastIndex = -1
  for (const w of recent) {
    const t = templateForHistory(rotation, w.split, w.title)
    if (t) {
      lastIndex = rotation.indexOf(t)
      break
    }
  }
  const naturalIndex = lastIndex < 0 ? 0 : (lastIndex + 1) % rotation.length
  const natural = rotation[naturalIndex] as SplitTemplate
  if (lastIndex < 0) return { template: natural, natural, reason: "start" }
  if (natural.heavyGroups.every((g) => isFresh(recovery, g))) return { template: natural, natural, reason: "rotation" }

  let best = natural
  let bestScore = freshnessScore(recovery, natural.heavyGroups)
  let bestDistance = 0
  rotation.forEach((t, i) => {
    const score = freshnessScore(recovery, t.heavyGroups)
    const distance = (i - naturalIndex + rotation.length) % rotation.length
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = t
      bestScore = score
      bestDistance = distance
    }
  })
  if (best === natural) return { template: natural, natural, reason: "rotation" }
  return { template: best, natural, reason: "freshness" }
}

/**
 * Sessions of history that make up "this week" for the weekly cap: the plan's other sessions.
 * A 3-day plan trained every other day has four sessions in a rolling 7-day window; counting all
 * of them caps every fourth session's main lifts away.
 */
export function budgetSessionsFor(profile: Pick<UserProfile, "trainingDaysPerWeek">): number {
  return Math.max(1, profile.trainingDaysPerWeek - 1)
}

/** Consecutive training days after which a rest day is recommended whatever the plan. */
export const REST_DAY_STREAK = 6

/** Whether the user has already done a week's training (or trained six days straight). */
export function restDayDue(frequency: TrainingFrequency, profile: Pick<UserProfile, "trainingDaysPerWeek">): boolean {
  return frequency.sessionsLast7 >= profile.trainingDaysPerWeek || frequency.streak >= REST_DAY_STREAK
}

export interface SlotPlan {
  slot: SlotSpec
  /** The role written to the workout: the slot's, except a stand-in never carries a compound role. */
  role: MainRole
  exercise: Exercise
  prescription: Prescription
  note: string | null
  capped: boolean
  /** 0 = exact slot match; ≥ 3 means the slot was filled through secondary muscles. */
  matchLevel: number
  /**
   * The slot's own lift kept at a maintenance dose because its group is at the weekly target:
   * minimum sets, one more rep in reserve and no load increase.
   */
  maintenance?: boolean
  /** The lift's last logged performance (null when never logged). */
  last?: LastPerformance | null
}

type BlockCause = "cap" | "limitation" | "unavailable"

/** Why a compound slot lost its own lift (dropped, or filled by a stand-in). */
interface SlotBlock {
  cause: BlockCause
  /** The user's flagged areas that rule the usual lifts out (cause "limitation"). */
  areas: BodyArea[]
}

interface PlanState {
  input: EngineInput
  pool: readonly Exercise[]
  lib: Library
  rng: Rng
  recovery: RecoveryMap
  template: SplitTemplate
  plans: SlotPlan[]
  plannedSets: Map<MuscleGroup, number>
  lastSameSplitIds: Set<string>
  /** Completed workouts of today's split day, newest first (R07: support lifts keep their slot for a block). */
  sameSplitHistory: CompletedWorkout[]
  recentIds: Map<string, number>
  /** Exercise ids the user has logged at least once. */
  performedIds: Set<string>
  /** Per-session share of the weekly cap, by group (absent → only the weekly cap applies). */
  sessionBudget: Map<MuscleGroup, number>
  /** False once the day cannot reach the minimum: then only the weekly cap is enforced. */
  useSessionBudget: boolean
  cap: number
  softCeiling: number
  /** Compound slots that lost their own lift, keyed by the slot's main group. */
  blocked: Map<MuscleGroup, SlotBlock>
  /** A rest day is due: every slot at its minimum sets, an extra rep in reserve, no padding. */
  reduced: boolean
  /** Seconds a conditioning block must fit when the lifts leave less than the usual budget (endurance sizing). */
  finisherBudgetOverride?: number
  /** Core spec C04: the trunk's own weekly set cap (in place of `cap` for the core group). */
  coreCap: number
  /**
   * Core spec C01/C02: today's core slot is protected (a designated core day, or the rolling-7-day
   * catch-up is due): it is planned within the weekly core cap and never dropped by the time fitter.
   */
  coreProtected: boolean
  /** Core spec C02: false when the week already has its most core days; today then has no core slot. */
  coreAllowed: boolean
  /** Core spec C02/C07: trunk work in the rolling 7 days. */
  coreHistory: CoreExposure
  /**
   * Core spec C03: the seeded stream the protected-core candidates are scored with, apart from `rng`,
   * so trying them does not change the rest of the day's picks.
   */
  coreRng: Rng
  /** The workout's seed: sizeConditioning scores blocks with a stream of its own derived from it. */
  seed: number
}

/** Groups the weekly cap does not apply to: conditioning and whole-body work are not "direct sets". */
const UNCAPPED_GROUPS: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(["cardio", "full_body"])
/** Fewest working sets worth programming for a group that is near its weekly cap. */
const MIN_CAPPED_SETS = 2
/** Sets a maintenance dose of the day's own lift may run over the weekly target (coach's limit). */
const MAINTENANCE_OVERSHOOT = 2
/** Reps in reserve are never prescribed above this, whatever the adjustments. */
const MAX_RIR = 4

/**
 * Sets still allowed for a group under the hard weekly cap: the cap against this week's sessions
 * (the plan's other sessions), and a soft ceiling against everything in the last 7 days.
 */
function weeklyRemaining(state: PlanState, group: MuscleGroup): number {
  if (UNCAPPED_GROUPS.has(group)) return Number.POSITIVE_INFINITY
  const planned = state.plannedSets.get(group) ?? 0
  const rec = state.recovery[group]
  // Core spec C04: the trunk has its own cap by goal and experience, with the same soft ceiling factor.
  const cap = group === "core" ? state.coreCap : state.cap
  const softCeiling = group === "core" ? Math.round(state.coreCap * WEEKLY_SOFT_CEILING_FACTOR) : state.softCeiling
  return Math.min(cap - rec.setsBudget - planned, softCeiling - rec.setsLast7 - planned)
}

/** Sets still allowed today: the weekly cap, and (normally) this session's share of it. */
function remainingSets(state: PlanState, group: MuscleGroup): number {
  const weekly = weeklyRemaining(state, group)
  const budget = state.sessionBudget.get(group)
  if (!state.useSessionBudget || budget === undefined) return weekly
  return Math.min(weekly, budget - (state.plannedSets.get(group) ?? 0))
}

/**
 * Spread each group's weekly cap over the sessions that load it. A group the rotation trains
 * with compound (or trunk) slots on N days gets floor(cap / N) sets per session (never below
 * the 2-set minimum), so the first pull day of a six-day week cannot spend the whole back
 * budget and leave the second one with curls, and upper days cannot use up the core work the
 * leg days need.
 *
 * Core spec C04: with `core`, the trunk's budget is its own weekly cap over the plan's designated
 * core days (CORE_DAYS_TARGET), never below the 2-set minimum.
 */
export function sessionBudgets(rotation: readonly SplitTemplate[], cap: number, core?: { cap: number; days: number }): Map<MuscleGroup, number> {
  const count = (templates: readonly SplitTemplate[], include: (slot: SplitTemplate["slots"][number]) => boolean) => {
    const freq = new Map<MuscleGroup, number>()
    for (const template of templates) {
      const groups = new Set<MuscleGroup>()
      for (const slot of template.slots) if (include(slot)) for (const g of slot.groups) groups.add(g)
      for (const g of groups) freq.set(g, (freq.get(g) ?? 0) + 1)
    }
    return freq
  }
  // Coach round 2 (R17): a conditioning-led day's circuit takes its minimum dose of each group it
  // loads; the lifting days share what is left, so Friday's main pull is not lost to the circuits.
  const lifting = rotation.filter((t) => !t.conditioning)
  const circuits = count(rotation.filter((t) => t.conditioning), () => true)
  // Groups loaded by compounds are split over those days only (a rear-delt slot on pull day must
  // not halve the shoulders budget of push day); arm-only groups over the days that isolate them.
  const heavy = count(lifting, (s) => s.mechanics === "compound" || s.kind === "core")
  const any = count(lifting, () => true)
  const out = new Map<MuscleGroup, number>()
  for (const [g, n] of any) {
    const days = heavy.get(g) ?? n
    const reserved = (circuits.get(g) ?? 0) * MIN_CAPPED_SETS
    if ((days > 1 || reserved > 0) && !UNCAPPED_GROUPS.has(g)) out.set(g, Math.max(MIN_CAPPED_SETS, Math.floor((cap - reserved) / days)))
  }
  if (core && core.days > 0) out.set("core", Math.max(MIN_CAPPED_SETS, Math.floor(core.cap / core.days)))
  return out
}

function openGroups(state: PlanState): MuscleGroup[] {
  return ALL_MUSCLE_GROUPS.filter((g) => remainingSets(state, g) >= MIN_CAPPED_SETS)
}

function scoreContext(state: PlanState, slot: SlotSpec): ScoreContext {
  return {
    profile: state.input.profile,
    slot,
    chosen: state.plans.map((p) => p.exercise),
    lastSameSplitIds: state.lastSameSplitIds,
    recentIds: state.recentIds,
    rng: state.rng,
    recovery: state.recovery,
    performedIds: state.performedIds,
    sameSplitHistory: state.sameSplitHistory,
    core: state.coreHistory,
  }
}

function label(group: MuscleGroup): string {
  return MUSCLE_GROUP_LABELS[group].toLowerCase()
}

function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("")
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
}

function areaWords(areas: readonly BodyArea[]): string {
  return listWords(areas.map((a) => a.replace(/_/g, " ")))
}

function patternKey(exercise: Exercise): string {
  return `${exercise.movementPattern}/${muscleGroupOf(exercise)}`
}

function union(a: ReadonlySet<string> | undefined, b: Iterable<string>): Set<string> {
  return new Set([...(a ?? []), ...b])
}

/**
 * Exercises a secondary-muscle stand-in may never be: one whose primary group another slot of the
 * day trains (a hip thrust is the glute slot's job, not the squat's), or the same movement and
 * group as a lift already planned.
 */
function standInExclusions(state: PlanState, slot: SlotSpec): Set<string> {
  const otherGroups = new Set(state.template.slots.filter((s) => s.key !== slot.key).flatMap((s) => s.groups))
  const planned = new Set(state.plans.filter((p) => p.role !== "finisher").map((p) => patternKey(p.exercise)))
  return new Set(state.pool.filter((ex) => otherGroups.has(muscleGroupOf(ex)) || planned.has(patternKey(ex))).map((ex) => ex.id))
}

/** Why a slot has nothing at levels 0–2 once the cap is set aside: a flagged area, or kit and exclusions. */
function unavailableCause(state: PlanState, slot: SlotSpec, options: { taken: ReadonlySet<string>; exclude?: ReadonlySet<string> }): SlotBlock {
  const { profile } = state.input
  if (profile.limitations.length > 0) {
    const free = slotCandidates(slot, state.pool, { ...profile, limitations: [] }, { ...options, chosen: state.plans.map((p) => p.exercise) })
    if (free && free.level <= 2) {
      const areas = profile.limitations.filter((a) => free.exercises.some((ex) => ex.contraindications.includes(a)))
      if (areas.length > 0) return { cause: "limitation", areas }
    }
  }
  return { cause: "unavailable", areas: [] }
}

interface Resolved {
  exercise: Exercise
  level: MatchLevel
  maintenance: boolean
  standIn: SlotBlock | null
}

/**
 * A compound slot whose own lifts (levels 0–2) are not open. When they exist but their group is at
 * the weekly target, the day keeps its lift at a maintenance dose (up to two sets over the target),
 * never a secondary-muscle stand-in. Stand-ins are only for slots that equipment, limitations or
 * exclusions leave empty, and never another slot's work. Null drops the slot.
 */
function resolveCompoundSlot(
  state: PlanState,
  slot: SlotSpec,
  ctx: ScoreContext,
  taken: ReadonlySet<string>,
  exclude: ReadonlySet<string> | undefined,
): Resolved | null {
  const { profile } = state.input
  const key = slot.groups[0]
  const uncapped = slotCandidates(slot, state.pool, profile, { taken, exclude, chosen: ctx.chosen })
  if (uncapped && uncapped.level <= 2) {
    const fits = uncapped.exercises.filter((ex) => weeklyRemaining(state, muscleGroupOf(ex)) >= MIN_CAPPED_SETS - MAINTENANCE_OVERSHOOT)
    const best = fits.length > 0 ? rankCandidates(fits, ctx)[0] : undefined
    if (!best) {
      if (key) state.blocked.set(key, { cause: "cap", areas: [] })
      return null
    }
    const maintenance = weeklyRemaining(state, muscleGroupOf(best.exercise)) < MIN_CAPPED_SETS
    return { exercise: best.exercise, level: uncapped.level, maintenance, standIn: null }
  }
  const standIn = selectForSlot(slot, state.pool, ctx, {
    openGroups: openGroups(state),
    taken,
    exclude: union(exclude, standInExclusions(state, slot)),
  })
  if (standIn && standIn.level < 3) return { exercise: standIn.exercise, level: standIn.level, maintenance: false, standIn: null }
  const cause = unavailableCause(state, slot, { taken, exclude })
  if (key) state.blocked.set(key, cause)
  if (!standIn) return null
  return { exercise: standIn.exercise, level: standIn.level, maintenance: false, standIn: cause }
}

/**
 * Why a slot holds a stand-in. Only availability causes reach here: a capped slot keeps its own lift
 * at a maintenance dose or is dropped with a light-day note, never stood in.
 */
function standInNote(slot: SlotSpec, cause: SlotBlock): string {
  const wanted = slot.groups.map(label).join("/")
  if (cause.cause === "limitation") return `Stand-in for ${wanted}: your ${areaWords(cause.areas)} flag rules out the usual options.`
  return `Stand-in for ${wanted}: the usual options are excluded or unavailable.`
}

/** The goal's conditioning budget for one finisher (prescriptions.ts). */
function finisherBudget(profile: UserProfile): number {
  return finisherBudgetSeconds(profile.durationPreferenceMinutes, profile.goal)
}

/**
 * Beginners' conditioning starts low impact (bike, rower, marching, shadow boxing): when the slot has
 * a low-impact option, the jumping and sprinting ones are set aside. And a block whose own minimum
 * (its fewest rounds at its shortest work) overruns the budget is set aside when one fits (coach
 * round 2, R02 caller): the time fitter protects a finisher's minimum rounds, so an oversized block
 * would take its time from the lifts.
 */
function finisherExclusions(state: PlanState, slot: SlotSpec, taken: ReadonlySet<string>, exclude?: ReadonlySet<string>): ReadonlySet<string> | undefined {
  const { profile } = state.input
  const candidates = slotCandidates(slot, state.pool, profile, { taken, exclude })
  if (!candidates) return exclude
  let out = exclude
  let remaining = candidates.exercises
  if (profile.experience === "beginner") {
    const gentle = remaining.filter((ex) => ex.tags?.includes("low_impact"))
    if (gentle.length > 0 && gentle.length < remaining.length) {
      out = union(out, remaining.filter((ex) => !gentle.includes(ex)).map((ex) => ex.id))
      remaining = gentle
    }
  }
  const budget = state.finisherBudgetOverride ?? finisherBudget(profile)
  const fitting = remaining.filter((ex) => fitsFinisherBudget(ex, profile.goal, profile.experience, budget))
  if (fitting.length > 0 && fitting.length < remaining.length) out = union(out, remaining.filter((ex) => !fitting.includes(ex)).map((ex) => ex.id))
  return out
}

/** Direct trunk work in a main slot: a core slot, or a core-category exercise (not a conditioning drill). */
function isTrunkWork(slot: SlotSpec, exercise: Exercise): boolean {
  if (slot.role === "finisher" || isConditioning(exercise)) return false
  return slot.kind === "core" || exercise.category === "core"
}

/** A plan that is direct trunk work. */
function isCorePlan(plan: SlotPlan): boolean {
  return isTrunkWork(plan.slot, plan.exercise)
}

/**
 * Fill one slot. Weekly caps are hard: only exercises whose primary group still has room are
 * candidates, and the set count (including the room the fitter may grow into) never exceeds
 * what is left, apart from a compound's maintenance dose. Finishers are conditioning, not direct
 * volume, so they are exempt.
 */
function fillSlot(state: PlanState, slot: SlotSpec, exclude?: ReadonlySet<string>): SlotPlan | null {
  const { profile, history, progress } = state.input
  const finisher = slot.role === "finisher"
  // Core spec C02: the week already has its most core days, so today has no core slot (its place
  // goes to the template's next slot through promoteSpares).
  if (!finisher && slot.kind === "core" && !state.coreAllowed) return null
  const taken = new Set(state.plans.map((p) => p.exercise.id))
  const ctx = scoreContext(state, slot)
  let exercise: Exercise
  let level: MatchLevel
  let maintenance = false
  let standIn: SlotBlock | null = null
  if (finisher) {
    const picked = selectForSlot(slot, state.pool, ctx, { taken, exclude: finisherExclusions(state, slot, taken, exclude) })
    if (!picked) return null
    ;({ exercise, level } = picked)
  } else {
    const picked = selectForSlot(slot, state.pool, ctx, { openGroups: openGroups(state), taken, exclude })
    // The heavy slots keep their own lift at a maintenance dose rather than lose it, and so does the
    // pull that balances a pressing day (a 2-set press is still a press).
    const keepsLift = compoundRole(slot.role) || slot.key === BALANCE_PULL_SLOT.key
    if (keepsLift && (!picked || picked.level >= 3)) {
      const resolved = resolveCompoundSlot(state, slot, ctx, taken, exclude)
      if (!resolved) return null
      ;({ exercise, level, maintenance, standIn } = resolved)
    } else if (picked) {
      ;({ exercise, level } = picked)
    } else return null
  }
  // A lift found only through a secondary muscle (a face pull for a capped back) is support work,
  // not the day's heavy lift: it is prescribed and recorded as an accessory so it neither gets
  // heavy-lift loading nor marks its own group as heavily trained for the next day's choice.
  const role: MainRole = level >= 3 && compoundRole(slot.role) ? "accessory" : slot.role
  const last = lastPerformance(exercise.id, history, progress)
  const prescription = finisher
    ? prescribeFinisher(exercise, profile.goal, profile.experience, finisherBudget(profile))
    : prescribe(exercise, profile.goal, profile.experience, role, { last, pool: state.pool, allows: (ex) => passesProfileFilter(ex, profile) })
  // A conditioning block completed in full last time moves one lever (coach round 2, R12): more
  // work per round, then a round, then less rest. A rest-day session repeats nothing harder.
  let finisherNote: string | null = null
  if (finisher && !state.reduced) {
    const moved = progressFinisher(exercise, prescription, last)
    if (moved) {
      prescription.sets = moved.sets
      prescription.durationSeconds = moved.durationSeconds
      prescription.restSeconds = moved.restSeconds
      prescription.maxSets = Math.max(prescription.maxSets, moved.sets)
      prescription.minSets = Math.min(prescription.minSets, moved.sets)
      finisherNote = moved.note
    }
  }
  const group = muscleGroupOf(exercise)
  const prescribedSets = prescription.sets
  let capped: "week" | "session" | null = null
  if (!finisher) {
    // Core spec C16: in a session of 30 minutes or less trunk work is exactly 2 sets, with short
    // holds and a short rep window per side for one-sided drills.
    if (isTrunkWork(slot, exercise) && profile.durationPreferenceMinutes <= SHORT_SESSION_MINUTES) applyShortCoreDose(prescription, exercise)
    // A rest day is due, or this is a conditioning-led day's circuit (the conditioning block is the
    // main work and takes the spare time): the minimum dose of every lift, with no room to grow.
    const fixedDose = state.reduced || !!state.template.conditioning
    if (fixedDose) prescription.sets = prescription.minSets
    const charged = cappedGroupsOf(exercise, group)
    const remaining = Math.min(...charged.map((g) => remainingSets(state, g)))
    const weekly = Math.min(...charged.map((g) => weeklyRemaining(state, g)))
    if (maintenance) {
      prescription.sets = MIN_CAPPED_SETS
      capped = "week"
    } else if (remaining < prescription.sets) {
      prescription.sets = Math.max(MIN_CAPPED_SETS, remaining)
      capped = weekly <= remaining ? "week" : "session"
    }
    prescription.minSets = Math.min(prescription.minSets, prescription.sets)
    prescription.maxSets = maintenance || fixedDose ? prescription.sets : Math.max(prescription.sets, Math.min(prescription.maxSets, remaining))
    for (const g of charged) state.plannedSets.set(g, (state.plannedSets.get(g) ?? 0) + prescription.sets)
    // A progression note was written for the prescribed set count ("one more set today"); once a
    // cap or a rest-day session cuts the sets it no longer describes the slot. A hold's regression
    // note (core spec C18) does not depend on the sets.
    if (prescription.sets < prescribedSets && !prescription.note?.startsWith(FIRST_HOLD_NOTE_PREFIX)) prescription.note = null
  }

  // The slot's own explanation (a cap, a stand-in). The ramp-up or feeder-set instruction and any
  // calibration note depend on the load, so they are added once it is planned (composeSlotNote).
  const capNote = maintenance
    ? `Capped at ${prescription.sets} sets: ${label(group)} is at this week's volume target, so hold the load and keep an extra rep in reserve.`
    : capped === "week"
      ? `Capped at ${prescription.sets} sets: ${label(group)} is near its weekly volume.`
      : null
  const note = capNote ?? (standIn ? standInNote(slot, standIn) : null) ?? finisherNote
  return { slot, role, exercise, prescription, note, capped: capped !== null, matchLevel: level, maintenance, last }
}

/** Put a plan in before the finisher (the finisher always closes the main phase). */
function insertPlan(plans: SlotPlan[], plan: SlotPlan): void {
  const finisherIndex = plans.findIndex((p) => p.role === "finisher")
  if (finisherIndex >= 0) plans.splice(finisherIndex, 0, plan)
  else plans.push(plan)
}

/** Take a plan out and give back the sets it held against the caps. */
function removePlan(state: PlanState, plan: SlotPlan): void {
  state.plans = state.plans.filter((p) => p !== plan)
  if (plan.role === "finisher") return
  for (const g of cappedGroupsOf(plan.exercise, muscleGroupOf(plan.exercise))) {
    state.plannedSets.set(g, (state.plannedSets.get(g) ?? 0) - plan.prescription.sets)
  }
}

/**
 * Slots that could not be filled (a capped group with no maintenance room, a slot with no valid
 * stand-in) hand their place to the next spare template slot, so the day keeps its size.
 */
function promoteSpares(state: PlanState, slots: readonly SlotSpec[]): void {
  let missing = slots.filter((s) => s.role !== "finisher" && !state.plans.some((p) => p.slot === s)).length
  for (const spare of spareSlots(state.template, [...slots])) {
    if (missing <= 0) break
    const plan = fillSlot(state, spare)
    if (!plan) continue
    insertPlan(state.plans, plan)
    missing--
  }
}

const PUSH_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>(["horizontal_push", "vertical_push"])
const PULL_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>(["horizontal_pull", "vertical_pull"])

/**
 * A pull to balance a pressing day: any horizontal pull with room under the weekly cap, rows first,
 * rear-delt and lower-trap work (face pulls, reverse flyes, prone T-raises) when the back is capped.
 */
export const BALANCE_PULL_SLOT: SlotSpec = {
  key: "balance_pull",
  role: "accessory",
  patterns: ["horizontal_pull"],
  groups: ["back", "shoulders"],
  priority: 5,
  kind: "upper_pull",
}

function pushes(exercise: Exercise): boolean {
  return PUSH_PATTERNS.has(exercise.movementPattern)
}

function pulls(exercise: Exercise): boolean {
  return PULL_PATTERNS.has(exercise.movementPattern)
}

function isPush(plan: SlotPlan): boolean {
  return plan.role !== "finisher" && pushes(plan.exercise)
}

function isPull(plan: SlotPlan): boolean {
  return plan.role !== "finisher" && pulls(plan.exercise)
}

/** Days whose pressing must be matched by pulling: everything but push and leg days. */
function balancesPushPull(template: SplitTemplate): boolean {
  return template.split === "full_body" || template.split === "upper" || template.split === "conditioning"
}

/** Lifts in a plan (everything but conditioning blocks). */
function liftCount(plans: readonly SlotPlan[]): number {
  return plans.filter((p) => p.role !== "finisher").length
}

/**
 * Whether the day may take one more lift: within the session's slot range and under the goal's
 * lifting cap (endurance keeps its lifting short so the conditioning block has the time).
 */
function roomForLift(state: PlanState): boolean {
  const { durationPreferenceMinutes: minutes, goal } = state.input.profile
  const plans = slotCounted(state)
  return plans.length < mainSlotRange(minutes)[1] && liftCount(plans) < liftingSlotCap(minutes, goal)
}

/**
 * Plans that count against the slot range and the lifting cap: a protected core plan does not
 * (core spec C03), so the day's lifts keep their room.
 */
function slotCounted(state: PlanState): SlotPlan[] {
  return state.coreProtected ? state.plans.filter((p) => !isCorePlan(p)) : state.plans
}

/**
 * A full-body or upper day that presses must also pull. When the template's pulls were capped or
 * swapped out, add a horizontal pull against the weekly cap only (this session's share does not
 * apply); when none can be programmed, a press that only stood in through secondary muscles goes.
 */
function balancePushPull(state: PlanState): void {
  if (!balancesPushPull(state.template)) return
  if (!state.plans.some(isPush)) return
  // A conditioning-led day's circuit is optional work: when its pull has no weekly room, its press
  // goes too, rather than a balancing pull at a maintenance dose past the weekly target.
  if (state.template.conditioning) {
    if (state.plans.some(isPull)) return
    for (const p of state.plans.filter(isPush)) if (state.plans.length > MIN_MAIN_EXERCISES) removePlan(state, p)
    return
  }
  const fill = (slot: SlotSpec) => {
    const useSessionBudget = state.useSessionBudget
    state.useSessionBudget = false
    const plan = fillSlot(state, slot)
    state.useSessionBudget = useSessionBudget
    if (plan) insertPlan(state.plans, plan)
    return plan
  }
  if (!state.plans.some(isPull)) {
    if (fill(BALANCE_PULL_SLOT)) return
    for (const p of state.plans.filter((x) => isPush(x) && x.matchLevel >= 3)) {
      if (state.plans.length <= MIN_MAIN_EXERCISES) break
      removePlan(state, p)
    }
    return
  }
  // Two presses against one row (Full body C's bench and overhead press): when the day has a slot to
  // spare, a second pull at its normal dose, never a maintenance overshoot.
  const sets = (pred: (p: SlotPlan) => boolean) => state.plans.filter(pred).reduce((sum, p) => sum + p.prescription.sets, 0)
  const presses = sets((p) => isPush(p) && p.exercise.mechanics === "compound")
  if (presses - sets(isPull) >= MIN_CAPPED_SETS && roomForLift(state)) fill({ ...BALANCE_PULL_SLOT, key: "balance_pull_2" })
}

/** Support work: what rotates between blocks (not the heavy lifts, not conditioning). */
function isSupportPlan(p: SlotPlan): boolean {
  return p.role !== "primary_compound" && p.role !== "secondary_compound" && p.role !== "finisher"
}

/**
 * Coach round 2 (R07): support lifts build load history, so they are not rotated every week. A
 * lift that was last done on target keeps its slot for a block (scoring: selection.ts
 * supportLiftStatus); at a block boundary, or after two stalled sessions, one support lift of the
 * day rotates. When scoring already brought in a support lift that is new to this split day, the
 * day has its rotation. A replacement must suit the goal (goal-compatible, a rep range that fits);
 * otherwise the original is kept. The heavy lifts and the conditioning block do not count.
 */
function enforceRotation(state: PlanState): void {
  if (state.lastSameSplitIds.size === 0 || state.plans.length < MIN_MAIN_EXERCISES) return
  const support = state.plans.filter(isSupportPlan)
  if (support.some((p) => !state.lastSameSplitIds.has(p.exercise.id))) return
  const { goal } = state.input.profile
  const due = support
    .filter((p) => !supportLiftStatus(p.exercise.id, state.sameSplitHistory).keep)
    .sort((a, b) => b.slot.priority - a.slot.priority)
  const charge = (plan: SlotPlan, sign: 1 | -1) => {
    for (const g of cappedGroupsOf(plan.exercise, muscleGroupOf(plan.exercise))) {
      state.plannedSets.set(g, (state.plannedSets.get(g) ?? 0) + sign * plan.prescription.sets)
    }
  }
  for (const p of due) {
    const i = state.plans.indexOf(p)
    // Release the old pick's sets first, or the swap is judged against a budget it already spent.
    charge(p, -1)
    const saved = state.plans
    state.plans = state.plans.filter((x) => x !== p)
    const replacement = fillSlot(state, p.slot, state.lastSameSplitIds)
    state.plans = saved
    if (replacement && goalCompatible(replacement.exercise, goal) && repRangeFitsGoal(replacement.exercise, goal)) {
      state.plans[i] = replacement
      return
    }
    if (replacement) charge(replacement, -1)
    charge(p, 1)
  }
}

function compoundRole(role: WorkoutExercise["role"]): boolean {
  return role === "primary_compound" || role === "secondary_compound"
}

/**
 * Power work that opens the main phase while fresh: bodyweight jumps and throws (the plyometric
 * primers) and the Olympic lifts. Loaded ballistic lifts that are not Olympic (Pendlay rows, push
 * presses, swings) keep their compound or accessory place, so a Pendlay row never comes before the
 * day's deadlift.
 */
function leadsMainPhase(exercise: Exercise): boolean {
  return isUnloadedPlyometric(exercise) || !!exercise.tags?.includes("olympic")
}

function planRank(p: SlotPlan): number {
  if (p.role === "finisher") return 4
  if (leadsMainPhase(p.exercise)) return 0
  if (p.slot.kind === "core" || (p.exercise.category === "core" && p.role !== "primary_compound")) return 3
  return p.exercise.mechanics === "compound" ? 1 : 2
}

/**
 * Coach's order: power work first (jumps and Olympic lifts need fresh legs and crisp reps),
 * then compound lifts (in template order), then isolation work, then trunk work, then the
 * conditioning finisher. Templates already mostly follow it; stand-ins and rescue slots (an
 * isolation filling a compound slot, a core slot added for time) are put back in line here.
 */
export function orderPlans(plans: SlotPlan[]): void {
  const ordered = plans.map((p, i) => ({ p, i })).sort((a, b) => planRank(a.p) - planRank(b.p) || a.i - b.i)
  ordered.forEach(({ p }, i) => (plans[i] = p))
}

/** A catch-all accessory slot for the day's focus groups, used when template slots cannot be filled. */
function rescueSlot(template: SplitTemplate): SlotSpec {
  return {
    key: "rescue",
    role: "accessory",
    patterns: [],
    groups: template.focus.filter((g) => g !== "full_body"),
    priority: 50,
    kind: "general",
  }
}

/**
 * What the rescue slot may never add: the same movement and group as a lift already planned (a
 * second elbow extension, a third curl), and trunk work once the day has it or the trunk is capped.
 */
export function rescueExclusions(plans: readonly SlotPlan[], pool: readonly Exercise[], coreOpen: boolean): Set<string> {
  const planned = new Set(plans.filter((p) => p.role !== "finisher").map((p) => patternKey(p.exercise)))
  const coreDone = !coreOpen || plans.some((p) => p.slot.kind === "core" || p.exercise.category === "core")
  return new Set(pool.filter((ex) => planned.has(patternKey(ex)) || (coreDone && ex.category === "core")).map((ex) => ex.id))
}

/** One rescue exercise, for the listed group with the fewest sets planned so far. */
function rescuePlan(state: PlanState, groups: readonly MuscleGroup[], key = "rescue"): SlotPlan | null {
  const exclude = rescueExclusions(state.plans, state.pool, state.coreAllowed && remainingSets(state, "core") >= MIN_CAPPED_SETS)
  const order = groups
    .map((g, i) => ({ g, i, sets: state.plannedSets.get(g) ?? 0 }))
    .sort((a, b) => a.sets - b.sets || a.i - b.i)
  for (const { g } of order) {
    const plan = fillSlot(state, { ...rescueSlot(state.template), key, groups: [g] }, exclude)
    if (plan) return plan
  }
  return null
}

function lastWorkoutOfTemplate(
  history: readonly CompletedWorkout[],
  rotation: SplitTemplate[],
  template: SplitTemplate,
): CompletedWorkout | undefined {
  return sortedHistory(history).find((w) => templateForHistory(rotation, w.split, w.title)?.key === template.key)
}

function mainIds(workout: CompletedWorkout): string[] {
  return workout.exercises.filter((e) => e.phase === "main" && e.status !== "skipped").map((e) => e.exerciseId)
}

/** Ids the user has logged: completed main-phase work in history, plus anything in the progress map. */
function performedIdsOf(input: EngineInput): Set<string> {
  const ids = new Set<string>()
  for (const w of input.history) {
    for (const e of w.exercises) if (e.phase === "main" && e.status === "completed" && e.sets.some((s) => s.completed)) ids.add(e.exerciseId)
  }
  for (const [id, p] of Object.entries(input.progress)) if (p.timesPerformed > 0) ids.add(id)
  return ids
}

/** Direct working sets per group in a plan (finishers excluded, core-category work also charged to the trunk). */
function directSets(plans: readonly SlotPlan[]): Map<MuscleGroup, number> {
  const sets = new Map<MuscleGroup, number>()
  for (const p of plans) {
    if (p.role === "finisher" || p.prescription.sets <= 0) continue
    for (const g of cappedGroupsOf(p.exercise, muscleGroupOf(p.exercise))) sets.set(g, (sets.get(g) ?? 0) + p.prescription.sets)
  }
  return sets
}

/**
 * The workout's focus: the template's focus groups that actually got direct sets (a capped or
 * unavailable group is not "today's focus"). A day where none of them did names what it trained.
 */
export function programmedFocus(template: SplitTemplate, plans: readonly SlotPlan[]): MuscleGroup[] {
  const sets = directSets(plans)
  if (sets.size === 0) return template.focus.slice()
  const kept = template.focus.filter((g) => g === "full_body" || sets.has(g))
  if (kept.some((g) => g !== "full_body")) return kept
  const trained = [...sets.entries()]
    .filter(([g]) => !UNCAPPED_GROUPS.has(g))
    .sort((a, b) => b[1] - a[1] || ALL_MUSCLE_GROUPS.indexOf(a[0]) - ALL_MUSCLE_GROUPS.indexOf(b[0]))
    .map(([g]) => g)
  return [...kept, ...trained]
}

/**
 * Session notes for heavy groups that lost their main lift: at the weekly cap (a light day), ruled
 * out by a flagged area (no workaround in place of an assessment), or out of reach of the user's
 * kit and exclusions.
 */
function heavyGroupNotes(
  state: PlanState,
  plans: readonly SlotPlan[],
  extraCapped: readonly MuscleGroup[],
  /** The session already says its equipment, limitations and exclusions leave too little. */
  availabilityNoted: boolean,
): string[] {
  const sets = directSets(plans)
  const capped = new Set<MuscleGroup>(extraCapped)
  const limited = new Map<string, MuscleGroup[]>()
  const unavailable: MuscleGroup[] = []
  for (const g of state.template.heavyGroups) {
    if (UNCAPPED_GROUPS.has(g)) continue
    const zero = (sets.get(g) ?? 0) === 0
    const stoodIn = plans.some((p) => p.matchLevel >= 3 && compoundRole(p.slot.role) && p.slot.groups[0] === g)
    if (!zero && !stoodIn) continue
    const block = state.blocked.get(g) ?? (zero && weeklyRemaining(state, g) < MIN_CAPPED_SETS ? { cause: "cap" as const, areas: [] } : undefined)
    if (!block) continue
    if (block.cause === "cap") capped.add(g)
    else if (block.cause === "limitation") {
      const key = block.areas.join(",")
      limited.set(key, [...(limited.get(key) ?? []), g])
    } else unavailable.push(g)
  }
  const notes: string[] = []
  if (capped.size > 0) {
    notes.push(`Light day: ${listWords([...capped].map(label))} already reached this week's volume cap, so today trains what still has room.`)
  }
  for (const [key, groups] of limited) {
    const areas = key.split(",") as BodyArea[]
    const flagged = `your ${areaWords(areas)} ${areas.length === 1 ? "is" : "are"} flagged`
    const stoodIn = groups.filter((g) => (sets.get(g) ?? 0) > 0)
    const none = groups.filter((g) => (sets.get(g) ?? 0) === 0)
    if (none.length > 0) notes.push(`No direct ${listWords(none.map(label))} work while ${flagged}; consider a professional assessment.`)
    if (stoodIn.length > 0) notes.push(`Only stand-in ${listWords(stoodIn.map(label))} work while ${flagged}; consider a professional assessment.`)
  }
  if (unavailable.length > 0 && !availabilityNoted) {
    notes.push(`Light day for ${listWords(unavailable.map(label))}: the usual lifts are excluded or need equipment you do not have.`)
  }
  return notes
}

/**
 * One note per flagged area that emptied a support slot (coach round 2, R27), for groups the
 * heavy-group notes do not already name.
 */
function limitationNotes(leftOut: ReadonlyMap<BodyArea, ReadonlySet<MuscleGroup>>, groupNotes: readonly string[]): string[] {
  const notes: string[] = []
  for (const [area, groups] of leftOut) {
    const named = [...groups].filter((g) => !UNCAPPED_GROUPS.has(g) && !groupNotes.some((n) => n.includes(label(g)) && n.includes("flagged")))
    if (named.length === 0) continue
    notes.push(`Some ${listWords(named.map(label))} work is left out while your ${areaWords([area])} is flagged; consider a professional assessment.`)
  }
  return notes
}

function toWorkoutExercise(
  rng: Pick<Rng, "uuid">,
  exercise: Exercise,
  phase: WorkoutExercise["phase"],
  role: WorkoutExercise["role"],
  rx: Prescription,
  recommendedWeightKg: number | null,
  note: string | null,
  weightSource: WorkoutExercise["weightSource"] = null,
): WorkoutExercise {
  return {
    slotId: rng.uuid(),
    exerciseId: exercise.id,
    phase,
    role,
    sets: rx.sets,
    reps: rx.reps,
    durationSeconds: rx.durationSeconds,
    restSeconds: rx.restSeconds,
    tempo: rx.tempo,
    rir: rx.rir,
    recommendedWeightKg,
    weightSource: recommendedWeightKg != null ? weightSource : null,
    note,
    replacedFromExerciseId: null,
  }
}

function lightItems(rng: Rng, items: PlannedItem[], phase: "warmup" | "cooldown"): WorkoutExercise[] {
  return items.map((item) => toWorkoutExercise(rng, item.exercise, phase, phase, item.prescription, null, null))
}

/** Heaviest load logged in the last session, or null. */
function lastLoggedKg(last: LastPerformance | null | undefined): number | null {
  const loads = (last?.sets ?? []).map((s) => s.weightKg ?? 0).filter((w) => w > 0)
  return loads.length > 0 ? Math.max(...loads) : null
}

/**
 * Fewest rounds the time fitter may leave a conditioning goal's finisher: the exercise's own
 * minimum and about three quarters of the planned rounds, never more than were planned
 * (prescribeFinisher's minSets when that is higher). Other goals keep the prescription's floor.
 */
export function finisherFloor(exercise: Exercise, rx: Prescription, goal: Goal): number {
  if (!GOAL_PRESCRIPTIONS[goal].conditioning) return rx.minSets
  return Math.min(rx.sets, Math.max(rx.minSets, exercise.setsRange[0], Math.ceil(0.75 * rx.sets)))
}

/**
 * Where a conditioning goal's finisher sits when whole slots must go for time (fitToDuration drops
 * the highest number first): after every accessory and isolation slot, before the compounds.
 */
const CONDITIONING_BLOCK_PRIORITY = 2.5

/**
 * Core spec C03: the time-fitter priority of a protected core plan: just below the day's compound
 * lifts (fitToDuration drops the highest number first), so isolation slots go before it.
 */
function protectedCorePriority(plans: readonly SlotPlan[], core: SlotPlan): number {
  const compounds = plans.filter((p) => p !== core && p.role !== "finisher" && !isCorePlan(p) && p.exercise.mechanics === "compound")
  if (compounds.length === 0) return core.slot.priority
  return Math.max(...compounds.map((p) => p.slot.priority)) + 0.5
}

/** Order in which support roles give up sets for time: conditioning goals keep their finisher. */
function supportTier(role: WorkoutExercise["role"], conditioning: boolean): number | null {
  if (role === "isolation") return conditioning ? 0 : 1
  if (role === "accessory") return conditioning ? 1 : 2
  if (role === "finisher" && !conditioning) return 0
  return null
}

/** Isolation or unloaded work, which gives up a set before a loaded compound in the same tier. */
function lightWork(exercise: Exercise): boolean {
  return exercise.mechanics === "isolation" || (exercise.loadType !== "external" && exercise.loadType !== "assisted")
}

/**
 * Coach round 2 (R01, R22): what gives up time first when a plan runs over, before the time
 * fitter's own passes (duration.ts fitToDuration) take over for the compounds.
 *
 * Within a role, isolation or unloaded work gives up a set before a loaded compound, then the
 * lower-priority slot, then the one with more sets (a bodyweight prone T-raise before the day's
 * only loaded row). Support sets never go below 2 or their minimum.
 *
 * For conditioning goals the conditioning block is the goal's work, not filler: isolation, then
 * accessory sets go first, then their rests (to the goal floor), all before a finisher round; the
 * fitter then takes finisher rounds only down to their protected floor (finisherFloor), and the
 * compound sets after that. When whole slots must go, isolation and accessory slots go before the
 * conditioning block (CONDITIONING_BLOCK_PRIORITY). Slots are never dropped here: the warm-up and
 * cool-down were built for them, and a lift added for week-to-week variety must stay. Other goals
 * keep the fitter's order: a filler finisher first, then isolation, then accessory work.
 *
 * Mutates the slots; returns the slots kept.
 */
export function trimSupportFirst(main: FittableSlot[], fixedSeconds: number, preferenceMinutes: number, goal: Goal): FittableSlot[] {
  const conditioning = GOAL_PRESCRIPTIONS[goal].conditioning
  const target = preferenceMinutes * 60
  const kept = main.slice()
  const over = () => {
    const seconds = fixedSeconds + kept.reduce((sum, f) => sum + estimateSlotSeconds(f.slot, f.exercise), 0)
    return seconds > target * FIT_CEILING || Math.round(seconds / 60) > preferenceMinutes * FIT_CEILING
  }
  const tierOf = (f: FittableSlot) => supportTier(f.slot.role, conditioning)
  const byPreference = (a: FittableSlot, b: FittableSlot) =>
    (tierOf(a) ?? 0) - (tierOf(b) ?? 0) ||
    Number(lightWork(b.exercise)) - Number(lightWork(a.exercise)) ||
    b.priority - a.priority
  let guard = 0
  while (over() && guard++ < 64) {
    const floor = (f: FittableSlot) => Math.max(f.slot.role === "finisher" ? 1 : 2, f.minSets)
    const pick = kept
      .filter((f) => tierOf(f) !== null && f.slot.sets > floor(f))
      .sort((a, b) => byPreference(a, b) || b.slot.sets - a.slot.sets)[0]
    if (!pick) break
    pick.slot.sets -= 1
  }
  if (!conditioning) return kept
  guard = 0
  while (over() && guard++ < 64) {
    const restFloor = (f: FittableSlot) => Math.max(f.minRest, protectedRestSeconds(f.exercise, goal, f.slot.role as MainRole))
    const pick = kept
      .filter((f) => tierOf(f) !== null && f.slot.restSeconds - 15 >= restFloor(f))
      .sort((a, b) => byPreference(a, b) || b.slot.restSeconds - a.slot.restSeconds)[0]
    if (!pick) break
    pick.slot.restSeconds -= 15
  }
  return kept
}

/** Seconds of conditioning work in a slot: timed blocks, or reps at the default rep time. */
function conditioningWorkSeconds(sets: number, reps: readonly [number, number] | null, durationSeconds: number | null): number {
  if (durationSeconds !== null) return sets * durationSeconds
  return reps ? sets * reps[1] * SECONDS_PER_REP : 0
}

/** Conditioning minutes below which a low-frequency conditioning plan is pointed to off-day aerobic work. */
export const AEROBIC_NOTE_MINUTES = 10

/**
 * Conditioning seconds logged in the six days before the workout day (with today's plan, a 7-day
 * week): finishers and cardio work, as the coach counts them (lib/coach/context.ts).
 */
function conditioningSecondsLast7(history: readonly CompletedWorkout[], date: string, lib: Library): number {
  let seconds = 0
  for (const w of history) {
    const age = daysBetween(w.date, date)
    if (age < 1 || age >= 7) continue
    for (const e of w.exercises) {
      if (e.phase !== "main" || e.status !== "completed") continue
      const exercise = lib.get(e.exerciseId)
      if (e.role !== "finisher" && (!exercise || muscleGroupOf(exercise) !== "cardio")) continue
      for (const s of e.sets) if (s.completed) seconds += s.durationSeconds ?? (s.reps ?? 0) * SECONDS_PER_REP
    }
  }
  return seconds
}

/**
 * Coach round 2 (R17): a plan of three days or fewer whose finishers are its only conditioning
 * leaves the week short of aerobic work. The figure is a public-health reference (WHO 2020 adult
 * guidance), not engine data.
 */
export function aerobicNote(minutes: number): string {
  return (
    `Aerobic activity: about ${Math.round(minutes)} min of conditioning this week, today included, and the finisher is not your aerobic dose. ` +
    "Add easy aerobic activity on off days, such as a brisk walk or a bike ride; WHO adult guidance (2020) is 150–300 minutes of moderate activity a week."
  )
}

/** The conditioning slot's spec for scoring a steady-state block. */
const STEADY_SLOT: SlotSpec = { ...FINISHER_SLOT, key: "steady" }

/**
 * A steady-state block (bike, rower, brisk walk) for a steady-led conditioning day, sized to the
 * budget in whole minutes within the exercise's own range: only blocks whose shortest duration
 * fits are candidates, and beginners start low impact whenever a low-impact block fits. An easy
 * steady block is the main work here, so it is not held to an interval finisher's short first
 * blocks. Null when none fits, and the day keeps its interval block.
 */
function steadyPlan(state: PlanState, budgetSeconds: number, replaces: SlotPlan): SlotPlan | null {
  const { profile, history, progress } = state.input
  const taken = new Set(state.plans.filter((p) => p !== replaces).map((p) => p.exercise.id))
  let candidates = state.pool.filter(
    (ex) =>
      ex.category === "cardio" &&
      !!ex.tags?.includes("steady_state") &&
      !!ex.durationRange &&
      ex.durationRange[0] <= budgetSeconds &&
      passesProfileFilter(ex, profile) &&
      goalCompatible(ex, profile.goal) &&
      !taken.has(ex.id),
  )
  if (profile.experience === "beginner") {
    const gentle = candidates.filter((ex) => ex.tags?.includes("low_impact"))
    if (gentle.length > 0) candidates = gentle
  }
  const best = rankCandidates(candidates, scoreContext(state, STEADY_SLOT))[0]
  const range = best?.exercise.durationRange
  if (!best || !range) return null
  const rx = prescribeFinisher(best.exercise, profile.goal, profile.experience, budgetSeconds)
  const minutes = Math.floor(budgetSeconds / 60) * 60
  return {
    slot: replaces.slot,
    role: "finisher",
    exercise: best.exercise,
    prescription: { ...rx, sets: 1, minSets: 1, maxSets: 1, durationSeconds: Math.max(range[0], Math.min(range[1], minutes)) },
    note: null,
    capped: false,
    matchLevel: 0,
    last: lastPerformance(best.exercise.id, history, progress),
  }
}

/**
 * Coach round 2 (R17): an endurance session's conditioning block gets the time its capped lifting
 * leaves (`availableSeconds`, after warm-up, cool-down and lifts), never less than the usual
 * finisher budget. A steady-led conditioning day makes it one steady-state block when one fits.
 */
function sizeConditioning(state: PlanState, availableSeconds: number, yieldSeconds = 0): void {
  // Blocks are scored with a stream of their own, so sizing the same plan twice (the protected-core
  // check sizes the day without core as well, C03) picks the same block.
  const rng = state.rng
  state.rng = createRng(hashString(`${state.seed}:block`))
  try {
    sizeBlock(state, availableSeconds, yieldSeconds)
  } finally {
    state.rng = rng
  }
}

function sizeBlock(state: PlanState, availableSeconds: number, yieldSeconds: number): void {
  const index = state.plans.findIndex((p) => p.slot === FINISHER_SLOT)
  let current = state.plans[index]
  if (!current) return
  const { profile } = state.input
  const left = Math.round(availableSeconds - TRANSITION_SECONDS)
  // Core spec C03 (time budget rule 5): a protected core block's time comes out of the block's
  // usual budget, so the block is sized to the time left after core (never below its own minimum
  // rounds, which prescribeFinisher keeps) rather than taking it from the lifts.
  const usual = Math.max(0, finisherBudget(profile) - yieldSeconds)
  // The lifts leave less than the usual budget (a 30-minute day whose machine and cable lifts need
  // build-up sets): when the chosen block's own minimum overruns the time left, a block whose
  // minimum fits it is chosen instead, if there is one. The lifts are already at their floor.
  if (left < usual && !fitsFinisherBudget(current.exercise, profile.goal, profile.experience, Math.max(0, left))) {
    const saved = state.plans
    state.plans = state.plans.filter((p) => p !== current)
    state.finisherBudgetOverride = Math.max(0, left)
    const alternative = fillSlot(state, FINISHER_SLOT, new Set([current.exercise.id]))
    state.finisherBudgetOverride = undefined
    state.plans = saved
    if (alternative && fitsFinisherBudget(alternative.exercise, profile.goal, profile.experience, Math.max(0, left))) {
      state.plans[index] = alternative
      current = alternative
    }
  }
  const budget = Math.max(usual, left)
  const steady = state.template.conditioning === "steady" ? steadyPlan(state, budget, current) : null
  if (steady) state.plans[index] = steady
  else {
    // Re-sized to the time left: a progression note written for the budget-sized block no longer applies.
    current.prescription = prescribeFinisher(current.exercise, profile.goal, profile.experience, budget)
    current.note = null
  }
}

/** Core spec C02: days without trunk work after which the catch-up protects today's core slot. */
export const CORE_CATCH_UP_DAYS = 4
/** Core spec C02: the floor of sessions with trunk work in any rolling 7 days. */
export const CORE_SESSIONS_FLOOR = 2

/**
 * Core spec C02 (a): the rolling-7-day catch-up. Fewer than two core sessions in the window, and
 * either four or more days since the last one, or none at all while two or more sessions in the
 * window had none (freshness swaps, skipped sessions and irregular days).
 */
export function coreCatchUpDue(exposure: Pick<CoreExposure, "sessionsLast7" | "daysSinceCore" | "sessionsInWindow">): boolean {
  if (exposure.sessionsLast7 >= CORE_SESSIONS_FLOOR) return false
  if (exposure.daysSinceCore !== null && exposure.daysSinceCore >= CORE_CATCH_UP_DAYS) return true
  return exposure.sessionsLast7 === 0 && exposure.sessionsInWindow >= CORE_SESSIONS_FLOOR
}

/**
 * Core spec C02 (b): whether a day that is not protected may have a core slot. The window holds at
 * most MAX_CORE_DAYS sessions with core; the plan's designated days keep their place in it, so the
 * other days share only the room above CORE_DAYS_TARGET (a non-designated day early in the week
 * cannot take the room a designated day later that week needs).
 */
export function coreDayAllowed(exposure: Pick<CoreExposure, "sessionsLast7" | "extraLast7">, days: UserProfile["trainingDaysPerWeek"]): boolean {
  const max = MAX_CORE_DAYS[days]
  return exposure.sessionsLast7 < max && exposure.extraLast7 < max - CORE_DAYS_TARGET[days]
}

/**
 * Core spec C03: a protected core day whose plan has no trunk work gets it without displacing or
 * trimming a compound. The best-ranked drills are filled against the weekly core cap only (this
 * session's share does not apply) and tried in order:
 * 1. added, when the time fitter keeps it with every primary and secondary compound at the sets it
 *    would have had without it (never below what was prescribed) and the session within its ceiling;
 * 2. otherwise swapped in for the lowest-priority isolation on the same terms: never the day's only
 *    pull (a rear-delt fly counts) and never a muscle-gain day's last isolation on a day of five or
 *    more lifts;
 * 3. otherwise skipped today: the catch-up retries on the next session.
 * `accepts` runs the time fitter on a copy of the plan (generateWorkout); the fitter trims support
 * work before compounds (trimSupportFirst, duration.ts TRIM_ORDER), so the check holds the spec's
 * headroom rule (support at its floor, a conditioning goal's finisher at its protected rounds).
 */
function ensureProtectedCore(
  state: PlanState,
  accepts: (plans: readonly SlotPlan[], core: SlotPlan, dropped: SlotPlan | null) => boolean,
): { core: SlotPlan; dropped: SlotPlan | null } | null {
  if (!state.coreProtected || state.plans.some((p) => p.role !== "finisher" && (p.slot.kind === "core" || isCorePlan(p)))) return null
  if (weeklyRemaining(state, "core") < MIN_CAPPED_SETS) return null
  const coreSlot = state.template.slots.find((s) => s.kind === "core")
  if (!coreSlot) return null
  // The best-ranked drills, in order: when the first does not fit the time (a one-sided drill at
  // strength rests), a shorter one may.
  const candidates: SlotPlan[] = []
  const tried = new Set<string>()
  const useSessionBudget = state.useSessionBudget
  const rng = state.rng
  state.useSessionBudget = false
  state.rng = state.coreRng
  while (candidates.length < PROTECTED_CORE_CANDIDATES) {
    const plan = fillSlot(state, coreSlot, tried)
    if (!plan) break
    tried.add(plan.exercise.id)
    candidates.push(plan)
    // fillSlot charged its sets: release them until one is kept.
    removePlan(state, plan)
  }
  state.useSessionBudget = useSessionBudget
  state.rng = rng
  if (candidates.length === 0) return null
  const keep = (core: SlotPlan) => {
    for (const g of cappedGroupsOf(core.exercise, muscleGroupOf(core.exercise))) {
      state.plannedSets.set(g, (state.plannedSets.get(g) ?? 0) + core.prescription.sets)
    }
    insertPlan(state.plans, core)
  }
  const withCore = (plans: readonly SlotPlan[], core: SlotPlan) => {
    const out = plans.slice()
    insertPlan(out, core)
    return out
  }
  // 1. Time to spare: the day loses nothing.
  const added = candidates.find((core) => accepts(withCore(state.plans, core), core, null))
  if (added) {
    keep(added)
    return { core: added, dropped: null }
  }
  // 2. The lowest-priority isolation's time.
  const { goal } = state.input.profile
  const pullCount = state.plans.filter(isPull).length
  const isolations = state.plans
    .filter((p) => p.role === "isolation" && !isCorePlan(p))
    .sort((a, b) => b.slot.priority - a.slot.priority)
  const lastHypertrophyIsolation = goal === "muscle_gain" && liftCount(state.plans) >= 5 && isolations.length <= 1
  for (const iso of isolations) {
    if ((isPull(iso) && pullCount <= 1) || lastHypertrophyIsolation) continue
    const without = state.plans.filter((p) => p !== iso)
    const swapped = candidates.find((core) => accepts(withCore(without, core), core, iso))
    if (!swapped) continue
    removePlan(state, iso)
    keep(swapped)
    return { core: swapped, dropped: iso }
  }
  // 3. No room today: the catch-up retries on the next session.
  return null
}

/** Core spec C03: the best-ranked core drills tried, in order, for a protected core slot's time check. */
const PROTECTED_CORE_CANDIDATES = 6

/** Internal generation switches (not part of the public engine API). */
export interface GenerateOptions {
  /**
   * Core spec C01-C03: protect today's core slot on designated and catch-up days (default true).
   * False plans the day as if it were not protected, for comparisons in tests and audits.
   */
  coreProtection?: boolean
}

/** Generate today's workout. `lib` defaults to the static library; tests may inject fixtures. */
export function generateWorkout(input: EngineInput, lib: Library = DEFAULT_LIBRARY, options: GenerateOptions = {}): Workout {
  const pool = lib.all
  const { profile, date } = input
  const seed = (input.seed ?? defaultSeed(profile.id, date)) >>> 0
  const rng = createRng(seed)
  const workoutId = rng.uuid()
  const goalRx = GOAL_PRESCRIPTIONS[profile.goal]
  const recovery = computeRecovery(input.history, date, lib, budgetSessionsFor(profile))
  const rotation = rotationFor(profile.trainingDaysPerWeek, profile.experience, profile.goal)
  const { template } = chooseTemplate(rotation, input.history, recovery, date)
  const frequency = trainingFrequency(input.history, date)
  const reduced = restDayDue(frequency, profile)

  // Core spec C01/C02: designated core days, the rolling-7-day catch-up and the weekly ceiling.
  const designated = coreDays(rotation, profile.trainingDaysPerWeek)
  const coreHistory = coreExposure(input.history, date, lib, (w) => {
    const t = templateForHistory(rotation, w.split, w.title)
    return !!t && designated.has(t.key)
  })
  const coreProtected = options.coreProtection !== false && !reduced && (designated.has(template.key) || coreCatchUpDue(coreHistory))
  const coreCap = coreWeeklyCap(profile.goal, profile.experience)

  const lastSame = lastWorkoutOfTemplate(input.history, rotation, template)
  const recentIds = new Map<string, number>()
  sortedHistory(input.history)
    .slice(0, 3)
    .forEach((w, i) => mainIds(w).forEach((id) => { if (!recentIds.has(id)) recentIds.set(id, i) }))

  const state: PlanState = {
    input,
    pool,
    lib,
    rng,
    recovery,
    template,
    plans: [],
    plannedSets: new Map(),
    lastSameSplitIds: new Set(lastSame ? mainIds(lastSame) : []),
    sameSplitHistory: sortedHistory(input.history).filter((w) => templateForHistory(rotation, w.split, w.title)?.key === template.key),
    recentIds,
    performedIds: performedIdsOf(input),
    sessionBudget: sessionBudgets(rotation, weeklyCap(profile.experience), { cap: coreCap, days: CORE_DAYS_TARGET[profile.trainingDaysPerWeek] }),
    // A conditioning-led day's circuit runs at its minimum dose, against the weekly cap only.
    useSessionBudget: !template.conditioning,
    cap: weeklyCap(profile.experience),
    softCeiling: weeklySoftCeiling(profile.experience),
    blocked: new Map(),
    reduced,
    coreCap,
    coreProtected,
    // A designated day keeps its own core slot when protection is switched off (GenerateOptions).
    coreAllowed: coreProtected || designated.has(template.key) || coreDayAllowed(coreHistory, profile.trainingDaysPerWeek),
    coreHistory,
    coreRng: createRng(hashString(`${seed}:core`)),
    seed,
  }

  const notes: string[] = []
  if (reduced) {
    const why =
      frequency.streak >= REST_DAY_STREAK
        ? `${frequency.streak} days in a row without a break`
        : `${frequency.sessionsLast7} sessions in the last 7 days on a ${profile.trainingDaysPerWeek}-day plan`
    notes.push(`Rest day recommended: ${why}. If you train today, keep it light: minimum sets, an extra rep in reserve and no conditioning finisher.`)
  }

  const slotBudget = mainSlotCount(profile.durationPreferenceMinutes, goalRx.conditioning, profile.goal)
  const slots = slotsForCount(template, slotBudget, goalRx.conditioning, profile.goal === "muscle_gain")
    // A rest-day session drops its conditioning block.
    .filter((s) => !(reduced && s.role === "finisher"))
  // Coach round 2 (R27): a support slot a flagged area empties (a shoulder flag dropping the
  // overhead accessory and the lateral raise) is named in a session note, as heavy groups are.
  const leftOut = new Map<BodyArea, Set<MuscleGroup>>()
  for (const slot of slots) {
    const plan = fillSlot(state, slot)
    if (plan) state.plans.push(plan)
    else if (slot.role !== "finisher" && !compoundRole(slot.role) && profile.limitations.length > 0 && (slot.kind !== "core" || state.coreAllowed)) {
      const taken = new Set(state.plans.map((p) => p.exercise.id))
      // Only when the flag is why: a slot that still has its own lifts was dropped for the cap.
      const own = slotCandidates(slot, state.pool, profile, { taken, chosen: state.plans.map((p) => p.exercise) })
      const cause = own && own.level <= 2 ? null : unavailableCause(state, slot, { taken })
      if (cause?.cause === "limitation") {
        for (const area of cause.areas) {
          const groups = leftOut.get(area) ?? new Set<MuscleGroup>()
          for (const g of slot.groups) groups.add(g)
          leftOut.set(area, groups)
        }
      }
    }
  }
  promoteSpares(state, slots)
  // Core spec C02: a day the weekly ceiling takes the core slot from keeps its size: when no spare
  // template slot could take the place, one rescue lift for the day's focus does (never trunk work).
  if (!state.coreAllowed && slots.some((s) => s.kind === "core")) {
    const unfilled = slots.filter((s) => s.role !== "finisher" && !state.plans.some((p) => p.slot === s)).length
    const promoted = state.plans.filter((p) => !slots.includes(p.slot)).length
    if (promoted < unfilled) {
      const plan = rescuePlan(state, rescueSlot(template).groups)
      if (plan) insertPlan(state.plans, plan)
    }
  }
  if (state.plans.length < MIN_MAIN_EXERCISES) {
    for (const slot of spareSlots(template, slots)) {
      if (state.plans.length >= MIN_MAIN_EXERCISES) break
      if (state.plans.some((p) => p.slot === slot)) continue
      const plan = fillSlot(state, slot)
      if (plan) insertPlan(state.plans, plan)
    }
  }
  if (state.plans.length < MIN_MAIN_EXERCISES) {
    // Spreading volume is a preference; a session of at least three exercises is a requirement.
    state.useSessionBudget = false
    for (const slot of spareSlots(template, slots)) {
      if (state.plans.length >= MIN_MAIN_EXERCISES) break
      if (state.plans.some((p) => p.slot === slot)) continue
      const plan = fillSlot(state, slot)
      if (plan) insertPlan(state.plans, plan)
    }
  }
  if (state.plans.length < MIN_MAIN_EXERCISES) {
    let guard = 0
    while (state.plans.length < MIN_MAIN_EXERCISES && guard++ < MIN_MAIN_EXERCISES) {
      const plan = rescuePlan(state, rescueSlot(template).groups)
      if (!plan) break
      insertPlan(state.plans, plan)
    }
  }
  const cappedFocus = template.focus.filter((g) => !UNCAPPED_GROUPS.has(g) && remainingSets(state, g) < MIN_CAPPED_SETS)
  const lightDayFocus: MuscleGroup[] = []
  if (state.plans.length < MIN_MAIN_EXERCISES) {
    // Last resort: whatever still has weekly room (trunk, calves, forearms), then conditioning,
    // which is not direct volume. A capped week becomes a light day, never an empty one.
    let guard = 0
    while (state.plans.length < MIN_MAIN_EXERCISES && guard++ < MIN_MAIN_EXERCISES) {
      const open = openGroups(state).filter((g) => !UNCAPPED_GROUPS.has(g))
      if (open.length === 0) break
      const plan = rescuePlan(state, open, "rescue_open")
      if (!plan) break
      insertPlan(state.plans, plan)
    }
    guard = 0
    while (state.plans.length < MIN_MAIN_EXERCISES && guard++ < MIN_MAIN_EXERCISES) {
      const plan = fillSlot(state, FINISHER_SLOT)
      if (!plan) break
      state.plans.push(plan)
    }
    if (cappedFocus.length > 0 && state.plans.length > 0) lightDayFocus.push(...cappedFocus)
  }
  const availabilityNoted = state.plans.length < MIN_MAIN_EXERCISES && !(cappedFocus.length > 0 && state.plans.length > 0)
  if (availabilityNoted) {
    notes.push(
      state.plans.length === 0
        ? "No exercises match your equipment, limitations and exclusions yet. Review your profile to unlock a full session."
        : `Only ${state.plans.length} exercises match your equipment, limitations and exclusions. Review your profile to unlock a full session.`,
    )
  }
  balancePushPull(state)
  enforceRotation(state)

  const mainExercises = (plans: readonly SlotPlan[]) =>
    plans
      .filter((p) => p.role !== "finisher")
      .slice()
      .sort((a, b) => a.slot.priority - b.slot.priority)
      .map((p) => p.exercise)
  // The warm-up and cool-down are built for the day's lifts; a protected core block that swaps a lift
  // out (C03) has them rebuilt below.
  let lightFocus: MuscleGroup[] = []
  let heavy: MuscleGroup[] = []
  let trained: MuscleGroup[] = []
  let warmup: WorkoutExercise[] = []
  let cooldown: WorkoutExercise[] = []
  const lightSeconds = (items: readonly WorkoutExercise[]) => items.reduce((sum, s) => sum + estimateSlotSeconds(s, lib.get(s.exerciseId)), 0)
  let fixedSeconds = 0
  const buildLight = () => {
    lightFocus = programmedFocus(template, state.plans)
    heavy = [...new Set(state.plans.filter((p) => compoundRole(p.role)).map((p) => muscleGroupOf(p.exercise)))]
    // The light cardio matches the conditioning block's machine or movement (coach round 2, R25). On
    // endurance days the block may still be resized or swapped for a steady block below; a finisher
    // added after the fit is not seen here, which is acceptable.
    const plannedFinisher = state.plans.find((p) => p.role === "finisher")?.exercise ?? null
    warmup = lightItems(
      rng,
      buildWarmup({ pool, profile, focus: lightFocus, heavy, main: mainExercises(state.plans), finisher: plannedFinisher, rng }),
      "warmup",
    )
    trained = [...new Set(state.plans.filter((p) => p.role !== "finisher").map((p) => muscleGroupOf(p.exercise)))]
    cooldown = lightItems(
      rng,
      buildCooldown({ pool, profile, focus: lightFocus, trained, heavy, main: mainExercises(state.plans), rng }),
      "cooldown",
    )
    fixedSeconds = lightSeconds(warmup) + lightSeconds(cooldown)
  }
  buildLight()
  const targetSeconds = profile.durationPreferenceMinutes * 60

  // Pre-fit estimates count the lighter sets the planned load needs: a card with no load budgets
  // the lifter's build-up sets (duration.ts), so the endurance block is not sized into that time.
  const plannedWork = (p: SlotPlan) => {
    if (p.role === "finisher") return p.prescription
    const load = planLoad(p.exercise, p.prescription.reps, p.last ?? null, profile, { rir: p.prescription.rir })
    return { ...p.prescription, recommendedWeightKg: load.weightKg, note: load.note }
  }
  const workSeconds = (plans: readonly SlotPlan[]) =>
    plans.reduce((sum, p) => sum + estimateWorkSeconds(plannedWork(p), "main", p.role, p.exercise), 0)
  // Sets the fitter may still add per group: the weekly cap and this session's share of it.
  const groupRoom = () => {
    const room = new Map<string, number>()
    for (const g of ALL_MUSCLE_GROUPS) {
      const left = remainingSets(state, g)
      if (Number.isFinite(left)) room.set(g, Math.max(0, left))
    }
    return room
  }
  // Spare time may lengthen rests, but only where a coach would (prescriptions.ts restCeiling):
  // heavy lifts up to the goal's longest rest (heavy hypertrophy compounds up to 180 s), everything
  // else near the exercise's own range. A rest-day session is not stretched to fill the time.
  const maxRestFor = (plan: SlotPlan, restSeconds: number, weightKg: number | null): number => {
    if (reduced) return restSeconds
    const ceiling = restCeiling(plan.exercise, profile.goal, plan.role, weightKg)
    if (compoundRole(plan.role)) return Math.max(restSeconds, ceiling)
    return Math.max(restSeconds, ceiling)
  }
  // The time fitter's view of a plan (load, settled RIR, rest from the load, card note). Pure apart
  // from the slot id: the protected-core check (C03) fits copies of the plan with a fixed id.
  const buildFittable = (plan: SlotPlan, ids: Pick<Rng, "uuid">): FittableSlot => {
    const last = plan.last ?? null
    let rx = plan.prescription
    let load = planLoad(plan.exercise, rx.reps, last, profile, { rir: rx.rir })
    if (plan.role !== "finisher") {
      // RIR depends on whether today's load is proven (logged history) or a first guess, which is
      // only known once the load is planned; a maintenance dose or a rest-day session adds one.
      const settled = prescribeRir(plan.exercise, profile.goal, profile.experience, plan.role, { last, weightSource: load.weightSource })
      const rir = settled !== null && (plan.maintenance || reduced) ? Math.min(MAX_RIR, settled + 1) : settled
      if (rir !== rx.rir) {
        rx = { ...rx, rir }
        load = planLoad(plan.exercise, rx.reps, last, profile, { rir })
      }
    }
    let weightKg = load.weightKg
    // A maintenance dose holds the last load: no progression while the group is over its weekly target.
    const held = lastLoggedKg(last)
    if (plan.maintenance && load.weightSource === "history" && weightKg !== null && held !== null && weightKg > held) weightKg = held
    // Coach round 2 (R20): the heavy rest bands are for loads heavy enough to ramp from. Once the
    // load is known, a compound's rest is re-derived from it (a 4 kg press or an empty-bar bench
    // gets the goal's rest); a "find your working weight" card keeps the heavy band.
    if (compoundRole(plan.role) && weightKg !== null && !reduced) {
      const rest = prescribeRest(plan.exercise, profile.goal, plan.role, weightKg)
      if (rest !== rx.restSeconds) rx = { ...rx, restSeconds: rest }
    }
    const note =
      plan.role === "finisher"
        ? plan.note
        : composeSlotNote({ role: plan.role, exercise: plan.exercise, weightKg, load, lead: plan.note, progression: rx.note, experience: profile.experience })
    const slot = toWorkoutExercise(ids, plan.exercise, "main", plan.role, rx, weightKg, note, load.weightSource)
    if (load.loadCheck && weightKg !== null) slot.loadCheck = true
    if (rx.suggestedExerciseId) slot.suggestedExerciseId = rx.suggestedExerciseId
    // A stand-in records the slot it was planned for, so a swap can bring that lift back knowingly.
    if (plan.matchLevel >= 3 && plan.role !== "finisher") {
      slot.intendedSlot = {
        patterns: plan.slot.patterns.slice(),
        groups: plan.slot.groups.slice(),
        ...(plan.slot.mechanics ? { mechanics: plan.slot.mechanics } : {}),
        role: plan.slot.role,
      }
    } else if (plan.role !== "finisher" && plan.slot.kind === "upper_pull" && plan.slot.groups.includes("back") && muscleGroupOf(plan.exercise) === "shoulders") {
      // Rear-delt work in a back pull's place (a face pull for a capped back): the swap list leads
      // with the back pulls the slot was for, not more delt work (coach round 2, R09).
      slot.intendedSlot = { patterns: plan.slot.patterns.slice(), groups: ["back"], role: plan.slot.role }
    }
    const finisher = plan.role === "finisher"
    // Core spec C03: protected trunk work ranks just below the day's compounds (isolation slots go
    // first when whole slots must go) and keeps at least 2 sets.
    const protectedCore = state.coreProtected && isCorePlan(plan)
    const fittable: FittableSlot = {
      slot,
      exercise: plan.exercise,
      // Coach round 2 (R01): a conditioning goal's finisher keeps its protected rounds.
      minSets: finisher
        ? finisherFloor(plan.exercise, plan.prescription, profile.goal)
        : protectedCore
          ? Math.min(MIN_CAPPED_SETS, plan.prescription.sets)
          : plan.prescription.minSets,
      maxSets: plan.prescription.maxSets,
      minRest: finisher ? slot.restSeconds : Math.min(slot.restSeconds, goalRx.rest[0]),
      maxRest: maxRestFor(plan, slot.restSeconds, weightKg),
      priority: finisher && goalRx.conditioning ? CONDITIONING_BLOCK_PRIORITY : protectedCore ? protectedCorePriority(state.plans, plan) : plan.slot.priority,
      group: finisher ? undefined : muscleGroupOf(plan.exercise),
    }
    return fittable
  }
  const planOf = new Map<FittableSlot, SlotPlan>()
  const toFittable = (plan: SlotPlan): FittableSlot => {
    const fittable = buildFittable(plan, rng)
    planOf.set(fittable, plan)
    return fittable
  }
  // Core spec C03: the time fitter run on a copy of a plan (no slot ids drawn from the seed). An
  // endurance block is first sized to the time the lifts leave, as sizeConditioning will size it.
  // A protected core plan's time at its 2-set floor: what an endurance block yields to it (C03).
  const coreYieldSeconds = (core: SlotPlan) =>
    workSeconds([{ ...core, prescription: { ...core.prescription, sets: Math.min(core.prescription.sets, MIN_CAPPED_SETS) } }])
  const fitCopy = (plans: readonly SlotPlan[]) => {
    const copies = new Map<FittableSlot, SlotPlan>()
    const ids = { uuid: () => "fit-check" }
    const lifts = workSeconds(plans.filter((p) => p.role !== "finisher"))
    for (const plan of plans) {
      let sized = plan
      if (plan.role === "finisher" && profile.goal === "endurance") {
        const core = plans.find((p) => p.role !== "finisher" && isCorePlan(p))
        const usual = Math.max(0, finisherBudget(profile) - (core && state.coreProtected ? coreYieldSeconds(core) : 0))
        const budget = Math.max(usual, Math.round(targetSeconds - fixedSeconds - lifts - TRANSITION_SECONDS))
        sized = { ...plan, prescription: prescribeFinisher(plan.exercise, profile.goal, profile.experience, budget) }
      }
      copies.set(buildFittable(sized, ids), plan)
    }
    const kept = fitToDuration(
      trimSupportFirst([...copies.keys()], fixedSeconds, profile.durationPreferenceMinutes, profile.goal),
      fixedSeconds,
      profile.durationPreferenceMinutes,
      profile.goal,
      groupRoom(),
    )
    const sets = new Map<SlotPlan, number>()
    for (const f of kept) sets.set(copies.get(f) as SlotPlan, f.slot.sets)
    return { sets, seconds: fixedSeconds + kept.reduce((sum, f) => sum + estimateSlotSeconds(f.slot, f.exercise), 0) }
  }
  const overCeiling = (seconds: number) =>
    seconds > targetSeconds * FIT_CEILING || Math.round(seconds / 60) > profile.durationPreferenceMinutes * FIT_CEILING
  let withoutCore: ReturnType<typeof fitCopy> | null = null
  /**
   * `plans` with the core plan against today's plan without it, an endurance block sized as
   * sizeConditioning would size it. An estimate that picks the drill and the way in; the finished
   * day is checked exactly at the end (keepsCompounds).
   */
  const protectedCoreFits = (plans: readonly SlotPlan[], core: SlotPlan, dropped: SlotPlan | null): boolean => {
    const before = (withoutCore ??= fitCopy(state.plans))
    const fitted = fitCopy(plans)
    if (!fitted.sets.has(core)) return false
    // Every compound keeps the sets it would have had without core (never below its prescription).
    // On a day that balances pressing with pulling, so does every pull: a pull that lost a set to
    // core would take a press set with it (the push/pull balance after the fit).
    const balanced = balancesPushPull(state.template)
    for (const plan of plans) {
      if (!compoundRole(plan.role) && !(balanced && isPull(plan))) continue
      const was = before.sets.get(plan)
      if (was === undefined) continue
      const after = fitted.sets.get(plan)
      if (after === undefined || after < Math.min(was, plan.prescription.sets)) return false
    }
    // Nothing else the day kept is dropped for it, and the session stays within its ceiling (or no
    // further over it than it already was).
    for (const plan of before.sets.keys()) {
      // (An endurance block swapped by sizeConditioning is the same block for this purpose.)
      if (plan !== dropped && plan.role !== "finisher" && !fitted.sets.has(plan)) return false
    }
    if (overCeiling(fitted.seconds) && (!overCeiling(before.seconds) || fitted.seconds > before.seconds)) return false
    return true
  }
  // Core spec C03: a protected core day gets its trunk work before the endurance block is sized, so
  // the block takes the time left after it (never below its protected rounds).
  const protectedCore = ensureProtectedCore(state, (plans, core, dropped) => protectedCoreFits(plans, core, dropped))
  // A swapped-out lift no longer needs its primer or stretch; trunk work changes the trained groups.
  if (protectedCore) buildLight()
  // Endurance: the conditioning block takes the time the capped lifting leaves (coach round 2, R17).
  if (profile.goal === "endurance" && !reduced) {
    const core = protectedCore ? coreYieldSeconds(protectedCore.core) : 0
    sizeConditioning(state, targetSeconds - fixedSeconds - workSeconds(state.plans.filter((p) => p.role !== "finisher")), core)
  }
  // Spare time: grow towards the top of the slot range with the template's own slots before the
  // fitter adds sets. A rest-day session is never padded.
  const planSeconds = () => fixedSeconds + workSeconds(state.plans)
  const used = new Set<SlotSpec>(state.plans.map((p) => p.slot))
  const short = () => !reduced && roomForLift(state) && planSeconds() < targetSeconds * FIT_FLOOR
  for (const spare of spareSlots(template, [...used, ...slots])) {
    if (!short()) break
    const plan = fillSlot(state, spare)
    if (plan) insertPlan(state.plans, plan)
  }
  // Still short at the slot ceiling because the day's groups are at their share of the cap:
  // trunk work is short and was trimmed only for time, so it comes back (within the goal's
  // lifting cap).
  const liftCap = liftingSlotCap(profile.durationPreferenceMinutes, profile.goal)
  if (
    !reduced &&
    liftCount(slotCounted(state)) < liftCap &&
    planSeconds() < targetSeconds * FIT_FLOOR &&
    !state.plans.some((p) => p.slot.kind === "core" || p.exercise.category === "core")
  ) {
    const coreSlot = template.slots.find((s) => s.kind === "core")
    const plan = coreSlot ? fillSlot(state, coreSlot) : null
    if (plan) insertPlan(state.plans, plan)
  }

  orderPlans(state.plans)
  // Support work gives up time first (and, for conditioning goals, before the finisher); the
  // fitter then handles the compounds, the rests and, last, whole slots.
  const fit = (slotsToFit: FittableSlot[]) =>
    fitToDuration(
      trimSupportFirst(slotsToFit, fixedSeconds, profile.durationPreferenceMinutes, profile.goal),
      fixedSeconds,
      profile.durationPreferenceMinutes,
      profile.goal,
      groupRoom(),
    )
  // After a fit the plan is what the fitter kept, with the sets it settled on: later additions are
  // judged against that, not against the pre-fit plan.
  const syncToKept = (kept: FittableSlot[]) => {
    const keptPlans = new Set(kept.map((f) => planOf.get(f)))
    state.plans = state.plans.filter((p) => keptPlans.has(p))
    state.plannedSets = new Map()
    for (const f of kept) {
      const plan = planOf.get(f)
      if (!plan || plan.role === "finisher") continue
      plan.prescription.sets = f.slot.sets
      for (const g of cappedGroupsOf(plan.exercise, muscleGroupOf(plan.exercise))) state.plannedSets.set(g, (state.plannedSets.get(g) ?? 0) + f.slot.sets)
    }
  }
  // What each compound was prescribed before the time fitter (C03 check at the end).
  const prescribedSets = new Map(state.plans.filter((p) => compoundRole(p.role)).map((p) => [`${p.role}:${p.exercise.id}`, p.prescription.sets]))
  let kept = fit(state.plans.map(toFittable))
  syncToKept(kept)
  const keptSeconds = () => fixedSeconds + kept.reduce((sum, f) => sum + estimateSlotSeconds(f.slot, f.exercise), 0)
  const stillShort = () => keptSeconds() < targetSeconds * FIT_FLOOR

  const addPlan = (plan: SlotPlan) => {
    state.plans.push(plan)
    kept = fit([...kept, toFittable(plan)])
    syncToKept(kept)
  }
  // Template slots exhausted and still short once sets and rests have grown (bodyweight-only):
  // one accessory at a time for the focus group with the fewest sets, never a repeat of a movement
  // already in the day.
  const rescueShort = (room: () => boolean) => {
    let guard = 0
    while (!reduced && stillShort() && room() && guard++ < 3) {
      const plan = rescuePlan(state, rescueSlot(template).groups)
      if (!plan) break
      addPlan(plan)
    }
  }
  // Endurance gives its conditioning blocks the first claim on the time (below).
  const endurance = profile.goal === "endurance"
  if (!endurance) rescueShort(() => roomForLift(state))
  // Every group is at its share of the weekly cap and time is left: conditioning goals close with
  // a second, different conditioning block (not direct volume) rather than padding rests or
  // overshooting the cap. Other goals never get a time-filling finisher, and a thirty-minute
  // session has room for one block only.
  // Endurance sessions of an hour or more may take a third block: conditioning is that goal's main
  // work, and a beginner's weekly caps leave little lifting to fill the time (coach round 2, R17).
  const maxFinishers =
    reduced || !goalRx.conditioning
      ? 0
      : profile.durationPreferenceMinutes <= 30
        ? 1
        : profile.goal === "endurance" && profile.durationPreferenceMinutes >= 60
          ? 3
          : 2
  for (let i = 0; i < maxFinishers; i++) {
    if (!stillShort()) break
    if (kept.filter((f) => f.slot.role === "finisher").length >= maxFinishers) break
    const plan = fillSlot(state, FINISHER_SLOT)
    if (!plan) break
    addPlan(plan)
  }
  // Endurance had its conditioning first: when the blocks are maxed out and the session is still
  // short (a beginner's weekly caps leave two sets a lift), the template's own lifts, then rescue
  // lifts, fill the rest within the slot range rather than leaving a 60-minute plan at 40.
  if (endurance && !reduced) {
    const inRange = () => slotCounted(state).length < mainSlotRange(profile.durationPreferenceMinutes)[1]
    for (const spare of spareSlots(template, state.plans.map((p) => p.slot))) {
      if (!stillShort() || !inRange()) break
      const plan = fillSlot(state, spare)
      if (plan) addPlan(plan)
    }
    rescueShort(inRange)
  }
  // On full-body and upper days pulling keeps up with pressing: a pull gains a set while the session
  // stays within the preference; otherwise a support press gives one up; otherwise a set moves to
  // the pull from support work that is neither (trunk, isolation), or from a primary press of five
  // or more sets (5 x 5 bench with 2 x 5 rows becomes 4 and 3). Weekly caps still bound every pull.
  if (balancesPushPull(template)) {
    const isPress = (f: FittableSlot) => f.slot.role !== "finisher" && pushes(f.exercise) && f.exercise.mechanics === "compound"
    const isPullSlot = (f: FittableSlot) => f.slot.role !== "finisher" && pulls(f.exercise)
    const setsOf = (pred: (f: FittableSlot) => boolean) => kept.filter(pred).reduce((sum, f) => sum + f.slot.sets, 0)
    const charged = (f: FittableSlot) => cappedGroupsOf(f.exercise, muscleGroupOf(f.exercise))
    const change = (f: FittableSlot, delta: 1 | -1) => {
      f.slot.sets += delta
      const plan = planOf.get(f)
      if (plan) plan.prescription.sets = f.slot.sets
      for (const g of charged(f)) state.plannedSets.set(g, (state.plannedSets.get(g) ?? 0) + delta)
    }
    const oneMoreSet = (f: FittableSlot) => {
      const now = estimateSlotSeconds(f.slot, f.exercise)
      const more = estimateSlotSeconds({ ...f.slot, sets: f.slot.sets + 1 }, f.exercise)
      return more - now
    }
    const trimmable = (f: FittableSlot) => f.slot.sets > Math.max(MIN_CAPPED_SETS, f.minSets)
    let guard = 0
    while (setsOf(isPullSlot) < setsOf(isPress) && guard++ < 16) {
      const grow = kept
        .filter((f) => isPullSlot(f) && f.slot.sets < f.maxSets && charged(f).every((g) => remainingSets(state, g) > 0))
        .sort((a, b) => a.slot.sets - b.slot.sets || a.priority - b.priority)[0]
      const trim = kept
        .filter((f) => isPress(f) && f.slot.role !== "primary_compound" && trimmable(f))
        .sort((a, b) => b.priority - a.priority || b.slot.sets - a.slot.sets)[0]
      const lender =
        kept
          .filter((f) => f.slot.role !== "finisher" && !compoundRole(f.slot.role) && !isPress(f) && !isPullSlot(f) && trimmable(f))
          .sort((a, b) => b.priority - a.priority || b.slot.sets - a.slot.sets)[0] ??
        kept.find((f) => isPress(f) && f.slot.role === "primary_compound" && f.slot.sets >= 5 && trimmable(f))
      if (grow && keptSeconds() + oneMoreSet(grow) <= targetSeconds) change(grow, 1)
      else if (trim) change(trim, -1)
      else if (grow && lender) {
        change(lender, -1)
        change(grow, 1)
      } else break
    }
  }
  const finalPlans = kept.map((f) => planOf.get(f)).filter((p): p is SlotPlan => p !== undefined)
  orderPlans(finalPlans)
  const fittableOf = new Map(kept.map((f) => [planOf.get(f), f]))
  const ordered = finalPlans.map((p) => fittableOf.get(p)).filter((f): f is FittableSlot => f !== undefined)
  const main = ordered.map((f) => f.slot)
  const mainSeconds = ordered.reduce((sum, f) => sum + estimateSlotSeconds(f.slot, f.exercise), 0)
  // Coach round 2 (R18): sessions of an hour or less get a short cool-down, unless the main work
  // cannot fill the time (a beginner's bodyweight push day): then the long cool-down comes back.
  if (fixedSeconds + mainSeconds < targetSeconds * FIT_FLOOR) {
    const before = lightSeconds(cooldown)
    cooldown = lightItems(
      rng,
      buildCooldown({ pool, profile, focus: lightFocus, trained, heavy, main: mainExercises(finalPlans), extended: true, rng }),
      "cooldown",
    )
    fixedSeconds += lightSeconds(cooldown) - before
  }
  const groupNotes = heavyGroupNotes(state, finalPlans, lightDayFocus, availabilityNoted)
  notes.push(...groupNotes)
  notes.push(...limitationNotes(leftOut, groupNotes))
  // Coach round 2 (R17): two or three days a week with a short finisher is not an aerobic base.
  if (goalRx.conditioning && !reduced && profile.trainingDaysPerWeek <= 3) {
    const today = ordered
      .filter((f) => f.slot.role === "finisher" || muscleGroupOf(f.exercise) === "cardio")
      .reduce((sum, f) => sum + conditioningWorkSeconds(f.slot.sets, f.slot.reps, f.slot.durationSeconds), 0)
    const minutes = (conditioningSecondsLast7(input.history, date, lib) + today) / 60
    if (minutes < AEROBIC_NOTE_MINUTES) notes.push(aerobicNote(minutes))
  }

  const workout: Workout = {
    id: workoutId,
    date,
    title: template.title,
    split: template.split,
    focus: programmedFocus(template, finalPlans),
    goal: profile.goal,
    estimatedMinutes: Math.max(1, Math.round((fixedSeconds + mainSeconds) / 60)),
    exercises: [...warmup, ...main, ...cooldown],
    generatedAt: input.now,
    seed,
    engineVersion: ENGINE_VERSION,
  }
  if (notes.length > 0) workout.notes = notes
  // Core spec C03, checked on the finished day: an added protected core block never costs a primary
  // or secondary compound a set it would have had without it (below what was prescribed), nor takes
  // the session past its ceiling. The time checks above are estimates; when the finished day breaks
  // either rule, the day is planned without the block and the catch-up retries next session.
  if (protectedCore && finalPlans.includes(protectedCore.core)) {
    const off = generateWorkout(input, lib, { ...options, coreProtection: false })
    if (!keepsCompounds(workout, off, prescribedSets, profile.durationPreferenceMinutes)) return off
  }
  return workout
}

/**
 * Whether `on` (with a protected core block) keeps every primary and secondary compound of `off`
 * (the same day without it) at its sets, or at least at what was prescribed when `off` grew it into
 * spare time, and stays within the session ceiling unless `off` is over it too.
 */
function keepsCompounds(on: Workout, off: Workout, prescribed: ReadonlyMap<string, number>, minutes: number): boolean {
  const compound = (e: WorkoutExercise) => e.phase === "main" && compoundRole(e.role)
  for (const was of off.exercises.filter(compound)) {
    const now = on.exercises.find((e) => compound(e) && e.exerciseId === was.exerciseId && e.role === was.role)
    if (!now || now.sets < Math.min(was.sets, prescribed.get(`${was.role}:${was.exerciseId}`) ?? was.sets)) return false
  }
  // The time fitter's own ceiling: the card's minutes never past the preference × FIT_CEILING.
  return on.estimatedMinutes <= minutes * FIT_CEILING || on.estimatedMinutes <= off.estimatedMinutes
}
