/**
 * Conservative first-session loads.
 *
 * Used only when the user has never logged a weight for an exercise, so the card can say
 * "start around X" instead of leaving the lifter to guess. This is where body weight, gender and
 * experience shape the plan: they scale a starting load, nothing more.
 *
 * The fractions below are coaching heuristics chosen to sit well under what a trained lifter of
 * that profile typically handles for the rep range. They are not population norms. Because the
 * table is already conservative, the profile factors are not allowed to stack another large
 * discount on top (MIN_PROFILE_FACTOR), and the result is rounded to a load the user can set up
 * without cutting much off it. An estimate that would only show the lightest implement is not an
 * estimate: the card asks the lifter to find their working weight instead (see progression.ts
 * planLoad). So does every loaded lift without a heuristic (machines, cables, bands) and, for
 * intermediate and advanced lifters, every heavy compound: their ramp-up sets find the load better
 * than a body-weight fraction can (coach round 2, R04 and R10). The first set is a calibration
 * set: the set logger asks for the weight actually used, and from the next session on,
 * progression runs on real numbers (see progression.ts).
 */
import type { Units, UserProfile } from "@/lib/domain/types"
import { MUSCLE_TO_GROUP, type Equipment, type Exercise, type MovementPattern, type MuscleGroup } from "@/lib/exercises/types"
import { fromKg, loadStep, toKg } from "@/lib/units"

export type Implement = "barbell" | "ez_bar" | "dumbbell" | "kettlebell"

/** Standard kettlebell spacing: 4 kg in metric sets, 5 lb in imperial ones. Shared with progression. */
export const KETTLEBELL_STEP: Record<Units, number> = { kg: loadStep("kg", "kettlebell"), lb: loadStep("lb", "kettlebell") }

/**
 * Body-weight fraction for a calibration set of about ten reps, for an intermediate male lifter.
 * Dumbbell values are per hand for bilateral two-dumbbell work (single-implement lifts are doubled,
 * see isSingleImplementLift). Kettlebell values are per bell: every bilateral kettlebell lift in the
 * library (deadlift, swing, curl, overhead extension) uses one bell held in both hands.
 */
const COMPOUND: Partial<Record<MovementPattern, Partial<Record<Implement, number>>>> = {
  squat: { barbell: 0.5, dumbbell: 0.15, kettlebell: 0.15 },
  hinge: { barbell: 0.55, dumbbell: 0.15, kettlebell: 0.2 },
  lunge: { barbell: 0.3, dumbbell: 0.1, kettlebell: 0.1 },
  hip_extension: { barbell: 0.6, dumbbell: 0.2, kettlebell: 0.2 },
  horizontal_push: { barbell: 0.4, dumbbell: 0.12, kettlebell: 0.1 },
  vertical_push: { barbell: 0.25, dumbbell: 0.08, kettlebell: 0.08 },
  horizontal_pull: { barbell: 0.35, dumbbell: 0.15, kettlebell: 0.15 },
  // No carry row: loaded carries are timed (no estimate), and the only rep-based "carry" is the
  // Turkish get-up, a skill lift limited by the overhead arm, not by grip.
}

const ISOLATION: Partial<Record<MovementPattern, Partial<Record<Implement, number>>>> = {
  elbow_flexion: { barbell: 0.15, ez_bar: 0.15, dumbbell: 0.06, kettlebell: 0.06 },
  elbow_extension: { barbell: 0.12, ez_bar: 0.12, dumbbell: 0.05, kettlebell: 0.05 },
  shoulder_abduction: { dumbbell: 0.03 },
  horizontal_push: { dumbbell: 0.05 },
  horizontal_pull: { dumbbell: 0.03 },
  hip_extension: { barbell: 0.4, dumbbell: 0.15 },
  // Per hand, standing on a step: grip and balance limit the load long before the calves do, so
  // this sits at the per-hand dumbbell squat value (coaching heuristic).
  calf_raise: { dumbbell: 0.15 },
}

/**
 * Barbell hinges led by the hamstrings (RDLs, good mornings) start lighter than floor pulls. Not
 * applied to dumbbells (coach round 2, R10): the per-hand dumbbell hinge value is already limited
 * by grip, and discounting it again put a 70 kg beginner's dumbbell RDL at 4 kg per hand.
 */
const HAMSTRING_HINGE_FACTOR = 0.7

/**
 * Per-hand fraction for a one-arm dumbbell row braced on a bench (coach round 2, R10). The bench
 * takes the lower back out of the lift, so it starts heavier than the per-hand value of a
 * two-dumbbell bent-over row (0.15). Coaching heuristic, still well under a trained lifter.
 */
const BRACED_SINGLE_ARM_ROW_DUMBBELL = 0.25

/**
 * Bilateral lifts that hold ONE dumbbell in both hands (goblet and sumo squats, the dumbbell hip
 * thrust, swings, two-handed overhead extensions, pullovers), marked by the "single_implement"
 * tag (lib/exercises/library.test.ts keeps it in step with the "one dumbbell" wording). The
 * table's dumbbell values are per hand of a two-dumbbell lift, so these get twice the fraction:
 * the one dumbbell carries the whole load. Kettlebell fractions are already per bell.
 */
const SINGLE_IMPLEMENT_TAG = "single_implement"
const SINGLE_IMPLEMENT_FACTOR = 2

export function isSingleImplementLift(exercise: Exercise): boolean {
  if (exercise.isUnilateral) return false
  return exercise.tags?.includes(SINGLE_IMPLEMENT_TAG) ?? false
}

const EXPERIENCE_FACTOR: Record<UserProfile["experience"], number> = {
  beginner: 0.6,
  intermediate: 1,
  advanced: 1.25,
}

/** Applied to upper- and lower-body work separately; "unspecified" sits between the two. */
const GENDER_FACTOR: Record<UserProfile["gender"], { upper: number; lower: number }> = {
  male: { upper: 1, lower: 1 },
  female: { upper: 0.6, lower: 0.75 },
  unspecified: { upper: 0.8, lower: 0.87 },
}

/**
 * Floor under EXPERIENCE_FACTOR × GENDER_FACTOR. The base fractions are already set well under a
 * trained lifter, so a beginner woman (0.6 × 0.6 = 0.36) would otherwise get a third discount on
 * top of a conservative table (coaching heuristic). An advanced lifter's floor is higher (coach
 * round 2, R10): 1.25 × 0.6 put an advanced woman's dumbbell press at a beginner's 6 kg per hand.
 */
const MIN_PROFILE_FACTOR: Record<UserProfile["experience"], number> = {
  beginner: 0.5,
  intermediate: 0.5,
  advanced: 0.9,
}

/**
 * A strength block's main barbell lifts. With every warmupRequired compound, their first session
 * finds its own load for a trained lifter (see calibratesInRampUp).
 */
const BIG_LIFT_TAG = "big_lift"

/**
 * A strong lifter of a profile may handle about this many times the conservative starting value
 * (coaching heuristic). progression.ts checks a logged load against this upper end, not against
 * the deliberately light guess, so genuine loads of trained lifters are not flagged as slips.
 */
export const UPPER_ESTIMATE_FACTOR = 2

/** Rounding down may cut at most this share of the raw estimate; past it, the next step up is used. */
const MAX_ROUND_DOWN_SHARE = 0.15

const LOWER_GROUPS: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(["quads", "hamstrings", "glutes", "calves"])

/** Lighter for higher reps, a little heavier for low-rep strength work. Baseline is ten reps. */
function repFactor(topReps: number): number {
  return Math.min(1.15, Math.max(0.6, 1.25 - 0.025 * topReps))
}

/** Equipment that carries a load of its own: a lift using any of it is not band-loaded. */
const LOADED_EQUIPMENT: ReadonlySet<Equipment> = new Set<Equipment>([
  "barbell",
  "dumbbell",
  "kettlebell",
  "cable",
  "machine",
  "smith_machine",
  "trap_bar",
  "ez_bar",
  "landmine",
  "medicine_ball",
  "sled",
])

/** An external-load lift whose only resistance is a band (band row, band pushdown). */
export function isBandLoaded(exercise: Exercise): boolean {
  if (exercise.loadType !== "external") return false
  return exercise.equipment.includes("band") && !exercise.equipment.some((e) => LOADED_EQUIPMENT.has(e))
}

function implementOf(exercise: Exercise): Implement | null {
  const eq = exercise.equipment
  // Machines, cables, Smith machines and landmines vary too much between gyms to guess.
  if (eq.some((e) => e === "machine" || e === "cable" || e === "smith_machine" || e === "landmine")) return null
  if (eq.includes("barbell") || eq.includes("trap_bar")) return "barbell"
  if (eq.includes("ez_bar")) return "ez_bar"
  if (eq.includes("dumbbell")) return "dumbbell"
  if (eq.includes("kettlebell")) return "kettlebell"
  return null
}

/** Smallest sensible load per implement, in kg (empty bar, light EZ bar, lightest bells). */
export const MIN_KG: Record<Implement, number> = { barbell: 20, ez_bar: 10, dumbbell: 2, kettlebell: 4 }

/**
 * A raw estimate under the lightest implement plus this many load steps gets no number: its nearest
 * load IS the lightest implement (the empty bar, a 2 kg dumbbell, a 4 kg bell), which says nothing
 * about the lifter, and rounding it up would overshoot the heuristic. For dumbbells and
 * kettlebells, whose step equals the lightest implement, this is 1.5 × MIN_KG. An estimate that
 * still rounds onto the lightest implement (a 21–22 kg barbell value) is dropped the same way, so
 * every number shown is above the rack minimum. Instead, the card asks the lifter to find their
 * working weight.
 */
const MIN_ESTIMATE_STEPS_ABOVE_IMPLEMENT = 0.5

/**
 * Lifts with no honest body-weight estimate: Olympic lifts and skill lifts (the get-up) are
 * limited by technique, not by the muscles a fraction of body weight stands for.
 */
const NO_ESTIMATE_TAGS: readonly string[] = ["olympic", "skill"]

/**
 * Body-weight scaling. Strength does not rise in proportion to body mass, and at the top of the
 * accepted range extra mass is mostly not muscle. Up to the reference weight the estimate is
 * linear (light users stay light); above it, it grows with mass^(2/3) (allometric scaling) and
 * stops at a ceiling. The ceiling is what bounds every lift's estimate per experience level: at
 * most fraction × MAX_EFFECTIVE_BODY_WEIGHT_KG × the experience, gender and rep factors.
 */
const REFERENCE_BODY_WEIGHT_KG = 75
const MAX_EFFECTIVE_BODY_WEIGHT_KG = 110

export function effectiveBodyWeightKg(weightKg: number): number {
  if (weightKg <= REFERENCE_BODY_WEIGHT_KG) return weightKg
  const scaled = REFERENCE_BODY_WEIGHT_KG * Math.pow(weightKg / REFERENCE_BODY_WEIGHT_KG, 2 / 3)
  return Math.min(MAX_EFFECTIVE_BODY_WEIGHT_KG, scaled)
}

export interface StartingLoadEstimate {
  /** Kilograms, rounded to a load the user can set up; null when there is no honest estimate. */
  weightKg: number | null
  /** The unrounded heuristic value in kilograms, null when no heuristic applies to the lift. */
  rawKg: number | null
  /**
   * weightKg is null and the card should ask the lifter to find their working weight: the
   * heuristic lands too close to the lightest implement to mean anything, the lift is a heavy
   * compound a trained lifter calibrates in their ramp-up sets, or the lift is loaded externally
   * but has no heuristic at all (machines, cables, bands, patterns missing from the tables, a
   * profile without body weight; rawKg is null then).
   */
  findWorkingWeight: boolean
  /** The implement the estimate is for, null when the lift has none the engine can estimate. */
  implement: Implement | null
  /** The only resistance is a band: the lifter picks a band, not a weight. Optional; absent means no. */
  band?: boolean
}

const NO_ESTIMATE: StartingLoadEstimate = { weightKg: null, rawKg: null, findWorkingWeight: false, implement: null }

/**
 * Whether a trained lifter's first session on this lift finds its own load instead of showing a
 * body-weight number (coach round 2, R10). For heavy compounds (ramp-up lifts and a strength
 * block's big lifts) a conservative table cannot bound an intermediate or advanced lifter's
 * working weight, and the ramp-up sets are the better calibration. Beginners keep the estimate.
 */
function calibratesInRampUp(exercise: Exercise, experience: UserProfile["experience"]): boolean {
  if (experience === "beginner" || exercise.mechanics !== "compound") return false
  return exercise.warmupRequired || (exercise.tags?.includes(BIG_LIFT_TAG) ?? false)
}

/** Load step for an implement in the user's units. */
export function implementStep(implement: Implement, units: Units): number {
  if (implement === "kettlebell") return KETTLEBELL_STEP[units]
  return loadStep(units, implement === "dumbbell" ? "dumbbell" : "barbell")
}

/** Whether the lift is a one-arm dumbbell row braced on a bench (see BRACED_SINGLE_ARM_ROW_DUMBBELL). */
function isBracedSingleArmRow(exercise: Exercise, implement: Implement, pattern: MovementPattern): boolean {
  return implement === "dumbbell" && pattern === "horizontal_pull" && !!exercise.isUnilateral && exercise.equipment.includes("bench")
}

/**
 * A conservative starting load with the reasoning behind it.
 * - No estimate and no prompt: bodyweight, timed and distance work, or a lift with no rep target,
 *   and Olympic and skill lifts (technique-limited).
 * - "Find your working weight" (weightKg null, findWorkingWeight true): every other external-load
 *   lift the engine cannot put an honest number on (coach round 2, R04): machines, cables, Smith
 *   machines, landmines and bands, a pattern without a heuristic, a profile without body weight
 *   (rawKg null for all of these); a heuristic that lands on the lightest implement; and a heavy
 *   compound for an intermediate or advanced lifter (R10), whose ramp-up sets find the load.
 * - Otherwise the heuristic rounded down to the user's load step when that cuts at most 15% of the
 *   raw value, and up to the next step when rounding down would cut more.
 */
export function estimateStartingLoad(
  exercise: Exercise,
  profile: Pick<UserProfile, "weightKg" | "gender" | "experience" | "units">,
  reps: [number, number] | null,
): StartingLoadEstimate {
  if (exercise.loadType !== "external" || !reps) return NO_ESTIMATE
  if (exercise.tags?.some((t) => NO_ESTIMATE_TAGS.includes(t))) return NO_ESTIMATE
  const implement = implementOf(exercise)
  // Loaded, but nothing to scale from: the card asks the lifter to find the load.
  const unknown: StartingLoadEstimate = { weightKg: null, rawKg: null, findWorkingWeight: true, implement }
  if (isBandLoaded(exercise)) return { ...unknown, band: true }
  if (!implement || !(profile.weightKg > 0)) return unknown

  const table = exercise.mechanics === "compound" ? COMPOUND : ISOLATION
  // Lifts that finish overhead (thrusters) are limited by the press, not by the squat.
  const pattern: MovementPattern = exercise.tags?.includes("overhead") ? "vertical_push" : exercise.movementPattern
  let fraction = table[pattern]?.[implement]
  if (fraction == null && implement === "ez_bar") fraction = table[pattern]?.barbell
  if (fraction == null) return unknown
  if (exercise.mechanics === "compound" && isBracedSingleArmRow(exercise, implement, pattern)) fraction = BRACED_SINGLE_ARM_ROW_DUMBBELL
  if (pattern === "hinge" && exercise.primaryMuscle === "hamstrings" && implement === "barbell") fraction *= HAMSTRING_HINGE_FACTOR
  if (exercise.isUnilateral && implement !== "dumbbell" && implement !== "kettlebell") fraction *= 0.5
  if (implement === "dumbbell" && isSingleImplementLift(exercise)) fraction *= SINGLE_IMPLEMENT_FACTOR

  const lower = LOWER_GROUPS.has(MUSCLE_TO_GROUP[exercise.primaryMuscle])
  const gender = GENDER_FACTOR[profile.gender][lower ? "lower" : "upper"]
  const profileFactor = Math.max(MIN_PROFILE_FACTOR[profile.experience], EXPERIENCE_FACTOR[profile.experience] * gender)
  const bodyWeight = effectiveBodyWeightKg(profile.weightKg)
  const raw = bodyWeight * fraction * profileFactor * repFactor(reps[1])
  const rawKg = Math.round(raw * 100) / 100
  // The heuristic is kept (it bounds the logged-load check) but not shown.
  if (calibratesInRampUp(exercise, profile.experience)) return { weightKg: null, rawKg, findWorkingWeight: true, implement }

  const step = implementStep(implement, profile.units)
  const minInUnits = Math.ceil(fromKg(MIN_KG[implement], profile.units) / step - 1e-9) * step
  const inUnits = fromKg(raw, profile.units)
  const down = Math.floor(inUnits / step + 1e-9) * step
  const rounded = inUnits - down <= MAX_ROUND_DOWN_SHARE * inUnits ? down : down + step
  if (inUnits < minInUnits + MIN_ESTIMATE_STEPS_ABOVE_IMPLEMENT * step || rounded <= minInUnits + 1e-9) {
    return { weightKg: null, rawKg, findWorkingWeight: true, implement }
  }
  const kg = toKg(rounded, profile.units)
  return { weightKg: Math.round(kg * 100) / 100, rawKg, findWorkingWeight: false, implement }
}

/** The starting load in kilograms, or null when there is no honest estimate (see estimateStartingLoad). */
export function startingLoadKg(
  exercise: Exercise,
  profile: Pick<UserProfile, "weightKg" | "gender" | "experience" | "units">,
  reps: [number, number] | null,
): number | null {
  return estimateStartingLoad(exercise, profile, reps).weightKg
}
