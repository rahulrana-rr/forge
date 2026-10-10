/**
 * Goal × experience × role → sets / reps / rest / RIR / tempo, intersected with the
 * exercise's own sensible ranges.
 */
import { DIFFICULTY_RANK, type Exercise, type Goal } from "@/lib/exercises/types"
import type { Experience, WorkoutRole } from "@/lib/domain/types"
import type { LastPerformance } from "./progression"

export type MainRole = Exclude<WorkoutRole, "warmup" | "cooldown">

export interface Prescription {
  sets: number
  reps: [number, number] | null
  durationSeconds: number | null
  restSeconds: number
  rir: number | null
  tempo: string | null
  /** Lowest set count this slot may be trimmed to when fitting the time budget. */
  minSets: number
  /** Highest set count this slot may grow to when there is spare time. */
  maxSets: number
  /**
   * One-sentence progression note for the card when the prescription moved because of the last
   * session (bodyweight reps stepped up, a hold lengthened, a set added, a harder variation due),
   * or, on a bodyweight press or pull's first exposure, what to do when the bottom of the window
   * is out of reach (FIRST_EXPOSURE_NOTE_PREFIX). Absent otherwise.
   */
  note?: string | null
  /** The harder variation the note names, when one passes the user's filter (see harderVariation). */
  suggestedExerciseId?: string | null
  /**
   * Finishers only: the exercise's own minimum block (setsRange[0] rounds at the shortest work
   * interval it allows) does not fit the conditioning budget. The prescription still keeps that
   * minimum; the caller should prefer a finisher whose minimum block fits (see fitsFinisherBudget).
   */
  overBudget?: boolean
}

/**
 * What the engine knows about this lift for this user. Optional: without it the prescription
 * assumes a first exposure (calibration effort, no progression).
 */
export interface PrescribeContext {
  /** The lift's most recent logged performance (progression.ts `lastPerformance`); null when never logged. */
  last?: LastPerformance | null
  /** Where the working load comes from, when the caller already knows it; "estimate" is unproven. */
  weightSource?: "history" | "estimate" | "user" | null
  /**
   * Exercises that may be named as the next, harder variation once a bodyweight lift or hold is
   * maxed out. Only used together with `allows`, which must apply the user's hard filter
   * (equipment, difficulty, limitations, exclusions): a variation is never named without it.
   */
  pool?: readonly Exercise[]
  allows?: (exercise: Exercise) => boolean
}

export interface GoalPrescription {
  sets: [number, number]
  reps: [number, number]
  rest: [number, number]
  rir: [number, number]
  /** Width of the rep window handed to a single slot, e.g. 8–12 for hypertrophy. */
  repWindow: number
  /** Whether the day ends with a conditioning finisher. */
  conditioning: boolean
  label: string
}

export const GOAL_PRESCRIPTIONS: Record<Goal, GoalPrescription> = {
  strength: { sets: [3, 6], reps: [3, 6], rest: [150, 240], rir: [1, 3], repWindow: 2, conditioning: false, label: "Strength block" },
  muscle_gain: { sets: [3, 5], reps: [6, 15], rest: [60, 120], rir: [1, 3], repWindow: 4, conditioning: false, label: "Hypertrophy block" },
  fat_loss: { sets: [2, 4], reps: [10, 15], rest: [45, 75], rir: [2, 3], repWindow: 3, conditioning: true, label: "Fat-loss block" },
  general_fitness: { sets: [2, 4], reps: [10, 15], rest: [45, 75], rir: [2, 3], repWindow: 3, conditioning: true, label: "General fitness block" },
  endurance: { sets: [2, 3], reps: [15, 25], rest: [30, 60], rir: [2, 3], repWindow: 5, conditioning: true, label: "Endurance block" },
}

const SETS_BY_EXPERIENCE: Record<Experience, Record<MainRole, number>> = {
  beginner: { primary_compound: 3, secondary_compound: 3, accessory: 2, isolation: 2, finisher: 2 },
  intermediate: { primary_compound: 4, secondary_compound: 3, accessory: 3, isolation: 3, finisher: 3 },
  advanced: { primary_compound: 5, secondary_compound: 4, accessory: 3, isolation: 3, finisher: 3 },
}

/** Where in the goal's rep range a role sits (0 = heaviest end). */
const REP_POSITION: Record<MainRole, number> = {
  primary_compound: 0,
  secondary_compound: 0.25,
  accessory: 0.6,
  isolation: 1,
  finisher: 1,
}

/** Where in the rest range a role sits (1 = longest). */
const REST_POSITION: Record<MainRole, number> = {
  primary_compound: 0.75,
  secondary_compound: 0.5,
  accessory: 0.4,
  isolation: 0.25,
  finisher: 0.25,
}

const EXPERIENCE_POSITION: Record<Experience, number> = { beginner: 0, intermediate: 0.5, advanced: 1 }

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

export function intersectRange(a: [number, number], b: [number, number]): [number, number] | null {
  const lo = Math.max(a[0], b[0])
  const hi = Math.min(a[1], b[1])
  return lo <= hi ? [lo, hi] : null
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

export function isTimed(exercise: Exercise): boolean {
  if (exercise.loadType === "timed" || exercise.loadType === "distance") return true
  return !exercise.repRange && !!exercise.durationRange
}

/** Working-set bounds for a slot: goal range ∩ exercise range, beginners capped at 3. */
export function setBounds(exercise: Exercise, goal: Goal, experience: Experience, role?: MainRole): [number, number] {
  const g = GOAL_PRESCRIPTIONS[goal]
  let bounds: [number, number] = intersectRange(g.sets, exercise.setsRange) ?? g.sets
  // A strength beginner's support work starts at two sets: the strength floor of three is for the
  // main lifts (coach round 2, R22).
  if (experience === "beginner" && goal === "strength" && (role === "accessory" || role === "isolation")) {
    bounds = [2, Math.max(2, Math.min(3, bounds[1]))]
  }
  if (experience === "beginner") bounds = intersectRange(bounds, [2, 3]) ?? [2, Math.min(3, bounds[0])]
  return [Math.max(1, bounds[0]), Math.max(bounds[0], bounds[1], 2)]
}

/**
 * Lifts whose rep count is limited by technique or by the time a rep takes, not by the load:
 * a lighter bell does not make fifteen Turkish get-ups or fifteen man makers sensible.
 */
const FIXED_REP_TAGS: readonly string[] = ["olympic", "skill", "complex"]

/** Whether the goal's reps may be programmed above the lift's own range (the load can simply be lightened). */
function canLightenForReps(exercise: Exercise): boolean {
  if (exercise.tags?.some((t) => FIXED_REP_TAGS.includes(t))) return false
  return (exercise.loadType === "external" || exercise.loadType === "assisted") && !exercise.warmupRequired
}

/** Lifts whose reps are limited by technique: never prescribed closer than CALIBRATION_RIR to failure. */
const TECHNIQUE_TAGS: readonly string[] = ["skill", "overhead", "olympic", "complex"]

/**
 * Reps in reserve for a lift whose load is not proven by logged sets (a first exposure, or a
 * body-weight starting estimate): the first session calibrates the load, it is not a hard set.
 */
export const CALIBRATION_RIR = 3

/** Jumps, throws and ballistic lifts are stopped when the reps slow down, not near failure: no RIR target. */
function hasRirTarget(exercise: Exercise): boolean {
  const tags = exercise.tags ?? []
  return tags.some((t) => TECHNIQUE_TAGS.includes(t)) || !tags.includes("explosive")
}

/** Movement patterns where the lifter's own body is a heavy load for the working muscles. */
const BODYWEIGHT_STRENGTH_PATTERNS: readonly string[] = ["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull"]

/**
 * Bodyweight presses and pulls (push-up and pike push-up rungs, dips, pull-ups, rows). The body is
 * the load and cannot be lightened within the lift, so the top of the lift's own range is the
 * lifter's capacity and its graduation cue to the next rung, not just the end of a useful range as
 * it is for a glute bridge or a bird dog. Added-load lifts (warmupRequired), eccentric-only and
 * skill work and jumps are excluded: their reps are limited by something else.
 */
function capacityLimited(exercise: Exercise): boolean {
  if (exercise.loadType !== "bodyweight" || isTimed(exercise) || !exercise.repRange) return false
  if (exercise.warmupRequired || exercise.mechanics !== "compound") return false
  if (!BODYWEIGHT_STRENGTH_PATTERNS.includes(exercise.movementPattern)) return false
  const tags = exercise.tags ?? []
  if (tags.includes("eccentric") || tags.some((t) => FIXED_REP_TAGS.includes(t))) return false
  return hasRirTarget(exercise)
}

/**
 * True when the goal's reps can be programmed on this exercise (timed work always fits). A range
 * that only touches the goal's at a single rep does not fit (a pull-up's 5–10 in a 10–15 fat-loss
 * block, a dumbbell press's 6–12 in a 3–6 strength block) unless the load can simply be lightened
 * to the goal's reps. Coach review R06: a bodyweight press or pull does not fit either when the
 * goal's bottom rep plus the reps it must leave in reserve (`rir`, the first-exposure
 * CALIBRATION_RIR unless the caller knows better) is past the lift's own top: a pike push-up
 * (6–12) cannot do fat loss's 10 reps 3 short of failure, so a loadable press should win.
 */
export function repRangeFitsGoal(exercise: Exercise, goal: Goal, rir: number = CALIBRATION_RIR): boolean {
  if (isTimed(exercise) || !exercise.repRange) return true
  const g = GOAL_PRESCRIPTIONS[goal]
  if (capacityLimited(exercise) && g.reps[0] + rir > exercise.repRange[1]) return false
  const inter = intersectRange(g.reps, exercise.repRange)
  if (inter !== null && inter[1] > inter[0]) return true
  return exercise.repRange[0] < g.reps[0] && canLightenForReps(exercise)
}

/** Narrowest rep window worth prescribing: a single rep target leaves no room for double progression. */
const MIN_REP_SPAN = 2

/**
 * Coach review R06: the first window of a bodyweight press or pull leaves its reps in reserve
 * inside the lift's own range (top + CALIBRATION_RIR <= repRange[1]), widening down towards (and
 * at most one rep below) the lift's own floor: knee push-up 9–12 for fat loss rather than 11–14,
 * which needs 14–17 reps of capacity against a 15-rep graduation cue; pike push-up 6–9. A lift
 * whose range is too narrow for that (or no capacity limit) keeps `window`. Progression
 * (progressReps) then climbs from it to the lift's top.
 */
function capacityWindow(exercise: Exercise, goal: Goal, window: [number, number]): [number, number] {
  if (!capacityLimited(exercise) || !exercise.repRange) return window
  const [floor, top] = exercise.repRange
  const hi = top - CALIBRATION_RIR
  if (window[1] <= hi) return window
  let lo = Math.max(floor, hi - GOAL_PRESCRIPTIONS[goal].repWindow)
  if (hi - lo < MIN_REP_SPAN) lo = hi - MIN_REP_SPAN
  if (lo < Math.max(1, floor - 1)) return window
  return [lo, hi]
}

/**
 * Coach review R06: a kettlebell lift lightened to a high-rep goal is capped this many reps past
 * its own range. Bells step by 4 kg, so the load cannot be dropped far enough for 15–20 one-arm
 * presses (6–10 in the library): 12–15 instead.
 */
const KETTLEBELL_LIGHTEN_MAX_EXTRA_REPS = 5
/** Width of a kettlebell window capped by KETTLEBELL_LIGHTEN_MAX_EXTRA_REPS. */
const KETTLEBELL_CAPPED_WINDOW = 3

/** The goal's own window for a lift whose load can simply be lightened, capped for kettlebells. */
function lightenedWindow(exercise: Exercise & { repRange: [number, number] }, goal: Goal): [number, number] {
  const g = GOAL_PRESCRIPTIONS[goal]
  const window: [number, number] = [g.reps[0], Math.min(g.reps[1], g.reps[0] + g.repWindow)]
  const kettlebellOnly = exercise.equipment.length > 0 && exercise.equipment.every((e) => e === "kettlebell")
  const cap = exercise.repRange[1] + KETTLEBELL_LIGHTEN_MAX_EXTRA_REPS
  if (!kettlebellOnly || window[1] <= cap) return window
  return [Math.max(exercise.repRange[1], cap - KETTLEBELL_CAPPED_WINDOW), cap]
}

/** Jumps are power work: a few crisp reps with full rest, never sets taken towards failure. */
export const PLYO_REPS: readonly [number, number] = [3, 5]
export const PLYO_SETS = 3
export const PLYO_MIN_REST_SECONDS = 90

/**
 * Bodyweight jumps (box, broad, skater and squat jumps, plyometric push-ups) programmed as a power
 * primer: 3 × 3–5, at least 90 s rest, no RIR target. Strength and hypertrophy blocks only use
 * them this way; a max-effort jump (a range topping out at 6 reps) is power work in any block.
 * Conditioning goals keep their reps on the higher-rep jumps, and conditioning drills (burpees)
 * and finishers are never primers.
 */
export function isPlyometricPrimer(exercise: Exercise, goal: Goal, role: MainRole): boolean {
  if (role === "finisher" || exercise.loadType !== "bodyweight" || !exercise.repRange) return false
  const tags = exercise.tags ?? []
  if (!tags.includes("explosive") || tags.includes("conditioning")) return false
  return goal === "strength" || goal === "muscle_gain" || exercise.repRange[1] <= 6
}

export function prescribeReps(exercise: Exercise, goal: Goal, role: MainRole): [number, number] | null {
  if (isTimed(exercise) || !exercise.repRange) return null
  if (isPlyometricPrimer(exercise, goal, role)) return [PLYO_REPS[0], PLYO_REPS[1]]
  const window = goalWindow({ ...exercise, repRange: exercise.repRange }, goal, role)
  // Finishers carry no RIR target, so there is no reserve to leave inside the lift's range.
  return role === "finisher" ? window : capacityWindow(exercise, goal, window)
}

/** The goal's window placed on the lift's own range (before any capacity cap). */
function goalWindow(exercise: Exercise & { repRange: [number, number] }, goal: Goal, role: MainRole): [number, number] {
  const g = GOAL_PRESCRIPTIONS[goal]
  const inter = intersectRange(g.reps, exercise.repRange)
  if (inter && inter[1] - inter[0] < Math.min(MIN_REP_SPAN, g.repWindow)) {
    // The two ranges only touch (endurance 15–25 against a machine press's 6–15, strength 3–6
    // against a dumbbell press's 6–12): a single rep target would remove the rep side of double
    // progression and turn every completed session into a load jump.
    const [lo, hi] = exercise.repRange
    const below = lo < g.reps[0]
    const above = hi > g.reps[1]
    // A lift that can simply be lightened takes the goal's own window (machine press 15–20).
    if (below && canLightenForReps(exercise)) return lightenedWindow(exercise, goal)
    // Otherwise widen inside the lift's own range, towards the goal: dumbbell press 6–8 for
    // strength, pull-ups 7–10 for fat loss (capacityWindow then pulls bodyweight lifts lower).
    if (above) return [inter[0], Math.min(hi, inter[0] + g.repWindow)]
    if (below) return [Math.max(lo, inter[1] - g.repWindow), inter[1]]
  }
  if (!inter) {
    const [lo, hi] = exercise.repRange
    // Goal above the lift's range with a load that can simply be lightened (a dumbbell row in an
    // endurance block): program the goal's reps. Heavy barbell lifts that need ramp-up sets and
    // bodyweight moves whose difficulty cannot be scaled keep their own range.
    if (hi < g.reps[0] && canLightenForReps(exercise)) return lightenedWindow(exercise, goal)
    // Otherwise (calf raises in a strength block, a heavy squat in a fat-loss block) use the
    // window of the exercise's own range closest to the goal, never the far end of it.
    const width = Math.min(hi - lo, g.repWindow)
    return lo > g.reps[1] ? [lo, lo + width] : [hi - width, hi]
  }
  const range = inter
  const span = range[1] - range[0]
  const width = Math.min(span, g.repWindow)
  const offset = Math.round((span - width) * REP_POSITION[role])
  return [range[0] + offset, range[0] + offset + width]
}

export function prescribeDuration(exercise: Exercise, experience: Experience): number | null {
  if (!exercise.durationRange) return null
  const [lo, hi] = exercise.durationRange
  return Math.max(5, roundTo(lo + (hi - lo) * EXPERIENCE_POSITION[experience] * 0.6, 5))
}

/**
 * When a compound's own rest range and the goal's do not overlap, rest sits at the goal bound
 * on the exercise's side and never leaves the goal table: a squat in a fat-loss block gets 75 s,
 * and a dumbbell press in a strength block starts at the strength floor rather than four minutes.
 */
function nearestRestRange(goalRest: [number, number], exerciseRest: [number, number]): [number, number] {
  if (exerciseRest[0] > goalRest[1]) return [goalRest[1], goalRest[1]]
  return [goalRest[0], Math.min(goalRest[1], goalRest[0] + 30)]
}

/**
 * Rest floor for non-compound work in a strength block. The 150–240 s strength rests are for the
 * heavy lifts; a coach rests loaded accessories about 90 s and isolation about a minute.
 */
const STRENGTH_SUPPORT_REST: Record<"accessory" | "isolation" | "finisher", [number, number]> = {
  accessory: [90, 120],
  isolation: [60, 90],
  finisher: [30, 60],
}

/**
 * Rest band for heavy compounds (lifts that need ramp-up sets) in a hypertrophy block. Coaching
 * judgment: a back squat or barbell bench is rested two to three minutes even when the goal is
 * size, not the goal table's 60–120 s, so the next set is limited by the muscle, not by
 * leftover whole-body fatigue.
 */
const HEAVY_HYPERTROPHY_REST: [number, number] = [90, 180]

/**
 * Rest band for heavy compounds (lifts that need ramp-up sets) in a strength block (coach review
 * R20). Coaching judgment: a bench, squat or deadlift for 3–6 reps is rested three to four
 * minutes. Unlike the hypertrophy band it is not intersected with the lift's own rest range, which
 * the library sets for general use (a bench's 120–180 s capped a strength primary at 175 s).
 */
const STRENGTH_HEAVY_REST: [number, number] = [180, 240]

/**
 * Lightest working load (kg) that leaves room for lighter ramp-up sets: two load steps above the
 * lightest implement (empty 20 kg bar, 10 kg EZ bar, 2 kg dumbbells, 4 kg bells; see MIN_KG in
 * starting-load.ts). A 4 kg dumbbell press has no lighter set to ramp up with. null when the
 * implement's lightest load is unknown.
 */
function rampFloorKg(exercise: Exercise): number | null {
  const eq = exercise.equipment
  // Machines, cables and Smith machines vary too much between gyms to know their lightest load.
  if (eq.some((e) => e === "machine" || e === "cable" || e === "smith_machine" || e === "landmine")) return null
  if (eq.includes("barbell") || eq.includes("trap_bar")) return 20 + 2 * 2.5
  if (eq.includes("ez_bar")) return 10 + 2 * 2.5
  if (eq.includes("dumbbell")) return 2 + 2 * 2
  if (eq.includes("kettlebell")) return 4 + 2 * 4
  return null
}

/** False when the working load is known and too light for lighter sets below it. */
export function heavyEnoughToRamp(exercise: Exercise, weightKg: number | null | undefined): boolean {
  if (weightKg == null) return true
  const floor = rampFloorKg(exercise)
  return floor === null || weightKg >= floor
}

/**
 * The heavy rest bands apply to lifts that need ramp-up sets (warmupRequired), and only while the
 * planned load (when the caller knows it) is heavy enough to ramp from: a 4 kg incline press or
 * an empty-bar bench rests like the goal's other work (coach review R20).
 */
function heavyCompound(exercise: Exercise, weightKg: number | null | undefined): boolean {
  return !!exercise.warmupRequired && heavyEnoughToRamp(exercise, weightKg)
}

/**
 * Rest range for a (non-timed) compound slot: a heavy strength compound gets STRENGTH_HEAVY_REST
 * as is; otherwise the goal's band (HEAVY_HYPERTROPHY_REST for a heavy hypertrophy compound)
 * within the lift's own range, or the goal bound nearest it.
 */
function compoundRestRange(exercise: Exercise, goal: Goal, weightKg: number | null | undefined): [number, number] {
  const heavy = heavyCompound(exercise, weightKg)
  if (heavy && goal === "strength") return STRENGTH_HEAVY_REST
  const band = heavy && goal === "muscle_gain" ? HEAVY_HYPERTROPHY_REST : GOAL_PRESCRIPTIONS[goal].rest
  return intersectRange(band, exercise.restRange) ?? nearestRestRange(band, exercise.restRange)
}

/**
 * Longest rest the time fitter may grow a slot to. Compounds: the goal's ceiling, or for heavy
 * compounds the top of the heavy band (strength 240 s, hypertrophy 180 s) even where the lift's
 * own range stops lower: a heavy dumbbell press primary (own range 90–120 s) may be lengthened to
 * keep pace with a barbell press secondary at 150 s (coach review R20) or into spare time.
 * Everything else stays near the exercise's own range (its top + 15 s), so spare time is never
 * spent stretching a face pull or a curl to two minutes. Never below the goal's floor. `weightKg`
 * is the planned load, when known.
 */
export function restCeiling(exercise: Exercise, goal: Goal, role: MainRole, weightKg?: number | null): number {
  const g = GOAL_PRESCRIPTIONS[goal]
  if ((role === "primary_compound" || role === "secondary_compound") && !isTimed(exercise)) {
    const heavy = heavyCompound(exercise, weightKg)
    if (heavy && goal === "strength") return Math.max(g.rest[1], STRENGTH_HEAVY_REST[1])
    if (heavy && goal === "muscle_gain") return Math.max(g.rest[1], HEAVY_HYPERTROPHY_REST[1])
    return Math.max(g.rest[1], compoundRestRange(exercise, goal, weightKg)[1])
  }
  // Spare time never stretches a conditioning goal's unloaded trunk drill past its band (C17).
  if (unloadedConditioningTrunk(exercise, goal, role)) return CONDITIONING_TRUNK_REST[1]
  return Math.max(g.rest[0], Math.min(g.rest[1], exercise.restRange[1] + 15))
}

/**
 * Rest the time fitter must never trim a slot below, on top of the caller's own floor: a jump
 * primer keeps its 90 s, a heavy hypertrophy compound the band's 90 s, a heavy strength compound
 * 180 s. 0 when nothing extra is protected. `weightKg` is the planned load, when known.
 */
export function protectedRestSeconds(exercise: Exercise, goal: Goal, role: MainRole, weightKg?: number | null): number {
  if (isPlyometricPrimer(exercise, goal, role)) return PLYO_MIN_REST_SECONDS
  const compound = role === "primary_compound" || role === "secondary_compound"
  if (!compound || isTimed(exercise) || !heavyCompound(exercise, weightKg)) return 0
  if (goal === "strength") return STRENGTH_HEAVY_REST[0]
  if (goal === "muscle_gain") return HEAVY_HYPERTROPHY_REST[0]
  return 0
}

/** Core spec C17: rest band for unloaded trunk drills in the conditioning goals. */
export const CONDITIONING_TRUNK_REST: readonly [number, number] = [30, 45]

/**
 * An unloaded core-category drill (bodyweight or timed, not external or assisted) in a conditioning
 * goal's support work. isLoadable lives in selection.ts, which imports this module: checked here by
 * load type to avoid an import cycle.
 */
function unloadedConditioningTrunk(exercise: Exercise, goal: Goal, role: MainRole): boolean {
  if (!GOAL_PRESCRIPTIONS[goal].conditioning || exercise.category !== "core" || role === "finisher") return false
  if (role === "primary_compound" || role === "secondary_compound") return false
  // A timed drill held with a gym implement (suitcase carry, weighted plank: selection.ts
  // loadableTrunk) is loaded trunk work, which the dosing table rests like other support work.
  if (exercise.loadType === "timed" && exercise.equipment.some((e) => TRUNK_LOAD_IMPLEMENTS.has(e))) return false
  return exercise.loadType !== "external" && exercise.loadType !== "assisted"
}

/** selection.ts GYM_IMPLEMENTS, repeated here because selection.ts imports this module. */
const TRUNK_LOAD_IMPLEMENTS: ReadonlySet<string> = new Set(["barbell", "dumbbell", "kettlebell", "cable", "machine", "smith_machine", "trap_bar", "ez_bar"])

/** Rest between sets. `weightKg` is the planned load, when the caller already knows it. */
export function prescribeRest(exercise: Exercise, goal: Goal, role: MainRole, weightKg?: number | null): number {
  const g = GOAL_PRESCRIPTIONS[goal]
  const compound = role === "primary_compound" || role === "secondary_compound"
  let range: [number, number]
  if (isPlyometricPrimer(exercise, goal, role)) {
    // Full recovery between jump sets: landing quality, not fatigue, is the point.
    range = [Math.max(PLYO_MIN_REST_SECONDS, exercise.restRange[0]), Math.max(PLYO_MIN_REST_SECONDS, exercise.restRange[1])]
  } else if (compound && !isTimed(exercise)) {
    range = compoundRestRange(exercise, goal, weightKg)
  } else if (unloadedConditioningTrunk(exercise, goal, role)) {
    // Core spec C17: unloaded trunk drills cause little systemic fatigue; conditioning goals rest
    // them 30-45 s, within the drill's own range when it overlaps (coaching judgment).
    const band: [number, number] = [CONDITIONING_TRUNK_REST[0], CONDITIONING_TRUNK_REST[1]]
    range = intersectRange(exercise.restRange, band) ?? band
  } else {
    const capped: [number, number] = [Math.min(exercise.restRange[0], g.rest[1]), Math.min(exercise.restRange[1], g.rest[1])]
    const inGoal = intersectRange(capped, [g.rest[0], g.rest[1]])
    range = inGoal ?? capped
    if (!inGoal && goal === "strength" && !compound) {
      // Short-rest support work in a strength block: lift it to the coach's band, never past the
      // goal. Trunk work and isolation work (a prone T-raise or rear-delt fly in an accessory slot)
      // rest like isolation work, not like a loaded accessory (R22).
      const bandRole = role !== "finisher" && (exercise.category === "core" || exercise.mechanics === "isolation") ? "isolation" : role
      const band = STRENGTH_SUPPORT_REST[bandRole as keyof typeof STRENGTH_SUPPORT_REST]
      range = [Math.max(range[0], band[0]), Math.min(g.rest[1], Math.max(range[1], band[1]))]
    } else if (!inGoal && capped[1] < g.rest[0] && role !== "finisher") {
      // A 30-second glute drill in a hypertrophy block still rests close to the goal's floor.
      range = [Math.max(capped[0], g.rest[0] - 15), g.rest[0]]
    }
  }
  return Math.max(0, roundTo(range[0] + (range[1] - range[0]) * REST_POSITION[role], 5))
}

/**
 * Coach review R21: an intermediate or advanced lifter's unproven support work (accessory and
 * isolation lifts that are neither technique-limited nor heavy enough to need ramp-up sets) is
 * taken this close to failure rather than CALIBRATION_RIR. Experienced lifters judge effort well,
 * and with accessories rotating, calibration effort would otherwise cover most of their support
 * work. Beginners, compounds, heavy and technique lifts keep calibration effort.
 */
export const UNPROVEN_SUPPORT_RIR = 2

type RirClass = "loaded" | "conditioning"
/** strength and muscle_gain run RIR 1–3; fat_loss, general_fitness and endurance 2–3. */
const RIR_CLASS: Record<Goal, RirClass> = {
  strength: "loaded",
  muscle_gain: "loaded",
  fat_loss: "conditioning",
  general_fitness: "conditioning",
  endurance: "conditioning",
}

/**
 * RIR above the goal's floor (capped at the goal's ceiling) for a lift with a proven load.
 * Explicit, not interpolated: the goal's floor applies to the primary compound only (trained
 * fresh, and only for advanced lifters), secondary compounds and loaded accessories stay a rep
 * further away because they come after fatigue, and isolation work, the lowest-risk sets, may go
 * to the floor. Intermediates in the conditioning goals work at the floor on accessories and
 * isolation and one rep further on compounds.
 */
const RIR_OFFSET: Record<RirClass, Record<Experience, Record<Exclude<MainRole, "finisher">, number>>> = {
  loaded: {
    beginner: { primary_compound: 2, secondary_compound: 2, accessory: 2, isolation: 2 },
    intermediate: { primary_compound: 1, secondary_compound: 1, accessory: 1, isolation: 1 },
    advanced: { primary_compound: 0, secondary_compound: 1, accessory: 1, isolation: 0 },
  },
  conditioning: {
    beginner: { primary_compound: 1, secondary_compound: 1, accessory: 1, isolation: 1 },
    intermediate: { primary_compound: 1, secondary_compound: 1, accessory: 0, isolation: 0 },
    advanced: { primary_compound: 0, secondary_compound: 1, accessory: 0, isolation: 0 },
  },
}

/**
 * Whether the working load has been proven by logged sets: the lift has history, and for
 * external loads at least one logged set carried a weight (otherwise the card shows a starting
 * estimate). Without a context nothing is known, so the load counts as unproven.
 */
function provenLoad(exercise: Exercise, context: PrescribeContext | undefined): boolean {
  if (!context?.last || context.weightSource === "estimate") return false
  const sets = context.last.sets.filter((s) => (s.reps ?? 0) > 0 || (s.durationSeconds ?? 0) > 0)
  if (sets.length === 0) return false
  if (exercise.loadType === "external") return sets.some((s) => (s.weightKg ?? 0) > 0)
  return true
}

/** Trunk patterns trained by resisting movement (core spec C14). */
export const ANTI_MOVEMENT_PATTERNS: ReadonlySet<string> = new Set(["anti_extension", "anti_rotation", "anti_lateral_flexion", "carry"])

/**
 * Core-category anti-movement work (dead bugs, rollouts, Pallof presses, side planks, suitcase
 * carries): effort is judged by position, so it has no RIR target. A dynamic side bend (data tag
 * "lateral_flexion") is flexion work, whatever its pattern; conditioning drills are not trunk work.
 */
export function isAntiMovementTrunk(exercise: Exercise): boolean {
  if (exercise.category !== "core" || !ANTI_MOVEMENT_PATTERNS.has(exercise.movementPattern)) return false
  const tags = exercise.tags ?? []
  return !tags.includes("lateral_flexion") && !tags.includes("conditioning")
}

export function prescribeRir(
  exercise: Exercise,
  goal: Goal,
  experience: Experience,
  role: MainRole,
  context?: PrescribeContext,
): number | null {
  if (isTimed(exercise) || role === "finisher") return null
  // Core spec C14: anti-movement trunk work is stopped on position, not on reps in reserve (the card
  // says when: slot-notes.ts positionStopCue). A failed rollout ends in loaded lumbar extension.
  if (isAntiMovementTrunk(exercise)) return null
  const technique = (exercise.tags ?? []).some((t) => TECHNIQUE_TAGS.includes(t))
  // Jumps, throws and ballistic lifts are stopped when the reps slow down, not near failure.
  if (!hasRirTarget(exercise)) return null
  const [lo, hi] = GOAL_PRESCRIPTIONS[goal].rir
  const rir = Math.min(hi, lo + RIR_OFFSET[RIR_CLASS[goal]][experience][role])
  if (technique) return Math.max(rir, CALIBRATION_RIR)
  if (provenLoad(exercise, context)) return rir
  const support = role === "accessory" || role === "isolation"
  if (support && experience !== "beginner" && !exercise.warmupRequired) return Math.max(rir, UNPROVEN_SUPPORT_RIR)
  return Math.max(rir, CALIBRATION_RIR)
}

export function prescribeTempo(exercise: Exercise, goal: Goal, role: MainRole): string | null {
  if (exercise.tempo) return exercise.tempo
  if (isTimed(exercise) || role === "finisher") return null
  return goal === "muscle_gain" ? "2-0-1-0" : null
}

/** Reps a bodyweight window moves up after a session with every set at its top. */
const REP_STEP = 3
/** Seconds a hold grows after a session with every block held in full. */
const HOLD_STEP_SECONDS = 5
/**
 * Strength blocks stop adding bodyweight reps at the goal's top plus the minimum window (8), or at
 * the base window's top when the lift already starts higher: past it the sets are no longer
 * strength work, and an extra set, then a harder variation, is the strength progression.
 */
const STRENGTH_REP_CEILING = GOAL_PRESCRIPTIONS.strength.reps[1] + MIN_REP_SPAN

/** Where unloaded work (bodyweight reps, timed holds) stands after the last session. */
interface UnloadedProgression {
  reps: [number, number] | null
  durationSeconds: number | null
  /** Every set reached the top of the window (or the full hold) at no more than the prescribed effort. */
  topHit: boolean
  /** The window or hold cannot move further up for this exercise and goal. */
  atCeiling: boolean
  /** A set fell short of the bottom of the window (or of the hold). */
  missed: boolean
  stepped: boolean
}

/**
 * Bodyweight rep work (no added load, no assistance) and timed holds progress through the
 * prescription itself: the load cannot be raised, so the reps or seconds are. Interval and
 * cardio blocks, jump primers, skill lifts and complexes do not.
 */
function progressesUnloaded(exercise: Exercise, goal: Goal, role: MainRole, last: LastPerformance): boolean {
  if (role === "finisher" || exercise.category === "cardio" || exercise.loadType === "distance") return false
  const tags = exercise.tags ?? []
  if (tags.some((t) => t === "intervals" || t === "hiit" || FIXED_REP_TAGS.includes(t))) return false
  if (isPlyometricPrimer(exercise, goal, role)) return false
  if (isTimed(exercise)) return !!exercise.durationRange
  // Weighted or assisted sets progress by load (progression.ts), not by reps.
  return exercise.loadType === "bodyweight" && !!exercise.repRange && !last.sets.some((s) => (s.weightKg ?? 0) !== 0)
}

function progressReps(
  exercise: Exercise & { repRange: [number, number] },
  goal: Goal,
  base: [number, number],
  rir: number | null,
  last: LastPerformance,
): UnloadedProgression {
  const ceiling = goal === "strength" ? Math.min(exercise.repRange[1], Math.max(base[1], STRENGTH_REP_CEILING)) : exercise.repRange[1]
  // Continue from last session's window when it is a progression of today's (same width, not
  // below it, not past the ceiling); a goal or slot change starts again from the base window. A
  // window already at the ceiling continues whatever its width: the lifter worked at the lift's
  // top (an endurance knee push-up at 10–15 before the first window was capped at 8–12, R06), so
  // the ceiling rules apply (one more set, then the harder variation), not a restart lower down.
  const prev = last.prescribedReps
  const continues =
    !!prev &&
    prev[0] >= base[0] &&
    prev[1] <= ceiling &&
    (prev[1] - prev[0] === base[1] - base[0] || (prev[1] === ceiling && prev[1] - prev[0] >= MIN_REP_SPAN))
  const window: [number, number] = prev && continues ? [prev[0], prev[1]] : base
  const done = last.sets.filter((s) => s.reps !== null && s.reps > 0)
  const none: UnloadedProgression = { reps: window, durationSeconds: null, topHit: false, atCeiling: window[1] >= ceiling, missed: false, stepped: false }
  if (done.length === 0) return none
  const missed = done.some((s) => (s.reps ?? 0) < window[0])
  // "At or above the prescribed RIR": a logged RPE that leaves fewer reps in reserve than asked
  // means the top of the window was a grind, so the window holds.
  const easyEnough = done.every((s) => s.rpe == null || rir === null || 10 - s.rpe >= rir)
  const topHit = easyEnough && done.every((s) => (s.reps ?? 0) >= window[1])
  if (!topHit) return { ...none, missed }
  const step = Math.min(REP_STEP, ceiling - window[1])
  if (step <= 0) return { ...none, topHit, atCeiling: true }
  return { ...none, reps: [window[0] + step, window[1] + step], topHit, atCeiling: window[1] + step >= ceiling, stepped: true }
}

/**
 * Core spec C18: the longest a core-category hold is programmed. Holds past about 45-60 s mostly
 * train endurance, so strength and hypertrophy lifters and every beginner stop at 45 s and others at
 * 60 s (or the drill's own top when lower); past it the hold progresses by a set, then a harder
 * variation. Carries and conditioning drills are not holds. Undefined for everything else.
 */
export function coreHoldCeiling(exercise: Exercise, goal: Goal, experience: Experience): number | undefined {
  if (!isCoreHold(exercise) || !exercise.durationRange) return undefined
  const cap = goal === "strength" || goal === "muscle_gain" || experience === "beginner" ? 45 : 60
  return Math.min(cap, exercise.durationRange[1])
}

/** A core-category timed hold (plank, side plank, hollow hold), not a carry or a conditioning drill. */
export function isCoreHold(exercise: Exercise): boolean {
  if (exercise.category !== "core" || !isTimed(exercise) || exercise.movementPattern === "carry") return false
  return !exercise.tags?.includes("conditioning")
}

function progressHold(exercise: Exercise & { durationRange: [number, number] }, base: number, last: LastPerformance, ceilingCap?: number): UnloadedProgression {
  const ceiling = Math.max(base, Math.min(exercise.durationRange[1], ceilingCap ?? Number.POSITIVE_INFINITY))
  const held = last.sets.map((s) => s.durationSeconds ?? 0).filter((d) => d > 0)
  const none: UnloadedProgression = { reps: null, durationSeconds: base, topHit: false, atCeiling: base >= ceiling, missed: false, stepped: false }
  if (held.length === 0) return none
  // The target last time, when progression.ts carries it; otherwise the shortest block held
  // stands for it (a plain "done" logs the target).
  const known = last.prescribedDurationSeconds
  const shortest = Math.min(...held)
  const target = known != null && known > 0 ? known : Math.floor(shortest / HOLD_STEP_SECONDS) * HOLD_STEP_SECONDS
  // Below today's base (a shorter hold than this level starts at): start from the base.
  if (target < base) return { ...none, missed: shortest < base }
  const current = Math.min(target, ceiling)
  // A block fell short of last session's target: hold the same time again.
  if (shortest < target) return { ...none, durationSeconds: current, atCeiling: current >= ceiling, missed: true }
  if (current >= ceiling) return { ...none, durationSeconds: ceiling, topHit: true, atCeiling: true }
  const next = Math.min(ceiling, current + HOLD_STEP_SECONDS)
  return { ...none, durationSeconds: next, topHit: true, atCeiling: next >= ceiling, stepped: true }
}

/**
 * The next, harder exercise for a maxed-out bodyweight lift or hold, among exercises the user may
 * do: the parent of a regression (knee push-up to push-up), a harder child variation, then a
 * harder or loadable same-pattern alternative. Jumps are never a strength progression.
 */
export function harderVariation(
  exercise: Exercise,
  goal: Goal,
  pool: readonly Exercise[],
  allows: (exercise: Exercise) => boolean,
  role: MainRole = "primary_compound",
): Exercise | null {
  const byId = new Map(pool.map((e) => [e.id, e]))
  const rank = (e: Exercise) => DIFFICULTY_RANK[e.difficulty]
  const regression = !!exercise.tags?.includes("beginner_friendly")
  const usable = (e: Exercise | undefined): e is Exercise =>
    !!e &&
    e.id !== exercise.id &&
    e.movementPattern === exercise.movementPattern &&
    !e.tags?.includes("explosive") &&
    (e.goalCompatibility.length === 0 || e.goalCompatibility.includes(goal)) &&
    allows(e)
  const parent = exercise.variationOf ? byId.get(exercise.variationOf) : undefined
  // A harder bodyweight rung whose window would still start above the goal's top rep (pike push-ups
  // for a fat-loss lifter at 6–9) is not the goal's work: a loadable same-pattern alternative goes
  // first when the user can do one (coach round 2, R12).
  const outOfGoal = (e: Exercise) => {
    const window = e.loadType === "bodyweight" ? prescribeReps(e, goal, role) : null
    return !!window && window[0] > GOAL_PRESCRIPTIONS[goal].reps[1]
  }
  const loadableAlternative = () =>
    exercise.alternativeExercises
      .map((id) => byId.get(id))
      .find((alt): alt is Exercise => usable(alt) && alt.loadType === "external" && rank(alt) >= rank(exercise))
  if (usable(parent) && (regression || rank(parent) > rank(exercise))) {
    if (outOfGoal(parent)) return loadableAlternative() ?? parent
    return parent
  }
  const children = pool
    .filter((e) => e.variationOf === exercise.id && rank(e) > rank(exercise) && usable(e))
    .sort((a, b) => rank(a) - rank(b))
  if (children[0]) return children[0]
  for (const id of exercise.alternativeExercises) {
    const alt = byId.get(id)
    if (!usable(alt)) continue
    const harder = rank(alt) > rank(exercise)
    const loadable = alt.loadType === "external" && exercise.loadType !== "external"
    const offRamp = regression && rank(alt) >= rank(exercise) && !alt.tags?.includes("beginner_friendly")
    if (harder || loadable || offRamp) return alt
  }
  return null
}

/**
 * An easier bodyweight variation of the same pattern the user may do, for a lifter who cannot
 * reach the bottom of a bodyweight window: an easier child (pike push-up to hands-elevated pike
 * push-up), a beginner-friendly sibling (knee push-up to incline push-up), then an easier listed
 * alternative. Lowest difficulty first, beginner-friendly rungs first, then family order.
 */
export function easierVariation(
  exercise: Exercise,
  goal: Goal,
  pool: readonly Exercise[],
  allows: (exercise: Exercise) => boolean,
): Exercise | null {
  const rank = (e: Exercise) => DIFFICULTY_RANK[e.difficulty]
  const friendly = (e: Exercise) => !!e.tags?.includes("beginner_friendly")
  // Core spec C18: a hold regresses to an easier hold (side plank to knee side plank).
  const easier = (e: Exercise) =>
    e.id !== exercise.id &&
    (e.loadType === "bodyweight" || (isTimed(exercise) && isTimed(e))) &&
    e.movementPattern === exercise.movementPattern &&
    !e.tags?.includes("explosive") &&
    (rank(e) < rank(exercise) || (friendly(e) && rank(e) <= rank(exercise))) &&
    (e.goalCompatibility.length === 0 || e.goalCompatibility.includes(goal)) &&
    allows(e)
  const children = pool.filter((e) => e.variationOf === exercise.id)
  const siblings = exercise.variationOf ? pool.filter((e) => e.variationOf === exercise.variationOf && friendly(e)) : []
  const alternatives = exercise.alternativeExercises
    .map((id) => pool.find((e) => e.id === id))
    .filter((e): e is Exercise => e !== undefined)
  const ordered = [...new Set([...children, ...siblings, ...alternatives])].filter(easier)
  const best = ordered
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e) - rank(b.e) || Number(friendly(b.e)) - Number(friendly(a.e)) || a.i - b.i)
  return best[0]?.e ?? null
}

/** How the first-exposure note on a bodyweight press or pull begins (coach review R06; lib/coach/notes.ts can match it). */
export const FIRST_EXPOSURE_NOTE_PREFIX = "If you cannot reach"

/**
 * First exposure to a bodyweight press or pull whose first window was capped to leave reps in
 * reserve, or that is itself a regression rung: what to do when the bottom of the window is out
 * of reach. Names the easier variation when one passes the user's filter.
 */
function firstExposureNote(lo: number, easier: Exercise | null): string {
  return `${FIRST_EXPOSURE_NOTE_PREFIX} ${lo} reps, switch to ${easier ? easier.name : "an easier variation"}.`
}

/** How the regression note on a core hold begins (core spec C18; lib/coach/notes.ts can match it). */
export const FIRST_HOLD_NOTE_PREFIX = "If you cannot hold"

/** Core spec C18: the regression note on a core hold's first exposure or after a missed hold. */
export function firstHoldNote(seconds: number, easier: Exercise): string {
  return `${FIRST_HOLD_NOTE_PREFIX} ${seconds} s with your hips level, switch to ${easier.name}.`
}

/** No logged set (reps or time) for this lift: today is its first exposure. */
function isFirstExposure(last: LastPerformance | null | undefined): boolean {
  return !last || !last.sets.some((s) => (s.reps ?? 0) > 0 || (s.durationSeconds ?? 0) > 0)
}

/** Core spec C16: sessions of this length or less get the short trunk dose. */
export const SHORT_SESSION_MINUTES = 30
/** Core spec C16: the short trunk dose: 2 sets, one-sided holds at most 30 s and reps at most 6-8 per side. */
export const SHORT_CORE_SETS = 2
export const SHORT_CORE_HOLD_SECONDS = 30
export const SHORT_CORE_REPS: readonly [number, number] = [6, 8]

/**
 * Core spec C16: the short-session trunk dose (sessions of SHORT_SESSION_MINUTES or less, every core
 * plan, protected or not): exactly 2 sets; a one-sided hold at most 30 s per side and a one-sided rep
 * window at most [min(lo, 6), min(hi, 8)] per side. Duration.ts adds no feeder set to trunk work
 * (C15). A note that names the longer hold or the old window no longer describes the slot; a hold's
 * regression note is kept with today's time. Mutates the prescription.
 */
export function applyShortCoreDose(rx: Prescription, exercise: Exercise): void {
  rx.sets = rx.minSets = rx.maxSets = SHORT_CORE_SETS
  if (!exercise.isUnilateral) return
  const regression = (note: string | null | undefined) => !!note?.startsWith(FIRST_HOLD_NOTE_PREFIX)
  if (rx.durationSeconds !== null && rx.durationSeconds > SHORT_CORE_HOLD_SECONDS) {
    const before = rx.durationSeconds
    rx.durationSeconds = SHORT_CORE_HOLD_SECONDS
    if (regression(rx.note)) rx.note = rx.note?.replace(`hold ${before} s`, `hold ${SHORT_CORE_HOLD_SECONDS} s`) ?? null
    else rx.note = null
  }
  if (rx.reps) {
    const reps: [number, number] = [Math.min(rx.reps[0], SHORT_CORE_REPS[0]), Math.min(rx.reps[1], SHORT_CORE_REPS[1])]
    if (reps[0] !== rx.reps[0] || reps[1] !== rx.reps[1]) {
      rx.reps = reps
      if (!regression(rx.note)) rx.note = null
    }
  }
}

/** Lowering time a tempo progression starts from when the current tempo lowers faster. */
const SLOW_ECCENTRIC_SECONDS = 3
/** Longest lowering a tempo progression asks for. */
export const MAX_ECCENTRIC_SECONDS = 6

/**
 * The next slower-lowering tempo (eccentric-pause-concentric-pause): one second more on the
 * eccentric, up to 6 s ("4-0-X-0" → "5-0-X-0"), or 3 s when the current lowering is shorter
 * ("2-0-1-0" → "3-0-1-0"; no tempo → "3-0-1-0"). Null when the lowering is already 6 s or the
 * tempo cannot be read (coach round 2, R12: a fixed "lower in 3 s" note contradicted a 4 s tempo).
 */
export function slowerEccentricTempo(tempo: string | null | undefined): string | null {
  if (!tempo) return `${SLOW_ECCENTRIC_SECONDS}-0-1-0`
  const parts = tempo.split("-").map((p) => p.trim())
  const eccentric = parts[0] ?? ""
  if (parts.length !== 4 || !/^\d+$/.test(eccentric)) return null
  const seconds = Number(eccentric)
  if (seconds >= MAX_ECCENTRIC_SECONDS) return null
  return [String(Math.max(SLOW_ECCENTRIC_SECONDS, seconds + 1)), ...parts.slice(1)].join("-")
}

/**
 * Rest taken off per session, once a conditioning goal's bodyweight lift is maxed out with no
 * harder variation, before the lowering slows (coach round 2, R12): density is the endurance,
 * fat-loss and general-fitness lever.
 */
export const REST_CUT_STEP_SECONDS = 15

/** Full prescription for a main-phase slot. */
export function prescribe(
  exercise: Exercise,
  goal: Goal,
  experience: Experience,
  role: MainRole,
  context?: PrescribeContext,
): Prescription {
  const [minSets, maxSets] = setBounds(exercise, goal, experience, role)
  const target = isPlyometricPrimer(exercise, goal, role) ? PLYO_SETS : SETS_BY_EXPERIENCE[experience][role]
  let sets = clamp(target, minSets, maxSets)
  let reps = prescribeReps(exercise, goal, role)
  let durationSeconds = reps ? null : prescribeDuration(exercise, experience)
  // Core spec C18: a core hold starts, and progresses, no longer than its ceiling.
  const holdCeiling = role === "finisher" ? undefined : coreHoldCeiling(exercise, goal, experience)
  if (durationSeconds !== null && holdCeiling !== undefined) durationSeconds = Math.min(durationSeconds, holdCeiling)
  const rir = prescribeRir(exercise, goal, experience, role, context)
  let note: string | null = null
  let suggestedExerciseId: string | null = null
  // An earned slower lowering or a shortened rest at the rep ceiling (coach round 2, R12).
  let tempoOverride: string | null = null
  let restOverride: number | null = null

  const last = context?.last
  if (last && progressesUnloaded(exercise, goal, role, last)) {
    let p: UnloadedProgression | null = null
    if (reps && exercise.repRange) p = progressReps({ ...exercise, repRange: exercise.repRange }, goal, reps, rir, last)
    else if (durationSeconds !== null && exercise.durationRange) {
      p = progressHold({ ...exercise, durationRange: exercise.durationRange }, durationSeconds, last, holdCeiling)
    }
    if (p) {
      reps = p.reps
      durationSeconds = p.durationSeconds
      const today = reps ? `${reps[0]}–${reps[1]} reps` : `${durationSeconds ?? 0} s per set`
      const lastSets = last.sets.length
      if (p.stepped) {
        note = reps ? `Top of the range last time: ${today} today.` : `Full hold on every set last time: ${today} today.`
      } else if (p.topHit && p.atCeiling) {
        // The window cannot move: one more set, then a harder variation.
        if (lastSets < maxSets) {
          sets = Math.max(sets, Math.min(maxSets, lastSets + 1))
          note = "Top of the range on every set last time: one more set today."
        } else {
          sets = Math.max(sets, maxSets)
          const next = context?.pool && context.allows ? harderVariation(exercise, goal, context.pool, context.allows, role) : null
          suggestedExerciseId = next?.id ?? null
          if (next) note = `Top of the range on every set last time: you are ready for ${next.name}.`
          else if (!reps) note = "Full hold on every set last time: you are ready for a harder variation."
          else {
            // No harder variation the user can do (coach round 2, R12). Conditioning goals first
            // take rest off, then every goal slows the lowering from the tempo actually prescribed,
            // one second at a time up to 6 s; at 6 s the lift has outgrown itself.
            const goalRest = GOAL_PRESCRIPTIONS[goal].rest
            const lastRest = last.prescribedRestSeconds ?? null
            const restNow = lastRest ?? prescribeRest(exercise, goal, role)
            const tempoNow = last.prescribedTempo ?? prescribeTempo(exercise, goal, role)
            const slower = slowerEccentricTempo(tempoNow)
            if (GOAL_PRESCRIPTIONS[goal].conditioning && restNow > goalRest[0]) {
              restOverride = Math.max(goalRest[0], restNow - REST_CUT_STEP_SECONDS)
              note = `Top of the range on every set last time: ${restOverride} s rest between sets today.`
            } else if (slower) {
              tempoOverride = slower
              if (lastRest !== null) restOverride = Math.max(goalRest[0], Math.min(lastRest, prescribeRest(exercise, goal, role)))
              const seconds = slower.split("-")[0]
              note = `Top of the range on every set last time: lower each rep over ${seconds} s (tempo ${slower}).`
            } else {
              tempoOverride = tempoNow
              note = "Top of the range on every set at the slowest lowering: you are ready for a harder variation or added load."
            }
          }
        }
      } else if (p.atCeiling) {
        // Repeat the sets earned at the ceiling until every one is at the top.
        sets = Math.max(sets, Math.min(maxSets, lastSets))
      }
      if (p.missed) note = `Same target as last time (${today}): ${reps ? "own every rep" : "hold every set in full"} before it moves up.`
      // Core spec C18: a missed core hold names the easier hold to switch to.
      if (p.missed && durationSeconds !== null && holdCeiling !== undefined) {
        const easier = context?.pool && context.allows ? easierVariation(exercise, goal, context.pool, context.allows) : null
        if (easier) note = firstHoldNote(durationSeconds, easier)
      }
    }
  }
  // Core spec C18: the first exposure to a core hold names the easier hold, as push-ups do.
  if (!note && durationSeconds !== null && holdCeiling !== undefined && isFirstExposure(last)) {
    const easier = context?.pool && context.allows ? easierVariation(exercise, goal, context.pool, context.allows) : null
    if (easier) note = firstHoldNote(durationSeconds, easier)
  }
  if (!note && reps && rir !== null && role !== "finisher" && capacityLimited(exercise) && isFirstExposure(last) && exercise.repRange) {
    const window = goalWindow({ ...exercise, repRange: exercise.repRange }, goal, role)
    const capped = reps[1] < window[1]
    if (capped || exercise.tags?.includes("beginner_friendly")) {
      const easier = context?.pool && context.allows ? easierVariation(exercise, goal, context.pool, context.allows) : null
      note = firstExposureNote(reps[0], easier)
    }
  }

  let restSeconds = restOverride ?? prescribeRest(exercise, goal, role)
  // A beginner's bodyweight or timed trunk drill (bird dog, dead bug) keeps its own short rest in a
  // strength block, not the support band (R22).
  const compoundSlot = role === "primary_compound" || role === "secondary_compound"
  if (experience === "beginner" && goal === "strength" && !compoundSlot && exercise.category === "core" && exercise.loadType !== "external") {
    restSeconds = Math.min(restSeconds, exercise.restRange[1])
  }
  const rx: Prescription = {
    sets,
    reps,
    durationSeconds,
    restSeconds,
    rir,
    tempo: tempoOverride ?? prescribeTempo(exercise, goal, role),
    minSets: Math.min(2, sets),
    maxSets,
  }
  if (note) rx.note = note
  if (suggestedExerciseId) rx.suggestedExerciseId = suggestedExerciseId
  return rx
}

/** Conditioning finisher budget (seconds of work + rest) by session length, before the goal's share. */
function baseFinisherBudgetSeconds(durationMinutes: number): number {
  if (durationMinutes <= 30) return 240
  if (durationMinutes <= 45) return 360
  if (durationMinutes <= 60) return 480
  return 600
}

/**
 * Coach review R02: how much of the base finisher budget each goal gets. Fat loss and general
 * fitness take 1.3× (at 45 minutes 6 × 20 s of fast feet was two minutes of work); strength and
 * hypertrophy keep the base. Endurance is sized by ENDURANCE_FINISHER_SHARE instead.
 */
const FINISHER_BUDGET_SCALE: Record<Goal, number> = { strength: 1, muscle_gain: 1, fat_loss: 1.3, general_fitness: 1.3, endurance: 1 }
/** Endurance: the conditioning block is about a quarter of the session (450 s at 30 min, 660 s at 45). */
const ENDURANCE_FINISHER_SHARE = 0.25
const FINISHER_BUDGET_STEP_SECONDS = 30

/**
 * Conditioning finisher budget (seconds of work + rest between rounds) by session length and goal.
 * Without a goal, the base budget (what strength and hypertrophy get).
 */
export function finisherBudgetSeconds(durationMinutes: number, goal?: Goal): number {
  const base = baseFinisherBudgetSeconds(durationMinutes)
  if (!goal) return base
  const step = FINISHER_BUDGET_STEP_SECONDS
  if (goal === "endurance") return Math.max(base, Math.floor((durationMinutes * 60 * ENDURANCE_FINISHER_SHARE) / step) * step)
  return Math.round((base * FINISHER_BUDGET_SCALE[goal]) / step) * step
}

/** Longest low end of a duration range a conditioning finisher may have (filters steady-state cardio). */
export const FINISHER_MAX_BLOCK_SECONDS = 300

/** How far a beginner's finisher block may be lengthened past its prescribed duration. */
export const BEGINNER_FINISHER_EXTRA_SECONDS = 10

/** Shortest work interval a finisher round is given when its own range does not say. */
const FINISHER_MIN_WORK_SECONDS = 20
/** A finisher's minimum block may run this far past the budget and still count as fitting it. */
export const FINISHER_BUDGET_TOLERANCE = 1.1
/**
 * Share of the planned rounds the time fitter may never trim a finisher below (never below the
 * exercise's own minimum either): conditioning is the goal's work, not filler (coach review R02).
 */
const FINISHER_PROTECTED_SHARE = 0.75

/** Seconds a block of rounds takes: work every round, rest between rounds (none after the last). */
export function finisherBlockSeconds(rounds: number, workSeconds: number, restSeconds: number): number {
  return rounds * workSeconds + Math.max(0, rounds - 1) * restSeconds
}

/**
 * A conditioning block sized to the budget: rounds × work + (rounds − 1) × rest ≈ budget, with
 * rounds inside the exercise's own setsRange (coach review R02: four rowing intervals against a
 * 6–10 range, one 120 s round of shadow boxing against 3–6, were no longer the exercise).
 * Rest is about one-to-one with work but never below the exercise's own minimum: all-out sprints
 * keep their 90 s walk-back. When even the minimum rounds overrun the budget, each block is
 * shortened towards the shortest the exercise allows (a steady block never below its own minimum
 * duration); if that is still too long the block keeps the exercise's minimum and is flagged
 * `overBudget`, so the caller can prefer a finisher that fits (fitsFinisherBudget).
 * minSets protects 75% of the planned rounds (at least the exercise's minimum) from the time
 * fitter; maxSets is the exercise's own maximum, so spare time can add rounds.
 */
export function prescribeFinisher(exercise: Exercise, goal: Goal, experience: Experience, budgetSeconds: number): Prescription {
  const base = prescribe(exercise, goal, experience, "finisher")
  const minRounds = Math.max(1, exercise.setsRange[0])
  const maxRounds = Math.max(minRounds, exercise.setsRange[1])
  const protectedRounds = (rounds: number) => Math.min(rounds, Math.max(minRounds, Math.ceil(rounds * FINISHER_PROTECTED_SHARE)))
  if (base.reps && !base.durationSeconds) {
    // Rep-based finishers (swings, burpees) keep the set table's count, never below the exercise's
    // own minimum; beginners may grow to 3 sets, others to the exercise's maximum.
    const sets = Math.max(base.sets, minRounds)
    const top = experience === "beginner" ? Math.min(maxRounds, 3) : maxRounds
    return { ...base, sets, minSets: protectedRounds(sets), maxSets: Math.max(sets, top) }
  }
  const range = exercise.durationRange
  const shortest = range ? range[0] : FINISHER_MIN_WORK_SECONDS
  const restFor = (work: number) => Math.max(exercise.restRange[0], Math.min(base.restSeconds, work))
  let work = Math.max(FINISHER_MIN_WORK_SECONDS, shortest, Math.min(base.durationSeconds ?? 40, budgetSeconds))
  let rest = restFor(work)
  let rounds = clamp(Math.round((budgetSeconds + rest) / (work + rest)), minRounds, maxRounds)
  let overBudget = false
  if (finisherBlockSeconds(minRounds, work, rest) > budgetSeconds) {
    // The exercise's minimum does not fit: shorter blocks first, never fewer rounds.
    while (work - 5 >= shortest && finisherBlockSeconds(minRounds, work, rest) > budgetSeconds) {
      work -= 5
      rest = restFor(work)
    }
    rounds = minRounds
    overBudget = finisherBlockSeconds(rounds, work, rest) > budgetSeconds * FINISHER_BUDGET_TOLERANCE
  } else if (rounds === maxRounds && range) {
    // Rounds are maxed: lengthen each block towards the budget, within the exercise's range.
    // Beginners lengthen by 10 s at most and accept a shorter finisher: 40 s bear crawls are not
    // a first-month block.
    const perRound = Math.floor((budgetSeconds + rest) / rounds) - rest
    let longest = Math.min(range[1], budgetSeconds)
    if (experience === "beginner") longest = Math.min(longest, (base.durationSeconds ?? work) + BEGINNER_FINISHER_EXTRA_SECONDS)
    work = clamp(roundTo(perRound, 5), work, Math.max(work, longest))
  }
  const rx: Prescription = { ...base, durationSeconds: work, restSeconds: rest, sets: rounds, minSets: protectedRounds(rounds), maxSets: maxRounds }
  if (overBudget) rx.overBudget = true
  return rx
}

/**
 * Whether the exercise's minimum conditioning block fits the budget (within
 * FINISHER_BUDGET_TOLERANCE): march in place (300 s minimum) does not fit a 240 s budget, and six
 * sprint intervals with 90 s walk-backs do not fit a 300 s one. Finisher selection should prefer
 * candidates that fit.
 */
export function fitsFinisherBudget(exercise: Exercise, goal: Goal, experience: Experience, budgetSeconds: number): boolean {
  return !prescribeFinisher(exercise, goal, experience, budgetSeconds).overBudget
}

/** Where in a warm-up/cool-down duration range the session length lands (longer sessions, longer blocks). */
function lightPosition(durationMinutes: number): number {
  if (durationMinutes <= 30) return 0
  if (durationMinutes <= 45) return 0.25
  if (durationMinutes <= 60) return 0.5
  return 0.75
}

/** Most reps per side a unilateral warm-up primer asks for (16–24 lunges is a working set, not a primer). */
export const LIGHT_MAX_REPS_PER_SIDE = 8

/** Light prescription for warm-up and cool-down items: one round, short rest. */
export function prescribeLight(exercise: Exercise, durationMinutes: number): Prescription {
  const timed = isTimed(exercise) || !exercise.repRange
  let durationSeconds: number | null = null
  if (timed) {
    if (exercise.durationRange) {
      const [lo, hi] = exercise.durationRange
      durationSeconds = Math.max(5, roundTo(lo + (hi - lo) * lightPosition(durationMinutes), 5))
    } else durationSeconds = 30
  }
  // Primers and drills take the low end of their range, never the working range: they prepare
  // the pattern without pre-fatiguing it.
  let reps: [number, number] | null = null
  if (!timed && exercise.repRange) {
    const n = exercise.isUnilateral ? Math.min(exercise.repRange[0], LIGHT_MAX_REPS_PER_SIDE) : exercise.repRange[0]
    reps = [n, n]
  }
  return {
    sets: 1,
    reps,
    durationSeconds,
    restSeconds: Math.min(exercise.restRange[0], 20),
    rir: null,
    tempo: null,
    minSets: 1,
    maxSets: 1,
  }
}
