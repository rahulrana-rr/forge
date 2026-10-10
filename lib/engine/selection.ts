/**
 * Candidate filtering and scoring for main-phase slots.
 */
import { getExercise, muscleGroupOf, muscleGroupsOf } from "@/lib/exercises"
import {
  DIFFICULTY_RANK,
  type BodyArea,
  type Equipment,
  type Exercise,
  type ExerciseCategory,
  type Goal,
  type Muscle,
  type MovementPattern,
  type MuscleGroup,
} from "@/lib/exercises/types"
import type { CompletedExercise, CompletedWorkout, Experience, UserProfile } from "@/lib/domain/types"
import type { Rng } from "./random"
import type { RecoveryMap } from "./recovery"
import type { SlotKind, SlotSpec } from "./splits"
import { FINISHER_MAX_BLOCK_SECONDS, GOAL_PRESCRIPTIONS, prescribeReps, repRangeFitsGoal, type MainRole } from "./prescriptions"

/** Categories that belong in the main phase. */
const MAIN_CATEGORIES: ReadonlySet<ExerciseCategory> = new Set<ExerciseCategory>([
  "chest", "back", "shoulders", "biceps", "triceps", "legs", "glutes", "core", "full_body", "cardio",
])

/** Compound lifts preferred for primary slots when the user can do them. */
export const CANONICAL_COMPOUNDS: ReadonlySet<string> = new Set([
  "barbell-bench-press", "incline-dumbbell-press", "dumbbell-bench-press", "machine-chest-press",
  "overhead-press", "seated-dumbbell-shoulder-press", "pull-up", "lat-pulldown", "bent-over-barbell-row",
  "seated-cable-row", "single-arm-dumbbell-row", "barbell-back-squat", "goblet-squat", "leg-press",
  "romanian-deadlift", "conventional-deadlift", "trap-bar-deadlift", "barbell-hip-thrust", "bulgarian-split-squat",
])

const BEGINNER_FRIENDLY: ReadonlySet<Equipment> = new Set<Equipment>(["machine", "dumbbell", "bodyweight", "cable", "kettlebell", "band"])
/** Goals whose accessories should be progressively loadable. */
const LOADABLE_GOALS: ReadonlySet<Goal> = new Set<Goal>(["strength", "muscle_gain"])
const LOWER_GROUPS: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(["quads", "hamstrings", "glutes", "calves"])
const UPPER_GROUPS: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(["chest", "back", "shoulders", "biceps", "triceps", "forearms"])
const UPPER_KINDS: ReadonlySet<SlotKind> = new Set<SlotKind>(["upper_push", "upper_pull", "shoulders", "arms"])

/**
 * A slot never crosses the body: an upper-body slot is never filled by a squat or a hinge
 * through a secondary muscle, a lower-body slot never by a press, and whole-body lifts
 * (thrusters, clean variations) only fill the general rescue slot. Without this a capped back
 * turns a pull day's primary into a deadlift and the next leg day is no longer fresh.
 */
const PUSH_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>(["horizontal_push", "vertical_push", "elbow_extension"])
const PULL_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>(["horizontal_pull", "vertical_pull", "elbow_flexion"])

/**
 * A pulling slot (rows, pulldowns, curls, rear-delt work) is never filled by a press, and a
 * pressing slot never by a pull, however the secondary muscles overlap: a pike push-up lists
 * the traps, a pull-up the rear delts, and neither belongs on the other's day.
 */
export function directionAllows(exercise: Exercise, slot: SlotSpec): boolean {
  if (slot.patterns.length === 0) return true
  if (slot.patterns.every((p) => PULL_PATTERNS.has(p))) return exercise.force !== "push" && !PUSH_PATTERNS.has(exercise.movementPattern)
  if (slot.patterns.every((p) => PUSH_PATTERNS.has(p))) return exercise.force !== "pull" && !PULL_PATTERNS.has(exercise.movementPattern)
  return true
}

export function regionAllows(exercise: Exercise, slot: SlotSpec): boolean {
  const group = muscleGroupOf(exercise)
  if (group === "full_body" || group === "cardio") return slot.kind === "general" || slot.groups.includes(group)
  if (UPPER_KINDS.has(slot.kind)) return !LOWER_GROUPS.has(group)
  if (slot.kind === "lower") return !UPPER_GROUPS.has(group)
  return true
}

/**
 * Guards every main (non-conditioning) slot applies at every match level: no conditioning or
 * stretching, core work only in core slots (or the general rescue slot), and never across the
 * body or the push/pull line. Generation and the swap picker share them.
 */
export function mainSlotAllows(exercise: Exercise, slot: SlotSpec): boolean {
  if (isConditioning(exercise)) return false
  if (exercise.movementPattern === "stretch" || exercise.movementPattern === "mobility") return false
  // Core work only fills core slots (or a general rescue slot); it never stands in for a press or a row.
  if (exercise.category === "core" && slot.kind !== "core" && slot.kind !== "general" && !slot.groups.includes("core")) return false
  return regionAllows(exercise, slot) && directionAllows(exercise, slot)
}

/** The slot kind a set of patterns and groups describes (the inverse of the templates' kinds). */
export function inferSlotKind(patterns: readonly MovementPattern[], groups: readonly MuscleGroup[]): SlotKind {
  if (groups.length > 0 && groups.every((g) => g === "core")) return "core"
  if (groups.some((g) => g === "full_body" || g === "cardio")) return "general"
  if (groups.length > 0 && groups.every((g) => LOWER_GROUPS.has(g))) return "lower"
  if (groups.length > 0 && groups.every((g) => UPPER_GROUPS.has(g))) {
    if (patterns.length > 0 && patterns.every((p) => PUSH_PATTERNS.has(p))) return "upper_push"
    if (patterns.length > 0 && patterns.every((p) => PULL_PATTERNS.has(p))) return "upper_pull"
    return groups.every((g) => g === "shoulders") ? "shoulders" : "arms"
  }
  return "general"
}

/**
 * The slot an exercise is doing a job for, described from the exercise itself: its pattern, its
 * primary group and (for the heavy slots) its mechanics. The swap picker holds replacements to it.
 */
export function slotSpecFor(exercise: Exercise, role: MainRole): SlotSpec {
  const groups: MuscleGroup[] = [muscleGroupOf(exercise)]
  const patterns: MovementPattern[] = [exercise.movementPattern]
  const compound = role === "primary_compound" || role === "secondary_compound"
  return {
    key: "current",
    role,
    patterns,
    groups,
    mechanics: compound ? exercise.mechanics : undefined,
    priority: 0,
    kind: exercise.category === "core" ? "core" : inferSlotKind(patterns, groups),
  }
}

export type ExerciseLookup = (id: string) => Exercise | undefined

/**
 * The root of an exercise's variationOf chain (b-stance hip thrust → dumbbell hip thrust →
 * barbell hip thrust). A parent missing from the lookup still names the family.
 */
export function familyRoot(exercise: Exercise, lookup: ExerciseLookup): string {
  let id = exercise.id
  let parent = exercise.variationOf
  const seen = new Set<string>([id])
  while (parent && !seen.has(parent)) {
    seen.add(parent)
    id = parent
    parent = lookup(parent)?.variationOf
  }
  return id
}

/**
 * Small muscles that get one direct exercise per session: a second forearm or rear-delt lift
 * (reverse curl plus wrist curl, face pull plus reverse pec deck) only stacks joint stress.
 */
const ONE_PER_SESSION: ReadonlySet<Muscle> = new Set<Muscle>(["forearms", "rear_delts"])

/**
 * Whether two exercises are the same work for one session: the same variation family (resolved
 * transitively), two lifts that list each other as alternatives (JM press and skull crusher), or
 * a second direct lift for a small muscle that only needs one.
 */
export function isRedundantWith(candidate: Exercise, other: Exercise, lookup: ExerciseLookup): boolean {
  if (candidate.id === other.id) return true
  if (familyRoot(candidate, lookup) === familyRoot(other, lookup)) return true
  if (candidate.alternativeExercises.includes(other.id) && other.alternativeExercises.includes(candidate.id)) return true
  return ONE_PER_SESSION.has(candidate.primaryMuscle) && candidate.primaryMuscle === other.primaryMuscle
}

const LOOKUPS = new WeakMap<readonly Exercise[], ExerciseLookup>()

/** An id lookup over a pool, built once per pool. */
export function lookupFor(pool: readonly Exercise[]): ExerciseLookup {
  let lookup = LOOKUPS.get(pool)
  if (!lookup) {
    const byId = new Map(pool.map((e) => [e.id, e]))
    lookup = (id) => byId.get(id)
    LOOKUPS.set(pool, lookup)
  }
  return lookup
}

/**
 * An unloaded plyometric (jumps, bounds, clap push-ups) is power work, not a loaded accessory. In a
 * strength or hypertrophy block it may only open the day; it never fills a secondary, accessory or
 * isolation slot after the heavy lifts.
 */
export function isUnloadedPlyometric(exercise: Exercise): boolean {
  return !!exercise.tags?.includes("explosive") && exercise.loadType !== "external" && exercise.loadType !== "assisted"
}

export function isMainCategory(exercise: Exercise): boolean {
  return MAIN_CATEGORIES.has(exercise.category)
}

/**
 * Bodyweight needs no kit, so it is always available even if a stored list lacks it. A lift
 * unracked from a rack or stands (tag "needs_rack": back squat, bench press, inverted row) also
 * needs the "rack" the full_gym and home_gym presets include.
 */
export function equipmentAllowed(exercise: Exercise, equipment: readonly Equipment[]): boolean {
  if (exercise.tags?.includes("needs_rack") && !equipment.includes("rack")) return false
  return exercise.equipment.every((e) => e === "bodyweight" || equipment.includes(e))
}

/**
 * Kit the Equipment list cannot name yet (lib/exercises/types.ts data tags): an adjustable bench
 * for incline and decline work, a bench high enough to row under, battle ropes. Until onboarding
 * asks about them only the full_gym preset is assumed to have them; a custom kit list is not (R26).
 */
export const FULL_GYM_KIT_TAGS: readonly string[] = ["needs_adjustable_bench", "needs_elevated_bench", "needs_battle_rope"]

/** Whether the user's preset has the unlisted kit an exercise's tags ask for. Unknown preset: allowed. */
export function kitTagsAllowed(exercise: Exercise, profile: Partial<Pick<UserProfile, "equipmentPreset">>): boolean {
  if (profile.equipmentPreset === undefined || profile.equipmentPreset === "full_gym") return true
  return !exercise.tags?.some((t) => FULL_GYM_KIT_TAGS.includes(t))
}

/** Band-only work: its tension cannot be logged in kilograms, so the load never progresses. */
export function isBandOnly(exercise: Exercise): boolean {
  return exercise.equipment.length > 0 && exercise.equipment.every((e) => e === "band")
}

/**
 * Work the load of which can be raised session to session (a weight, or assistance taken off).
 * A band-only lift is not: its tension is not logged in kilograms (R13).
 */
export function isLoadable(exercise: Exercise): boolean {
  return (exercise.loadType === "external" || exercise.loadType === "assisted") && !isBandOnly(exercise)
}

/** Implements whose load is logged in kilograms: what "owning equipment for a pattern" means. */
const GYM_IMPLEMENTS: ReadonlySet<Equipment> = new Set<Equipment>([
  "barbell", "dumbbell", "kettlebell", "cable", "machine", "smith_machine", "trap_bar", "ez_bar",
])

/**
 * Core spec C11: trunk work whose load can rise: a loadable lift (cable or machine crunch, cable
 * Pallof press, woodchops, landmine rotation, weighted dead bug or crunch), or a core-category timed
 * drill done with a gym implement (suitcase carry, weighted plank).
 */
export function loadableTrunk(exercise: Exercise): boolean {
  if (isLoadable(exercise)) return true
  return exercise.category === "core" && exercise.loadType === "timed" && exercise.equipment.some((e) => GYM_IMPLEMENTS.has(e))
}

/**
 * Core spec C07: trunk pattern families. Anti-lateral covers anti-lateral flexion and core-category
 * carries; flexion_rotation covers trunk flexion, rotation and dynamic side bends (data tag
 * "lateral_flexion"). Hip extension (back extensions, supermans) and conditioning drills have none.
 */
export type CoreFamily = "anti_extension" | "anti_rotation" | "anti_lateral" | "flexion_rotation"

export const CORE_FAMILIES: readonly CoreFamily[] = ["anti_extension", "anti_rotation", "anti_lateral", "flexion_rotation"]

/** The trunk family an exercise trains, or null when it is not direct trunk work. */
export function coreFamily(exercise: Exercise): CoreFamily | null {
  if (isConditioning(exercise)) return null
  if (exercise.category !== "core" && muscleGroupOf(exercise) !== "core") return null
  // A dumbbell side bend is dynamic lateral flexion, whatever pattern the data gives it (D02).
  if (exercise.tags?.includes("lateral_flexion")) return "flexion_rotation"
  switch (exercise.movementPattern) {
    case "anti_extension":
      return "anti_extension"
    case "anti_rotation":
      return "anti_rotation"
    case "anti_lateral_flexion":
      return "anti_lateral"
    case "carry":
      return exercise.category === "core" ? "anti_lateral" : null
    case "trunk_flexion":
    case "rotation":
      return "flexion_rotation"
    default:
      return null
  }
}

const ALL_BRACING: ReadonlySet<CoreFamily> = new Set<CoreFamily>(["anti_extension", "anti_rotation", "anti_lateral"])
const STRENGTH_EMPHASIS: ReadonlySet<CoreFamily> = new Set<CoreFamily>(["anti_extension", "anti_lateral"])
const HYPERTROPHY_EMPHASIS: ReadonlySet<CoreFamily> = new Set<CoreFamily>(["flexion_rotation"])
const CONDITIONING_EMPHASIS: ReadonlySet<CoreFamily> = new Set<CoreFamily>(["anti_rotation", "anti_lateral"])

/**
 * Core spec C08: the families a goal and level lean towards (+3 in a core slot). Beginners start with
 * anti-movement drills they can self-check; strength lifters need anti-extension and anti-lateral
 * flexion; hypertrophy lifters need loaded flexion; conditioning goals anti-rotation and anti-lateral
 * work. Coaching judgment.
 */
export function coreEmphasis(goal: Goal, experience: Experience): ReadonlySet<CoreFamily> {
  if (experience === "beginner") return ALL_BRACING
  if (goal === "strength") return STRENGTH_EMPHASIS
  if (goal === "muscle_gain") return HYPERTROPHY_EMPHASIS
  return CONDITIONING_EMPHASIS
}

/** Core spec C08: flexion and rotation at most once a week, except for trained hypertrophy lifters. */
export function flexionCapped(goal: Goal, experience: Experience): boolean {
  return !(goal === "muscle_gain" && experience !== "beginner")
}

/** Core-slot scoring weights (core spec C07-C12, C20). Coaching judgment, tuned against the core audit. */
export const CORE_SCORE = {
  /** A family with no direct core set in the rolling 7 days. */
  missingFamily: 8,
  /** The family of the most recent core session. */
  lastFamily: -6,
  /** A goal-emphasis family. */
  emphasis: 3,
  /** Flexion or rotation once the week already has a flexion exposure (capped goals). */
  flexionCap: -8,
  /** Flexion or rotation for a lower-back-flagged user. */
  lowerBackFlexion: -4,
  /** Loadable trunk work for a trained strength or hypertrophy lifter. */
  loadedTrunk: 4,
  /** A hip-flexor-led floor drill where a better option exists. */
  hipFlexorLed: -4,
  /** A same-structure conflict with a lift already in the day (lower back, shoulder, grip). */
  overlap: -8,
} as const

/**
 * Whether the slot offers a loadable lift of the same movement on the user's own kit (a cable fly
 * for a band fly, a machine row for a doorway row). Peers already passed the profile filter.
 */
function ownsKitFor(exercise: Exercise, peers: readonly Exercise[] | undefined): boolean {
  return !!peers?.some(
    (p) => p.id !== exercise.id && p.movementPattern === exercise.movementPattern && isLoadable(p) && p.equipment.some((e) => GYM_IMPLEMENTS.has(e)),
  )
}

/** Held positions and inverted work: not what a compound slot's sets of reps are for. */
function isHoldOrInversion(exercise: Exercise): boolean {
  if (exercise.loadType === "timed" || (!exercise.repRange && !!exercise.durationRange)) return true
  return !!exercise.tags?.some((t) => t === "isometric" || t === "inversion")
}

export function difficultyAllowed(exercise: Exercise, experience: Experience): boolean {
  return DIFFICULTY_RANK[exercise.difficulty] <= DIFFICULTY_RANK[experience]
}

export function limitationsAllow(exercise: Exercise, profile: Pick<UserProfile, "limitations">): boolean {
  return !exercise.contraindications.some((area) => profile.limitations.includes(area))
}

/** Hard filter every exercise must pass for this user, regardless of slot. */
export function passesProfileFilter(exercise: Exercise, profile: UserProfile): boolean {
  return (
    equipmentAllowed(exercise, profile.equipment) &&
    kitTagsAllowed(exercise, profile) &&
    difficultyAllowed(exercise, profile.experience) &&
    limitationsAllow(exercise, profile) &&
    !profile.excludedExerciseIds.includes(exercise.id)
  )
}

export function goalCompatible(exercise: Exercise, goal: Goal): boolean {
  return exercise.goalCompatibility.length === 0 || exercise.goalCompatibility.includes(goal)
}

/**
 * Conditioning work: cardio, conditioning and locomotion patterns, timed or distance full-body work
 * (farmer's carries, sled pushes), and (core spec C13) a core-category drill tagged "conditioning"
 * (mountain climbers): done fast on the hands it is a conditioning drill with little bracing
 * stimulus, so it never fills a core slot or counts as trunk work, and may be a finisher.
 */
export function isConditioning(exercise: Exercise): boolean {
  if (exercise.category === "cardio") return true
  if (exercise.category === "core" && !!exercise.tags?.includes("conditioning")) return true
  if (exercise.movementPattern === "conditioning" || exercise.movementPattern === "locomotion") return true
  return exercise.category === "full_body" && (exercise.loadType === "timed" || exercise.loadType === "distance")
}

/** Technique-limited lifts that are never done tired: multi-move complexes and the Olympic lifts. */
const NOT_A_FINISHER_TAGS: readonly string[] = ["complex", "olympic"]

/**
 * Whether an exercise can be the conditioning finisher: conditioning work, never a steady-state
 * block (20-minute walks, marching in place, continuous rope skipping) and never a complex or an
 * Olympic lift done under fatigue (man makers, devil presses). A block whose own minimum is the
 * finisher ceiling or longer is steady work too, tagged or not. Generation and the replace picker
 * both use this.
 */
export function fitsFinisher(exercise: Exercise): boolean {
  if (!isConditioning(exercise)) return false
  const tags = exercise.tags ?? []
  if (tags.some((t) => NOT_A_FINISHER_TAGS.includes(t))) return false
  if (tags.includes("steady_state")) return false
  return !(exercise.durationRange && exercise.durationRange[0] >= FINISHER_MAX_BLOCK_SECONDS)
}

/**
 * Slot match levels, strictest first. The first level yielding a candidate wins so a slot
 * degrades gracefully (e.g. every chest exercise excluded → press through secondary chest).
 *
 * For slots that pin mechanics (the compounds), the mechanics matter more than the exact
 * pattern: a pull-day primary without a vertical pull becomes a row, never a shrug.
 */
export type MatchLevel = 0 | 1 | 2 | 3 | 4

export function matchesSlot(exercise: Exercise, slot: SlotSpec, level: MatchLevel): boolean {
  if (slot.kind === "conditioning") {
    if (!fitsFinisher(exercise)) return false
    return level > 1 || slot.patterns.includes(exercise.movementPattern)
  }
  if (!mainSlotAllows(exercise, slot)) return false
  // Secondary-muscle stand-ins (levels 3–4) only fill the heavy slots, so a day never loses its
  // main lifts. Anywhere else an empty slot is better: a pull-up does not stand in for lateral
  // raises, a face pull for a capped back accessory, or push-ups for a capped core, and the
  // rescue slot only takes exercises whose own primary group is one it asks for.
  if (level >= 3 && slot.role !== "primary_compound" && slot.role !== "secondary_compound") return false
  const primary = muscleGroupOf(exercise)
  const patternOk = slot.patterns.includes(exercise.movementPattern)
  const primaryOk = slot.groups.includes(primary)
  const anyGroupOk = muscleGroupsOf(exercise).some((g) => slot.groups.includes(g))
  const mechanicsOk = !slot.mechanics || exercise.mechanics === slot.mechanics
  switch (level) {
    case 0:
      return patternOk && primaryOk && mechanicsOk
    case 1:
      return slot.mechanics ? primaryOk && mechanicsOk : patternOk && primaryOk
    case 2:
      return primaryOk
    case 3:
      // A compound slot's stand-in is still a compound: a rear-delt fly does not replace a row.
      return patternOk && anyGroupOk && mechanicsOk
    case 4:
    default:
      return anyGroupOk && exercise.mechanics === "compound"
  }
}

export interface SlotCandidateOptions {
  /**
   * Groups still under the weekly set cap. When given, only exercises whose primary group is
   * open are candidates, at every level; a level with matches but none open is skipped.
   */
  openGroups?: readonly MuscleGroup[]
  /** Exercise ids already in the workout (never repeated). */
  taken?: ReadonlySet<string>
  /** Extra ids to exclude for this call. */
  exclude?: ReadonlySet<string>
  /**
   * Exercises already in the session. When given, a candidate that is the same work as one of
   * them (see isRedundantWith) is never offered; a level whose matches are all redundant is
   * skipped like a capped one.
   */
  chosen?: readonly Exercise[]
}

export interface SlotCandidates {
  level: MatchLevel
  exercises: Exercise[]
}

/**
 * Goal rules that hold for a slot whatever the score. In strength and hypertrophy blocks an
 * unloaded plyometric (broad jump, skater jump) never fills a slot after the primary lift; the
 * user can still opt in through their favourites.
 */
function goalAllowsInSlot(exercise: Exercise, slot: SlotSpec, profile: UserProfile): boolean {
  if (slot.role === "primary_compound" || slot.role === "finisher") return true
  if (!LOADABLE_GOALS.has(profile.goal) || profile.preferredExerciseIds.includes(exercise.id)) return true
  return !isUnloadedPlyometric(exercise)
}

/**
 * A bodyweight lift whose programmed window starts above the goal's top rep (incline push-ups at
 * 10–12 in a 3–6 strength block): it cannot be made heavy enough for the goal.
 */
function startsAboveGoal(exercise: Exercise, goal: Goal, role: MainRole): boolean {
  if (exercise.loadType !== "bodyweight") return false
  const window = prescribeReps(exercise, goal, role)
  return !!window && window[0] > GOAL_PRESCRIPTIONS[goal].reps[1]
}

/**
 * A hamstring-led slot that also takes glute work (iso_hams: knee flexion or hip extension). With no
 * leg curl in the kit, a hamstring hinge (dumbbell RDL) is the hamstring work, not a glute drill.
 */
function hamstringLed(slot: SlotSpec): boolean {
  return slot.groups[0] === "hamstrings" && slot.groups.length > 1 && slot.patterns.includes("knee_flexion")
}

/** Candidates for a slot, taken from the loosest match level that still has an exercise. */
export function slotCandidates(
  slot: SlotSpec,
  pool: readonly Exercise[],
  profile: UserProfile,
  options: SlotCandidateOptions = {},
): SlotCandidates | null {
  const base = pool.filter(
    (ex) =>
      isMainCategory(ex) &&
      passesProfileFilter(ex, profile) &&
      goalAllowsInSlot(ex, slot, profile) &&
      !options.taken?.has(ex.id) &&
      !options.exclude?.has(ex.id),
  )
  const chosen = options.chosen ?? []
  const lookup = lookupFor(pool)
  const fresh = (ex: Exercise) => !chosen.some((other) => isRedundantWith(ex, other, lookup))
  const open = (ex: Exercise) => !options.openGroups || options.openGroups.includes(muscleGroupOf(ex))
  const levels: MatchLevel[] = [0, 1, 2, 3, 4]
  for (const level of levels) {
    let matches = base.filter((ex) => matchesSlot(ex, slot, level))
    if (options.openGroups) matches = matches.filter(open)
    // One member of a variation family per session: a b-stance hip thrust never joins a barbell
    // hip thrust, an underhand row never follows a bent-over row.
    if (chosen.length > 0) matches = matches.filter(fresh)
    if (matches.length === 0) continue
    // A hamstring slot without a knee-flexion option (no leg curl in the kit) falls back to a
    // hamstring hinge that needs no ramp-up (dumbbell or single-leg RDL) before it takes glute
    // drills, so the hamstrings get direct work (R19).
    if (level === 0 && hamstringLed(slot) && !matches.some((ex) => muscleGroupOf(ex) === "hamstrings")) {
      const hinges = base.filter(
        (ex) => muscleGroupOf(ex) === "hamstrings" && !ex.warmupRequired && matchesSlot(ex, slot, 2) && open(ex) && (chosen.length === 0 || fresh(ex)),
      )
      if (hinges.length > 0) matches = hinges
    }
    const compatible = matches.filter((ex) => goalCompatible(ex, profile.goal))
    // Strength and hypertrophy support work must be loadable to progress: when the goal filter
    // would leave only bodyweight or timed options while loadable ones match, the loadable ones
    // are the candidates (a strength day's delt slot is not locked onto a prone Y-raise).
    const supportSlot = (slot.role === "accessory" || slot.role === "isolation") && slot.kind !== "core"
    if (supportSlot && LOADABLE_GOALS.has(profile.goal) && !compatible.some(isLoadable) && matches.some(isLoadable)) {
      return { level, exercises: matches.filter(isLoadable) }
    }
    const exercises = compatible.length > 0 ? compatible : matches
    // The same holds for a strength or hypertrophy compound slot: while a loadable press or row
    // matches, a bodyweight lift that cannot be programmed down into the goal's reps (push-ups at
    // 10–12 for a 3–6 strength block) is not a candidate. Favourites stay (R05).
    const compoundSlot = slot.role === "primary_compound" || slot.role === "secondary_compound"
    if (compoundSlot && LOADABLE_GOALS.has(profile.goal) && exercises.some(isLoadable)) {
      const role = slot.role
      const kept = exercises.filter((ex) => profile.preferredExerciseIds.includes(ex.id) || !startsAboveGoal(ex, profile.goal, role))
      return { level, exercises: kept }
    }
    return { level, exercises }
  }
  return null
}

export interface ScoreContext {
  profile: UserProfile
  slot: SlotSpec
  /** Exercises already chosen for this workout, in order. */
  chosen: readonly Exercise[]
  /** Ids used in the last workout of the same split day. */
  lastSameSplitIds: ReadonlySet<string>
  /** Ids used in the last few workouts of any split → how many workouts ago (0 = most recent). */
  recentIds: ReadonlyMap<string, number>
  rng: Rng
  /**
   * Recovery state as of the workout day. Optional: when given, a finisher that loads groups
   * trained heavily in the last 48 h scores lower.
   */
  recovery?: RecoveryMap
  /**
   * Ids the user has logged at least once. Optional: when absent, the last few workouts
   * (recentIds and lastSameSplitIds) stand in for the log.
   */
  performedIds?: ReadonlySet<string>
  /**
   * Completed workouts of the same split day, newest first (the first is the one lastSameSplitIds
   * comes from). Optional: when given, last week's accessory and isolation lifts keep their slot
   * while they progress, for a block of SUPPORT_BLOCK_EXPOSURES sessions (supportLiftStatus); when
   * absent, support work rotates every week as before.
   */
  sameSplitHistory?: readonly CompletedWorkout[]
  /**
   * Core spec C07/C08: trunk work in the rolling 7 days (recovery.ts coreExposure). Optional: when
   * given, a core slot favours the families the week lacks, avoids repeating the last session's
   * family and caps flexion; when absent, only the goal emphasis applies.
   */
  core?: {
    familiesLast7: ReadonlySet<CoreFamily>
    lastFamily: CoreFamily | null
    flexionLast7: number
  }
}

export interface ScoredCandidate {
  exercise: Exercise
  score: number
}

/**
 * Sessions of one split day a support lift (accessory or isolation) is kept for before it rotates:
 * about a four-week block when the day comes round once a week. A coaching convention, not a rule
 * from the literature.
 */
export const SUPPORT_BLOCK_EXPOSURES = 4

export interface SupportLiftStatus {
  /** Consecutive sessions of the split day, newest first, that completed the lift. */
  exposures: number
  /**
   * The last session completed it with logged reps, load or time and no set below the prescribed
   * range's floor (or below the prescribed time).
   */
  onTrack: boolean
  /** Two sessions in a row without a load, rep or time gain. */
  stalled: boolean
  /** Keep it this session: on track, not stalled and inside the block. */
  keep: boolean
}

function mainEntry(workout: CompletedWorkout, id: string): CompletedExercise | undefined {
  return workout.exercises.find((e) => e.phase === "main" && e.exerciseId === id && e.status === "completed")
}

/** Whether a completed entry was logged with every set done and at or above the prescription's floor. */
function completedOnTrack(entry: CompletedExercise): boolean {
  if (entry.sets.length === 0 || entry.sets.some((s) => !s.completed)) return false
  const logged = entry.sets.some((s) => s.reps != null || s.weightKg != null || s.durationSeconds != null)
  if (!logged) return false
  const floor = entry.prescribedReps?.[0]
  if (floor != null && entry.sets.some((s) => s.reps == null || s.reps < floor)) return false
  const seconds = entry.prescribedDurationSeconds
  if (seconds != null && entry.sets.some((s) => s.durationSeconds != null && s.durationSeconds < seconds)) return false
  return true
}

/** Heaviest load, then total reps (or seconds): what "a gain" is measured on. */
function performanceOf(entry: CompletedExercise): [number, number] {
  const done = entry.sets.filter((s) => s.completed)
  const loads = done.map((s) => s.weightKg).filter((w): w is number => w != null)
  const top = loads.length > 0 ? Math.max(...loads) : 0
  const work = done.reduce((sum, s) => sum + (s.reps ?? 0) + (s.durationSeconds ?? 0), 0)
  return [top, work]
}

function gained(newer: CompletedExercise, older: CompletedExercise): boolean {
  const [nTop, nWork] = performanceOf(newer)
  const [oTop, oWork] = performanceOf(older)
  return nTop > oTop || (nTop === oTop && nWork > oWork)
}

/**
 * How a support lift is going on one split day (R07): how many sessions in a row it has held the
 * slot, whether last time was completed on target, and whether it has stalled. A lift the user
 * skipped or swapped away is not in the last session, so it has no status to keep.
 */
export function supportLiftStatus(id: string, sameSplitHistory: readonly CompletedWorkout[]): SupportLiftStatus {
  const entries: CompletedExercise[] = []
  for (const w of sameSplitHistory) {
    const entry = mainEntry(w, id)
    if (!entry) break
    entries.push(entry)
  }
  const exposures = entries.length
  const onTrack = exposures > 0 && completedOnTrack(entries[0]!)
  const stalled = exposures >= 3 && !gained(entries[0]!, entries[1]!) && !gained(entries[1]!, entries[2]!)
  return { exposures, onTrack, stalled, keep: onTrack && !stalled && exposures < SUPPORT_BLOCK_EXPOSURES }
}

/**
 * Whether last week's support lift keeps its slot today. At the block boundary only one support lift
 * of the day rotates: once a lift chosen earlier in this session is new to the split day, a lift that
 * has merely reached the boundary (still on track, not stalled) stays for another session.
 */
/**
 * Last time on this split day the card suggested a harder variation for this lift
 * (CompletedExercise.suggestedExerciseId): the bodyweight lift has outgrown itself (R12).
 */
function outgrown(exercise: Exercise, ctx: ScoreContext): boolean {
  const last = ctx.sameSplitHistory?.[0]
  return !!last?.exercises.some((e) => e.exerciseId === exercise.id && !!e.suggestedExerciseId)
}

function keepsSupportLift(exercise: Exercise, ctx: ScoreContext): boolean {
  if (!ctx.sameSplitHistory || !ctx.lastSameSplitIds.has(exercise.id)) return false
  const status = supportLiftStatus(exercise.id, ctx.sameSplitHistory)
  if (status.keep) return true
  if (!status.onTrack || status.stalled) return false
  return ctx.chosen.some((o) => !isConditioning(o) && !ctx.lastSameSplitIds.has(o.id))
}

/** A finisher's recency and rotation penalties together never exceed this (R16). */
const FINISHER_RECENCY_CAP = 4

/**
 * A heavy bilateral barbell lower-body lift that loads the spine: back and front squats, floor
 * pulls (conventional, sumo, trap bar), rack pulls. Hamstring-led hinges (RDLs, good mornings) are
 * lighter by design and do not count.
 */
export function isHeavyLowerBarbell(exercise: Exercise): boolean {
  if (!exercise.warmupRequired || exercise.isUnilateral) return false
  if (!exercise.equipment.includes("barbell") && !exercise.equipment.includes("trap_bar")) return false
  if (exercise.movementPattern === "squat") return true
  return exercise.movementPattern === "hinge" && exercise.primaryMuscle !== "hamstrings"
}

/**
 * A strength block's main lift: one of the big barbell lifts, or a barbell or trap-bar lift that
 * needs ramp-up sets and can be loaded for five reps or fewer (box squat, pause squat).
 */
export function isStrengthMainLift(exercise: Exercise): boolean {
  if (exercise.tags?.includes("big_lift")) return true
  const bar = exercise.equipment.includes("barbell") || exercise.equipment.includes("trap_bar")
  return bar && exercise.warmupRequired && !!exercise.repRange && exercise.repRange[0] <= 5
}

/** Small muscles where a second direct exercise in one session is usually redundant. */
const SMALL_MUSCLES: ReadonlySet<Muscle> = new Set<Muscle>(["rear_delts", "biceps", "forearms", "calves"])

function loadsLowerBody(exercise: Exercise): boolean {
  return LOWER_GROUPS.has(muscleGroupOf(exercise))
}

/** Sprints and change-of-direction drills: fast eccentric loading of the knees and ankles. */
function isSprintOrAgility(exercise: Exercise): boolean {
  return !!exercise.tags?.some((t) => t === "sprint" || t === "agility")
}

/** Whether the user has logged the exercise (or, without a log, done it in recent workouts). */
function hasPerformed(id: string, ctx: ScoreContext): boolean {
  if (ctx.performedIds) return ctx.performedIds.has(id)
  return ctx.recentIds.has(id) || ctx.lastSameSplitIds.has(id)
}

const UPPER_BODY_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>([
  ...PUSH_PATTERNS, ...PULL_PATTERNS, "shoulder_abduction", "shoulder_flexion",
])

/**
 * An upper-body lift done seated, lying or braced on a bench or machine (seated press, chest-supported
 * or bench-braced row, machine row): the trunk does not hold the load up.
 */
export function isTorsoSupported(exercise: Exercise): boolean {
  if (!UPPER_BODY_PATTERNS.has(exercise.movementPattern)) return false
  return exercise.equipment.some((e) => e === "bench" || e === "machine" || e === "smith_machine")
}

/**
 * A main lift that loads the lower back through trunk demand without listing it as a stressed area:
 * the lower back is a working muscle (a bodyweight single-leg RDL), or a whole-body lift is braced
 * through the trunk (a renegade row from a plank).
 */
function loadsTrunk(exercise: Exercise): boolean {
  if (exercise.category === "core" || isTorsoSupported(exercise)) return false
  if (exercise.secondaryMuscles.includes("lower_back")) return true
  return exercise.category === "full_body" && exercise.secondaryMuscles.some((m) => m === "abs" || m === "obliques")
}

/** Tagged as sparing an area (`shoulder_friendly`), or, for the lower back, done with the torso supported. */
function sparesArea(exercise: Exercise, area: BodyArea): boolean {
  if (exercise.tags?.includes(`${area}_friendly`)) return true
  return area === "lower_back" && isTorsoSupported(exercise)
}

/**
 * Soft preference for a user's flagged areas, on top of the hard contraindication filter (R14):
 * +4 for a lift that spares a flagged area (tagged `<area>_friendly`, or chest- or seat-supported for
 * the lower back), -4 for one that loads a flagged lower back through trunk demand. Shared with the
 * cool-down's stretch choice.
 */
export function limitationPreference(exercise: Exercise, profile: Pick<UserProfile, "limitations">): number {
  let score = 0
  for (const area of profile.limitations) {
    if (sparesArea(exercise, area)) score += 4
    else if (area === "lower_back" && loadsTrunk(exercise)) score -= 4
  }
  return score
}

/** familyRoot over the candidates, falling back to the library for parents outside them. */
function familyLookup(peers: readonly Exercise[]): ExerciseLookup {
  const local = lookupFor(peers)
  return (id) => local(id) ?? getExercise(id)
}

const isBeginnerFriendly = (exercise: Exercise): boolean => !!exercise.tags?.includes("beginner_friendly")

/** The rep window a role is meant to train in a goal (hypertrophy accessories 9–13, isolations 11–15). */
function roleRepWindow(goal: Goal, role: MainRole): [number, number] | null {
  const reps = GOAL_PRESCRIPTIONS[goal].reps
  // A plain loadable lift whose own range is the goal's: prescribeReps then places the role's window.
  const neutral: Exercise = {
    id: "role-window",
    name: "Role window",
    slug: "role-window",
    category: "chest",
    primaryMuscle: "chest",
    secondaryMuscles: [],
    movementPattern: "horizontal_push",
    mechanics: "isolation",
    force: "push",
    equipment: ["dumbbell"],
    difficulty: "beginner",
    goalCompatibility: [],
    genderNeutral: true,
    instructions: [],
    coachTips: [],
    commonMistakes: [],
    setsRange: [3, 4],
    repRange: [reps[0], reps[1]],
    restRange: [60, 90],
    warmupRequired: false,
    loadType: "external",
    contraindications: [],
    alternativeExercises: [],
  }
  return prescribeReps(neutral, goal, role)
}

/** Narrowest rep window worth prescribing (prescriptions.ts MIN_REP_SPAN). */
const MIN_REP_SPAN = 2

/** The other bodyweight members of an exercise's variation family among the slot's candidates. */
function bodyweightFamily(exercise: Exercise, peers: readonly Exercise[]): Exercise[] {
  const lookup = familyLookup(peers)
  const root = familyRoot(exercise, lookup)
  return peers.filter((p) => p.id !== exercise.id && p.loadType === "bodyweight" && familyRoot(p, lookup) === root)
}

/**
 * A beginner's first exposure to a bodyweight regression (knee push-up: a variation marked
 * beginner_friendly) while a harder bodyweight member of its family is in the slot, and the
 * regression still gets a real rep window. The rep-fit penalty would otherwise hand the slot to the
 * harder sibling (wide-grip push-ups at 15–20 for an endurance beginner), so it is not applied
 * (R05). A regression with no harder sibling here (negative pull-ups, 3–6) keeps the penalty, so a
 * band-assisted pull-up that fits the goal still wins.
 */
function protectsRegression(exercise: Exercise, ctx: ScoreContext, peers: readonly Exercise[] | undefined): boolean {
  const { profile, slot } = ctx
  if (!peers || profile.experience !== "beginner" || exercise.loadType !== "bodyweight" || !exercise.variationOf) return false
  if (!isBeginnerFriendly(exercise) || hasPerformed(exercise.id, ctx)) return false
  const window = prescribeReps(exercise, profile.goal, slot.role)
  if (!window || window[1] - window[0] < MIN_REP_SPAN) return false
  return bodyweightFamily(exercise, peers).some((p) => !isBeginnerFriendly(p))
}

/** Hanging trunk work (data tag "hanging", or a bar or dip station): grip and shoulder demand. */
function hangsFrom(exercise: Exercise): boolean {
  return !!exercise.tags?.includes("hanging") || exercise.equipment.some((e) => e === "pull_up_bar" || e === "dip_station")
}

/**
 * Core spec C09: same-structure conflicts between trunk work and the day's lifts, -8 each.
 * - Lower back: the candidate lists it, and the day has a heavy hinge (a hinge that needs ramp-up
 *   sets) or two non-core compounds that list it.
 * - Shoulder: hanging or overhead trunk work on a day with a compound press.
 * - Grip (separately): a carry or hanging work on a day with a heavy hinge or two compound pulls.
 * Positional flags (the kneeling "knee" of a cable crunch, the shoulder of a side plank) no longer
 * count for users who flagged nothing; a flagged area is kept out by the hard filter.
 */
export function coreOverlapPenalty(exercise: Exercise, chosen: readonly Exercise[]): number {
  const compounds = chosen.filter((o) => o.mechanics === "compound" && o.category !== "core")
  const heavyHinge = chosen.some((o) => o.movementPattern === "hinge" && o.warmupRequired)
  const lbCompounds = compounds.filter((o) => o.contraindications.includes("lower_back")).length
  const pressed = compounds.some((o) => PUSH_PATTERNS.has(o.movementPattern))
  const pulls = compounds.filter((o) => PULL_PATTERNS.has(o.movementPattern)).length
  const hanging = hangsFrom(exercise)
  const overhead = !!exercise.tags?.includes("overhead")
  let score = 0
  if (exercise.contraindications.includes("lower_back") && (heavyHinge || lbCompounds >= 2)) score += CORE_SCORE.overlap
  else if ((hanging || overhead) && pressed) score += CORE_SCORE.overlap
  if ((exercise.movementPattern === "carry" || hanging) && (heavyHinge || pulls >= 2)) score += CORE_SCORE.overlap
  return score
}

/**
 * The core-slot terms of scoreCandidate (core spec C07, C08, C11, C12, C20, and the R27 closeness
 * to the lifter's level). Trunk work for trained lifters goes by closeness to their level, except
 * loadable trunk work for trained strength and hypertrophy lifters, where load, not the difficulty
 * label, provides the overload.
 */
function coreSlotScore(exercise: Exercise, ctx: ScoreContext, peers: readonly Exercise[] | undefined): number {
  const { profile } = ctx
  const { goal, experience } = profile
  const loadableGoal = LOADABLE_GOALS.has(goal)
  const loadedCore = loadableGoal && experience !== "beginner" && loadableTrunk(exercise)
  const gap = loadedCore ? 0 : Math.abs(DIFFICULTY_RANK[exercise.difficulty] - DIFFICULTY_RANK[experience])
  let score = experience === "beginner" ? (gap === 0 ? 3 : 0) : 3 - 1.5 * gap
  if (loadedCore) score += CORE_SCORE.loadedTrunk
  const fam = coreFamily(exercise)
  if (fam) {
    // Rotate families through the rolling week (C07). The same split day a week ago is outside the
    // window, so this never fights block consistency (keepsSupportLift).
    if (ctx.core) {
      if (!ctx.core.familiesLast7.has(fam)) score += CORE_SCORE.missingFamily
      if (ctx.core.lastFamily === fam) score += CORE_SCORE.lastFamily
    }
    if (coreEmphasis(goal, experience).has(fam)) score += CORE_SCORE.emphasis
    if (fam === "flexion_rotation") {
      if (flexionCapped(goal, experience) && (ctx.core?.flexionLast7 ?? 0) >= 1) score += CORE_SCORE.flexionCap
      // Whether flexion harms a healthy spine is contested: a preference, not a ban (C20).
      if (profile.limitations.includes("lower_back")) score += CORE_SCORE.lowerBackFlexion
    }
  }
  // Hip-flexor-led floor drills (C12): beginners self-monitor them poorly, trained strength and
  // hypertrophy lifters have loadable options (hanging work aside), and deep repeated hip flexion is
  // the usual aggravator of a flagged hip.
  if (exercise.tags?.includes("hip_flexor_led")) {
    const hanging = !!exercise.tags.includes("hanging")
    if (
      experience === "beginner" ||
      (loadableGoal && !hanging && !!peers?.some((p) => p.id !== exercise.id && loadableTrunk(p))) ||
      profile.limitations.includes("hip")
    ) {
      score += CORE_SCORE.hipFlexorLed
    }
  }
  return score
}

/**
 * Heuristic score; higher is better. Includes a small seeded jitter for tie-breaks.
 *
 * `peers` are the other candidates for the same slot. Rules that compare a candidate with the
 * alternatives the slot actually has (a strength lift exists, a regression exists, a candidate
 * without the stressed area exists) only apply when they are given; rankCandidates passes them.
 */
export function scoreCandidate(exercise: Exercise, ctx: ScoreContext, peers?: readonly Exercise[]): number {
  const { profile, slot } = ctx
  const experience = profile.experience
  const compoundRole = slot.role === "primary_compound" || slot.role === "secondary_compound"
  const preferred = profile.preferredExerciseIds.includes(exercise.id)
  const tags = exercise.tags ?? []
  let score = 0

  const conditioningSlot = slot.kind === "conditioning"
  const supportSlot = (slot.role === "accessory" || slot.role === "isolation") && slot.kind !== "core"
  const loadableGoal = LOADABLE_GOALS.has(profile.goal)
  const loadable = isLoadable(exercise)

  if (preferred) score += 30
  if (goalCompatible(exercise, profile.goal)) score += 5
  // The lift should be programmable in the goal's rep range: a fat-loss day squats with a goblet
  // or a leg press for 10–15, not a barbell built for triples; a strength day's compounds are
  // lifts that can be loaded for 3–6. Strength accessories may sit above the range. A beginner's
  // first knee push-ups are not pushed out of an endurance block by their harder siblings (R05).
  const highRepOnly = !!exercise.repRange && exercise.repRange[0] > 15
  const repMisfit = !repRangeFitsGoal(exercise, profile.goal) && (compoundRole || profile.goal !== "strength" || highRepOnly)
  if (repMisfit && !protectsRegression(exercise, ctx, peers)) score -= 8
  // Matching the user's level steers the main lifts. Support slots do not get it: for intermediates
  // it only pulled accessories towards technique variants (Meadows rows, Lu raises) over standard
  // loadable ones. Trunk work for trained lifters goes by closeness to their level, so an advanced
  // lifter gets a dead bug only when nothing harder passes the filter (R27).
  if (compoundRole && exercise.difficulty === experience) score += 3
  if (slot.kind === "core") score += coreSlotScore(exercise, ctx, peers)

  if (compoundRole) {
    if (exercise.mechanics === "compound") score += 10
    if (CANONICAL_COMPOUNDS.has(exercise.id)) score += slot.role === "primary_compound" ? 15 : 8
    if (exercise.warmupRequired && slot.role === "primary_compound") score += 3
    // A trained lifter's strength block is built on the barbell lifts: the bench, squat, deadlift
    // and press win their slots by more than the jitter, and a machine built for sets of eight or
    // more is not a strength day's main lift. Beginners keep their machine and dumbbell bias below.
    const strengthBlock = profile.goal === "strength" && experience !== "beginner"
    const strengthLift = strengthBlock && isStrengthMainLift(exercise)
    if (strengthLift) score += 8
    const machine = exercise.equipment.includes("machine") || exercise.equipment.includes("smith_machine")
    if (strengthBlock && machine && !!exercise.repRange && exercise.repRange[0] > GOAL_PRESCRIPTIONS.strength.reps[1]) score -= 6
    // Progression needs consistency: keep the big lifts stable across the same split day. In a
    // strength block that only locks in a barbell lift; a dumbbell or machine stand-in from last
    // week does not keep the slot while the barbell lift is available.
    const slotHasStrengthLift = !peers || peers.some(isStrengthMainLift)
    const keepsConsistency = !strengthBlock || strengthLift || preferred || !slotHasStrengthLift
    // A bodyweight lift that last time earned a harder variation does not hold the slot in a
    // strength or hypertrophy block: consistency is for lifts that still progress (R12).
    const outgrownLift = loadableGoal && exercise.loadType === "bodyweight" && outgrown(exercise, ctx)
    if (ctx.lastSameSplitIds.has(exercise.id) && keepsConsistency && !outgrownLift) score += 10
    // A compound slot is sets of reps: a timed, isometric or inverted hold (a wall handstand for
    // the vertical press) only fills it when no rep-based option exists at this match level.
    if (isHoldOrInversion(exercise) && peers?.some((p) => !isHoldOrInversion(p))) score -= 10
  } else {
    // In strength and hypertrophy blocks the isolation bonus goes to work that can be loaded, so a
    // bodyweight reverse hyper or a band raise does not outrank a loadable hip thrust or a cable
    // raise (R19, R13).
    if (slot.role === "isolation" && exercise.mechanics === "isolation" && (!loadableGoal || !supportSlot || loadable)) score += 6
    if (slot.role === "accessory" && slot.kind !== "core" && exercise.mechanics === "compound") score += 4
    let recency = 0
    if (ctx.lastSameSplitIds.has(exercise.id)) recency -= 12
    const ago = ctx.recentIds.get(exercise.id)
    if (ago !== undefined) recency -= Math.max(0, 6 - ago * 2)
    if (slot.role === "finisher") {
      // Conditioning rotates for variety, but never so hard that a repeated interval drill loses to
      // steady work (R16).
      score += Math.max(recency, -FINISHER_RECENCY_CAP)
    } else if (keepsSupportLift(exercise, ctx)) {
      // Support work builds load history: last week's lift, completed on target, keeps its slot
      // for a block and rotates at the boundary or after two stalled sessions (R07).
      score += 6
    } else if (!(loadableGoal && supportSlot && loadable && peers && !peers.some((p) => p.id !== exercise.id && isLoadable(p)))) {
      // Otherwise accessories rotate so the week has variety, except a strength or hypertrophy
      // slot's only loadable option, which is not rotated out for bodyweight work (R19).
      score += recency
    }
    // Hypertrophy and strength accessories should be loadable so they can progress.
    if (slot.kind !== "core" && loadableGoal && loadable) score += 3
  }

  // Abduction/adduction drills are extras, not the hamstring or glute slot's main work.
  if (slot.kind !== "general" && (exercise.tags?.includes("abduction") || exercise.tags?.includes("adduction"))) score -= 6

  if (experience === "beginner" && compoundRole) {
    if (exercise.equipment.every((e) => BEGINNER_FRIENDLY.has(e) || e === "bench")) score += 8
    if (exercise.equipment.includes("barbell") || exercise.equipment.includes("trap_bar")) score -= 5
  }

  // A beginner meeting a bodyweight lift for the first time starts on its regression: knee or
  // incline push-ups before full push-ups or wide-grip push-ups, negatives before pull-ups.
  // Progression graduates them. Judged within the variation family, so the bonus is a tie-break
  // among bodyweight variants and never lifts a doorway row over a machine row (R05).
  if (experience === "beginner" && exercise.loadType === "bodyweight" && !hasPerformed(exercise.id, ctx) && peers) {
    const family = bodyweightFamily(exercise, peers)
    if (isBeginnerFriendly(exercise)) {
      if (family.some((p) => !isBeginnerFriendly(p))) score += 6
    } else if (family.some(isBeginnerFriendly)) score -= 6
  }

  if (!conditioningSlot) {
    // An improvised no-equipment lift (doorway row, towel curl, prone raises, push-ups) is for
    // training without kit: when the user's own equipment offers a loadable lift of the same
    // movement, it loses by more than the jitter (R05).
    if (tags.includes("no_equipment") && !loadable && ownsKitFor(exercise, peers)) score -= 6
    // Band tension is not logged in kilograms: a trained lifter with cable, machine or free weights
    // for the movement uses them (R13).
    if (experience !== "beginner" && isBandOnly(exercise) && ownsKitFor(exercise, peers)) score -= 4
  }

  // A hypertrophy accessory in a strength rep window (a floor press at 6–8) misses the role's
  // intended range, unless it is the variation that spares a flagged area (R13).
  if (profile.goal === "muscle_gain" && supportSlot) {
    const window = prescribeReps(exercise, profile.goal, slot.role)
    const intended = roleRepWindow(profile.goal, slot.role)
    if (window && intended && window[1] < intended[0] && !profile.limitations.some((a) => sparesArea(exercise, a))) score -= 6
  }

  // Flagged areas: prefer the lifts built to spare them (R14).
  score += limitationPreference(exercise, profile)

  // Core spec C10: Pallof presses, side planks and suitcase carries are one-sided by nature; their
  // time is in the duration estimate and the short-session dose, so a core slot is exempt.
  const chosenUnilateral = ctx.chosen.filter((e) => e.isUnilateral).length
  if (exercise.isUnilateral && slot.kind !== "core") score +=chosenUnilateral === 0 && slot.role === "accessory" ? 2 : -4 * chosenUnilateral
  // A one-arm press or row for the day's main lift doubles the working time and loads in coarse
  // steps: the two-arm member of the same family goes first (R27).
  if (slot.role === "primary_compound" && exercise.isUnilateral && peers) {
    const lookup = familyLookup(peers)
    const root = familyRoot(exercise, lookup)
    if (peers.some((p) => p.id !== exercise.id && !p.isUnilateral && familyRoot(p, lookup) === root)) score -= 3
  }
  // Front-raise work after a front-delt press is a third front-delt exercise: the delt slot goes to
  // side or rear delts (R27).
  if (
    exercise.movementPattern === "shoulder_flexion" &&
    exercise.primaryMuscle === "front_delts" &&
    exercise.mechanics === "isolation" &&
    ctx.chosen.some((o) => o.mechanics === "compound" && o.primaryMuscle === "front_delts")
  ) {
    score -= 8
  }

  const newSlotPattern =
    slot.patterns.includes(exercise.movementPattern) && !ctx.chosen.some((o) => o.movementPattern === exercise.movementPattern)
  for (const other of ctx.chosen) {
    if (other.primaryMuscle === exercise.primaryMuscle && other.movementPattern === exercise.movementPattern) {
      // The same muscle through the same movement is the same work, whatever the mechanics label
      // says: a JM press and a skull crusher are both lying elbow extensions. (In a slot that only
      // takes that movement, such as a chest fly after the bench, every option pays it equally.)
      score -= 8
    } else if (other.primaryMuscle === exercise.primaryMuscle && other.mechanics === exercise.mechanics && !newSlotPattern) {
      // Two compounds (or two isolations) on the same muscle is redundant; a compound followed
      // by an isolation through another movement is how a coach builds a day, so that is not penalised.
      // Nor is a lift that trains a movement the slot asks for and the day has not trained yet (a
      // lat pulldown after a row), which is the second plane of pulling, not a repeat (R09).
      score -= 6
    }
    if (exercise.variationOf && (exercise.variationOf === other.id || exercise.variationOf === other.variationOf)) score -= 8
    if (other.variationOf === exercise.id) score -= 8
    // Two compounds of the same pattern (two horizontal presses) when the slot also accepts another.
    if (other.movementPattern === exercise.movementPattern && other.mechanics === "compound" && exercise.mechanics === "compound") {
      score -= slot.patterns.length > 1 && slot.patterns.some((p) => p !== exercise.movementPattern) ? 8 : 3
    }
  }
  // A small muscle rarely needs a second direct exercise in one session (eight rear-delt sets).
  if (SMALL_MUSCLES.has(exercise.primaryMuscle) && ctx.chosen.some((o) => o.primaryMuscle === exercise.primaryMuscle)) score -= 8

  // Lower-back load stacks across squats, hinges and unsupported rows: a third such lift (a second
  // for a beginner) when the slot has an option that spares it. Other areas are not stacked: on a
  // push day every press and fly lists the shoulder, and penalising the fourth one only handed the
  // slot to a band fly or a partial-range press for users who flagged nothing (R13, R14). A flagged
  // area is already kept out by the hard filter.
  const loadsLowerBack = (e: Exercise) => e.contraindications.includes("lower_back")
  const lowerBackThreshold = experience === "beginner" ? 1 : 2
  if (
    loadsLowerBack(exercise) &&
    ctx.chosen.filter(loadsLowerBack).length >= lowerBackThreshold &&
    (!peers || peers.some((p) => !loadsLowerBack(p)))
  ) {
    score -= 6
  }
  // Beginners take the row or fly that spares the lower back when the same movement has one with
  // the same kind of load (a single-arm dumbbell row over a kettlebell row, a chest-supported rear
  // delt fly over a bent-over one), by more than the jitter (R14). Trunk drills have their own rule.
  if (
    experience === "beginner" &&
    slot.kind !== "core" &&
    !conditioningSlot &&
    loadsLowerBack(exercise) &&
    peers?.some((p) => p.id !== exercise.id && p.movementPattern === exercise.movementPattern && isLoadable(p) === loadable && !loadsLowerBack(p))
  ) {
    score -= 5
  }

  if (slot.kind === "core") {
    // Trunk work comes after the heavy lifts and should not load the same structure they just
    // loaded (core spec C09). Only real same-structure conflicts count, not any shared flag: of the
    // library's compounds most list the shoulder, the lower back or the knee, so the old "any shared
    // contraindication" rule handed every core slot to unflagged floor drills.
    score += coreOverlapPenalty(exercise, ctx.chosen)
    // Beginners start with trunk drills that stress nothing when the pattern has one.
    if (
      experience === "beginner" &&
      exercise.contraindications.length > 0 &&
      peers?.some((p) => p.id !== exercise.id && p.movementPattern === exercise.movementPattern && p.contraindications.length === 0)
    ) {
      score -= 4
    }
  }

  if (slot.kind === "lower" && LOWER_GROUPS.has(muscleGroupOf(exercise))) score += 2

  // One heavy barbell squat or floor pull per session outside strength work. Pairing a back squat
  // with a conventional deadlift is a strength-block choice; for hypertrophy, fat loss and general
  // fitness the second lower compound should be an RDL, a leg press or a split squat instead. A
  // barbell RDL as the day's primary counts too: a back squat after it is the same erector-heavy
  // pairing as the other lower day's, only flipped (R27).
  const barbellHinge = (o: Exercise) =>
    o.movementPattern === "hinge" && o.warmupRequired && (o.equipment.includes("barbell") || o.equipment.includes("trap_bar"))
  if (isHeavyLowerBarbell(exercise) && ctx.chosen.some((o) => isHeavyLowerBarbell(o) || (slot.role === "secondary_compound" && barbellHinge(o)))) {
    score -= profile.goal === "strength" ? 4 : 16
  }
  // The second lower compound differs from the other lower day's: a trained lifter's secondary that
  // was a main lift of another day within the last few sessions, and not of this split day, scores
  // lower, so Lower A and Lower B do not run the same squat and hinge pair (R27).
  if (
    slot.role === "secondary_compound" &&
    slot.kind === "lower" &&
    experience !== "beginner" &&
    exercise.mechanics === "compound" &&
    ctx.recentIds.has(exercise.id) &&
    !ctx.lastSameSplitIds.has(exercise.id)
  ) {
    score -= 6
  }
  if (
    slot.role === "secondary_compound" &&
    profile.goal !== "strength" &&
    exercise.movementPattern === "hinge" &&
    exercise.primaryMuscle === "hamstrings"
  ) {
    score += 4
  }

  // On an upper-body day the finisher should not tax the legs before the next lower session:
  // prefer machine intervals or whole-body work over sled pushes, jump squats and sprints. Sprints
  // and shuttle runs also need a thorough lower-body warm-up an upper day never gave.
  if (slot.kind === "conditioning" && ctx.chosen.length > 0 && !ctx.chosen.some(loadsLowerBody)) {
    if (loadsLowerBody(exercise) || exercise.equipment.includes("sled")) score -= 8
    if (exercise.warmupRequired || isSprintOrAgility(exercise)) score -= 8
    if (exercise.category === "cardio") score += 3
  }
  if (slot.kind === "conditioning") {
    if (tags.includes("intervals") || tags.includes("hiit") || tags.includes("conditioning")) score += 6
    if (tags.includes("steady_state")) score -= 4
    if (exercise.durationRange && exercise.durationRange[0] <= 60) score += 3
    // Low-impact cyclical cardio (bike, rower, ski erg intervals) adds conditioning, not joint load.
    if (exercise.category === "cardio" && tags.includes("low_impact")) score += 3
    // Conditioning that loads groups trained heavily in the last 48 hours digs into their recovery.
    const recovery = ctx.recovery
    if (recovery && muscleGroupsOf(exercise).some((g) => g !== "cardio" && g !== "full_body" && (recovery[g]?.daysSinceHeavy ?? Infinity) < 2)) {
      score -= 6
    }
  }
  score += ctx.rng.next() * 4
  return score
}

export function rankCandidates(candidates: readonly Exercise[], ctx: ScoreContext): ScoredCandidate[] {
  return candidates
    .map((exercise) => ({ exercise, score: scoreCandidate(exercise, ctx, candidates) }))
    .sort((a, b) => b.score - a.score || a.exercise.id.localeCompare(b.exercise.id))
}

/** Pick the best exercise for a slot, or null when nothing fits. */
export function selectForSlot(
  slot: SlotSpec,
  pool: readonly Exercise[],
  ctx: ScoreContext,
  options: SlotCandidateOptions = {},
): { exercise: Exercise; level: MatchLevel } | null {
  const candidates = slotCandidates(slot, pool, ctx.profile, { ...options, chosen: options.chosen ?? ctx.chosen })
  if (!candidates) return null
  const ranked = rankCandidates(candidates.exercises, ctx)
  const best = ranked[0]
  return best ? { exercise: best.exercise, level: candidates.level } : null
}
