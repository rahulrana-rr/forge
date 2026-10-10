/**
 * Split rotation templates. A template day is an ordered list of slots; each slot names
 * its role, the movement patterns and muscle groups it accepts and a priority used to
 * trim the day to the number of slots the user's time budget allows.
 */
import type { Goal, Mechanics, MovementPattern, MuscleGroup } from "@/lib/exercises/types"
import type { Experience, SplitDay, TrainingDays } from "@/lib/domain/types"
import type { MainRole } from "./prescriptions"

export type SlotKind = "lower" | "upper_push" | "upper_pull" | "core" | "conditioning" | "arms" | "shoulders" | "general"

export interface SlotSpec {
  /** Stable key inside the template, e.g. "primary". */
  key: string
  role: MainRole
  patterns: MovementPattern[]
  groups: MuscleGroup[]
  mechanics?: Mechanics
  /** 1 = kept first when the day is trimmed. */
  priority: number
  kind: SlotKind
}

export interface SplitTemplate {
  /** Stable key used to match history, e.g. "push_a". */
  key: string
  split: SplitDay
  title: string
  focus: MuscleGroup[]
  /** Groups loaded by the primary and secondary compounds; used for 48h recovery checks. */
  heavyGroups: MuscleGroup[]
  slots: SlotSpec[]
  /**
   * A conditioning-led day (endurance): the conditioning block is the day's main work and the
   * lifts are a short circuit at their minimum sets. "steady" asks for a steady-state block (bike,
   * rower, brisk walk) when one fits the time, "intervals" for an interval block.
   */
  conditioning?: "steady" | "intervals"
}

/**
 * Patterns a core slot takes at match level 0. Core spec C06: carries count, so a core-category
 * carry (suitcase carry, the anti-lateral option a shoulder-flagged user keeps) is reachable.
 * Farmer's, trap-bar, front-rack and overhead carries are full-body conditioning (selection.ts
 * isConditioning) and never fill a core slot.
 */
const CORE_PATTERNS: MovementPattern[] = ["anti_extension", "anti_rotation", "anti_lateral_flexion", "carry", "trunk_flexion", "rotation"]

function core(priority: number): SlotSpec {
  return { key: "core", role: "accessory", patterns: CORE_PATTERNS, groups: ["core"], priority, kind: "core" }
}

export const FINISHER_SLOT: SlotSpec = {
  key: "finisher",
  role: "finisher",
  patterns: ["conditioning", "locomotion"],
  groups: ["cardio", "full_body"],
  priority: 99,
  kind: "conditioning",
}

const PUSH_FOCUS: MuscleGroup[] = ["chest", "shoulders", "triceps"]
const PULL_FOCUS: MuscleGroup[] = ["back", "biceps"]
const LEGS_FOCUS: MuscleGroup[] = ["quads", "hamstrings", "glutes"]
const UPPER_FOCUS: MuscleGroup[] = ["chest", "back", "shoulders"]

const PUSH_A: SplitTemplate = {
  key: "push_a",
  split: "push",
  title: "Push",
  focus: PUSH_FOCUS,
  heavyGroups: ["chest", "shoulders"],
  slots: [
    { key: "primary", role: "primary_compound", patterns: ["horizontal_push"], groups: ["chest"], mechanics: "compound", priority: 1, kind: "upper_push" },
    { key: "secondary", role: "secondary_compound", patterns: ["vertical_push"], groups: ["shoulders"], mechanics: "compound", priority: 2, kind: "upper_push" },
    { key: "accessory", role: "accessory", patterns: ["horizontal_push", "vertical_push"], groups: ["chest", "triceps"], mechanics: "compound", priority: 3, kind: "upper_push" },
    { key: "iso_delts", role: "isolation", patterns: ["shoulder_abduction", "shoulder_flexion"], groups: ["shoulders"], priority: 4, kind: "shoulders" },
    { key: "iso_triceps", role: "isolation", patterns: ["elbow_extension"], groups: ["triceps"], priority: 5, kind: "arms" },
    { key: "iso_chest", role: "isolation", patterns: ["horizontal_push"], groups: ["chest"], mechanics: "isolation", priority: 6, kind: "upper_push" },
    core(7),
  ],
}

const PUSH_B: SplitTemplate = {
  key: "push_b",
  split: "push",
  title: "Push B",
  focus: PUSH_FOCUS,
  heavyGroups: ["shoulders", "chest"],
  slots: [
    { key: "primary", role: "primary_compound", patterns: ["vertical_push"], groups: ["shoulders"], mechanics: "compound", priority: 1, kind: "upper_push" },
    { key: "secondary", role: "secondary_compound", patterns: ["horizontal_push"], groups: ["chest"], mechanics: "compound", priority: 2, kind: "upper_push" },
    { key: "accessory", role: "accessory", patterns: ["horizontal_push", "vertical_push", "elbow_extension"], groups: ["triceps", "chest"], mechanics: "compound", priority: 3, kind: "upper_push" },
    { key: "iso_chest", role: "isolation", patterns: ["horizontal_push"], groups: ["chest"], mechanics: "isolation", priority: 4, kind: "upper_push" },
    { key: "iso_delts", role: "isolation", patterns: ["shoulder_abduction", "shoulder_flexion"], groups: ["shoulders"], priority: 5, kind: "shoulders" },
    core(6),
    { key: "iso_triceps", role: "isolation", patterns: ["elbow_extension"], groups: ["triceps"], priority: 7, kind: "arms" },
  ],
}

const PULL_A: SplitTemplate = {
  key: "pull_a",
  split: "pull",
  title: "Pull",
  focus: PULL_FOCUS,
  heavyGroups: ["back"],
  slots: [
    { key: "primary", role: "primary_compound", patterns: ["vertical_pull"], groups: ["back"], mechanics: "compound", priority: 1, kind: "upper_pull" },
    { key: "secondary", role: "secondary_compound", patterns: ["horizontal_pull"], groups: ["back"], mechanics: "compound", priority: 2, kind: "upper_pull" },
    { key: "accessory", role: "accessory", patterns: ["horizontal_pull", "vertical_pull"], groups: ["back"], mechanics: "compound", priority: 3, kind: "upper_pull" },
    { key: "iso_biceps", role: "isolation", patterns: ["elbow_flexion"], groups: ["biceps", "forearms"], priority: 4, kind: "arms" },
    { key: "iso_rear", role: "isolation", patterns: ["horizontal_pull"], groups: ["shoulders"], priority: 5, kind: "shoulders" },
    core(6),
    { key: "iso_forearms", role: "isolation", patterns: ["elbow_flexion", "carry"], groups: ["forearms", "biceps"], priority: 7, kind: "arms" },
  ],
}

const PULL_B: SplitTemplate = {
  key: "pull_b",
  split: "pull",
  title: "Pull B",
  focus: PULL_FOCUS,
  heavyGroups: ["back"],
  slots: [
    { key: "primary", role: "primary_compound", patterns: ["horizontal_pull"], groups: ["back"], mechanics: "compound", priority: 1, kind: "upper_pull" },
    { key: "secondary", role: "secondary_compound", patterns: ["vertical_pull"], groups: ["back"], mechanics: "compound", priority: 2, kind: "upper_pull" },
    { key: "accessory", role: "accessory", patterns: ["horizontal_pull", "vertical_pull"], groups: ["back"], mechanics: "compound", priority: 3, kind: "upper_pull" },
    { key: "iso_rear", role: "isolation", patterns: ["horizontal_pull"], groups: ["shoulders"], priority: 4, kind: "shoulders" },
    { key: "iso_biceps", role: "isolation", patterns: ["elbow_flexion"], groups: ["biceps", "forearms"], priority: 5, kind: "arms" },
    core(6),
    { key: "iso_biceps_2", role: "isolation", patterns: ["elbow_flexion"], groups: ["biceps"], priority: 7, kind: "arms" },
  ],
}

const LEGS_A: SplitTemplate = {
  key: "legs_a",
  split: "legs",
  title: "Legs",
  focus: LEGS_FOCUS,
  heavyGroups: ["quads", "hamstrings", "glutes"],
  slots: [
    { key: "primary", role: "primary_compound", patterns: ["squat"], groups: ["quads"], mechanics: "compound", priority: 1, kind: "lower" },
    { key: "secondary", role: "secondary_compound", patterns: ["hinge"], groups: ["hamstrings", "glutes"], mechanics: "compound", priority: 2, kind: "lower" },
    { key: "accessory", role: "accessory", patterns: ["lunge", "squat"], groups: ["quads", "glutes"], mechanics: "compound", priority: 3, kind: "lower" },
    { key: "iso_hams", role: "isolation", patterns: ["knee_flexion", "hip_extension"], groups: ["hamstrings", "glutes"], priority: 4, kind: "lower" },
    // Core before calves: a coach keeps trunk work on leg days (bracing carries straight over).
    core(5),
    { key: "iso_calves", role: "isolation", patterns: ["calf_raise"], groups: ["calves"], priority: 6, kind: "lower" },
    { key: "iso_quads", role: "isolation", patterns: ["knee_extension"], groups: ["quads"], priority: 7, kind: "lower" },
  ],
}

const LEGS_B: SplitTemplate = {
  key: "legs_b",
  split: "legs",
  title: "Legs B",
  focus: LEGS_FOCUS,
  heavyGroups: ["hamstrings", "glutes", "quads"],
  slots: [
    { key: "primary", role: "primary_compound", patterns: ["hinge"], groups: ["hamstrings", "glutes"], mechanics: "compound", priority: 1, kind: "lower" },
    { key: "secondary", role: "secondary_compound", patterns: ["squat", "lunge"], groups: ["quads"], mechanics: "compound", priority: 2, kind: "lower" },
    { key: "accessory", role: "accessory", patterns: ["hip_extension", "lunge"], groups: ["glutes", "quads"], mechanics: "compound", priority: 3, kind: "lower" },
    // The hinge only trains the hamstrings at the hip: the hinge-led day's knee-flexion work is
    // kept before knee extension, which the squat already covers, so it survives a 45-60 minute trim.
    { key: "iso_hams", role: "isolation", patterns: ["knee_flexion"], groups: ["hamstrings"], priority: 4, kind: "lower" },
    // Core before calves: a coach keeps trunk work on leg days (bracing carries straight over).
    core(5),
    { key: "iso_quads", role: "isolation", patterns: ["knee_extension"], groups: ["quads"], priority: 6, kind: "lower" },
    { key: "iso_calves", role: "isolation", patterns: ["calf_raise"], groups: ["calves"], priority: 7, kind: "lower" },
  ],
}

const UPPER_A: SplitTemplate = {
  key: "upper_a",
  split: "upper",
  title: "Upper A",
  focus: UPPER_FOCUS,
  heavyGroups: ["chest", "back"],
  slots: [
    { key: "primary", role: "primary_compound", patterns: ["horizontal_push"], groups: ["chest"], mechanics: "compound", priority: 1, kind: "upper_push" },
    // Coach round 2 (R08): the vertical pull, never a row. Upper B opens with a row and its
    // accessory pull is vertical, so this day mirrors it: one vertical and one horizontal pull
    // each upper day. Accepting either plane let the secondary pick a row, the consistency bonus
    // kept it, and the week ran three rows to one vertical pull. Without a vertical pull in the
    // user's kit the slot still falls back to any back compound (match level 1).
    { key: "secondary", role: "secondary_compound", patterns: ["vertical_pull"], groups: ["back"], mechanics: "compound", priority: 2, kind: "upper_pull" },
    // The row before the overhead press: a three-slot day (thirty minutes with a finisher) is one
    // press and two pulls, never two presses and one pull.
    { key: "acc_pull", role: "accessory", patterns: ["horizontal_pull"], groups: ["back"], mechanics: "compound", priority: 3, kind: "upper_pull" },
    { key: "acc_push", role: "accessory", patterns: ["vertical_push"], groups: ["shoulders"], mechanics: "compound", priority: 4, kind: "upper_push" },
    // Side delts get no direct work from presses or rows: the lateral raise comes before the arms
    // and trunk, so a 60-minute upper/lower week still has some.
    { key: "iso_delts", role: "isolation", patterns: ["shoulder_abduction"], groups: ["shoulders"], priority: 5, kind: "shoulders" },
    { key: "iso_biceps", role: "isolation", patterns: ["elbow_flexion"], groups: ["biceps"], priority: 6, kind: "arms" },
    { key: "iso_triceps", role: "isolation", patterns: ["elbow_extension"], groups: ["triceps"], priority: 7, kind: "arms" },
    core(8),
  ],
}

const UPPER_B: SplitTemplate = {
  key: "upper_b",
  split: "upper",
  title: "Upper B",
  focus: UPPER_FOCUS,
  heavyGroups: ["back", "chest"],
  slots: [
    { key: "primary", role: "primary_compound", patterns: ["horizontal_pull"], groups: ["back"], mechanics: "compound", priority: 1, kind: "upper_pull" },
    { key: "secondary", role: "secondary_compound", patterns: ["horizontal_push"], groups: ["chest"], mechanics: "compound", priority: 2, kind: "upper_push" },
    { key: "acc_pull", role: "accessory", patterns: ["vertical_pull"], groups: ["back"], mechanics: "compound", priority: 3, kind: "upper_pull" },
    // The secondary may be either press; the accessory is always overhead so the day never has
    // two horizontal presses and no vertical one.
    { key: "acc_push", role: "accessory", patterns: ["vertical_push"], groups: ["shoulders"], mechanics: "compound", priority: 4, kind: "upper_push" },
    // Each upper day gives the back two compounds and the chest one: a chest isolation (fly or
    // pullover, never a third press) keeps weekly chest volume near back volume, and the rear-delt
    // work comes before arms and trunk.
    { key: "iso_chest", role: "isolation", patterns: ["horizontal_push", "shoulder_flexion"], groups: ["chest"], mechanics: "isolation", priority: 5, kind: "upper_push" },
    { key: "iso_rear", role: "isolation", patterns: ["horizontal_pull"], groups: ["shoulders"], priority: 6, kind: "shoulders" },
    { key: "iso_triceps", role: "isolation", patterns: ["elbow_extension"], groups: ["triceps"], priority: 7, kind: "arms" },
    { key: "iso_biceps", role: "isolation", patterns: ["elbow_flexion"], groups: ["biceps"], priority: 8, kind: "arms" },
    core(9),
  ],
}

const LOWER_A: SplitTemplate = { ...LEGS_A, key: "lower_a", split: "lower", title: "Lower A" }
const LOWER_B: SplitTemplate = { ...LEGS_B, key: "lower_b", split: "lower", title: "Lower B" }

const FB_FOCUS = (groups: MuscleGroup[]): MuscleGroup[] => ["full_body", ...groups]

const FULL_A: SplitTemplate = {
  key: "full_a",
  split: "full_body",
  title: "Full body A",
  focus: FB_FOCUS(["quads", "chest", "back"]),
  heavyGroups: ["quads", "chest"],
  slots: [
    { key: "primary", role: "primary_compound", patterns: ["squat"], groups: ["quads"], mechanics: "compound", priority: 1, kind: "lower" },
    { key: "secondary", role: "secondary_compound", patterns: ["horizontal_push"], groups: ["chest"], mechanics: "compound", priority: 2, kind: "upper_push" },
    { key: "accessory", role: "accessory", patterns: ["horizontal_pull", "vertical_pull"], groups: ["back"], mechanics: "compound", priority: 3, kind: "upper_pull" },
    core(4),
    // A second pull, not a second press: B is one press to one pull and C carries the overhead
    // press, so the week stays balanced (A/B: 2 presses, 3 pulls; A/B/C: 4 and 4). It is a back
    // compound (a row or a pulldown, the other plane when one is free): rear-delt and face-pull
    // work only comes in through the balancing pull when the back is capped, and shrugs or
    // upright rows never fill it (coach round 2, R09).
    { key: "acc_pull", role: "accessory", patterns: ["horizontal_pull", "vertical_pull"], groups: ["back"], mechanics: "compound", priority: 5, kind: "upper_pull" },
    { key: "iso_hams", role: "isolation", patterns: ["knee_flexion", "hip_extension"], groups: ["hamstrings", "glutes"], priority: 6, kind: "lower" },
    { key: "iso_biceps", role: "isolation", patterns: ["elbow_flexion"], groups: ["biceps"], priority: 7, kind: "arms" },
    { key: "iso_calves", role: "isolation", patterns: ["calf_raise"], groups: ["calves"], priority: 8, kind: "lower" },
  ],
}

const FULL_B: SplitTemplate = {
  key: "full_b",
  split: "full_body",
  title: "Full body B",
  focus: FB_FOCUS(["hamstrings", "glutes", "back", "chest"]),
  heavyGroups: ["hamstrings", "glutes", "back"],
  slots: [
    { key: "primary", role: "primary_compound", patterns: ["hinge"], groups: ["hamstrings", "glutes"], mechanics: "compound", priority: 1, kind: "lower" },
    { key: "secondary", role: "secondary_compound", patterns: ["vertical_pull", "horizontal_pull"], groups: ["back"], mechanics: "compound", priority: 2, kind: "upper_pull" },
    // Coach round 2 (R17): trunk work ahead of the press on this day only. A thirty-minute session
    // with a finisher keeps three lifts, and with core fourth on every full-body day a conditioning
    // week had no trunk work at all. Here the three lifts are hinge, pull and core (no press to
    // balance); A and C keep their press and pull, so the week still presses twice.
    core(3),
    { key: "accessory", role: "accessory", patterns: ["horizontal_push", "vertical_push"], groups: ["chest", "shoulders"], mechanics: "compound", priority: 4, kind: "upper_push" },
    { key: "acc_lunge", role: "accessory", patterns: ["lunge"], groups: ["quads", "glutes"], mechanics: "compound", priority: 5, kind: "lower" },
    { key: "iso_delts", role: "isolation", patterns: ["shoulder_abduction", "shoulder_flexion"], groups: ["shoulders"], priority: 6, kind: "shoulders" },
    { key: "iso_triceps", role: "isolation", patterns: ["elbow_extension"], groups: ["triceps"], priority: 7, kind: "arms" },
    { key: "iso_calves", role: "isolation", patterns: ["calf_raise"], groups: ["calves"], priority: 8, kind: "lower" },
  ],
}

const FULL_C: SplitTemplate = {
  key: "full_c",
  split: "full_body",
  title: "Full body C",
  focus: FB_FOCUS(["chest", "quads", "glutes", "back"]),
  heavyGroups: ["chest", "quads"],
  slots: [
    { key: "primary", role: "primary_compound", patterns: ["horizontal_push"], groups: ["chest"], mechanics: "compound", priority: 1, kind: "upper_push" },
    { key: "secondary", role: "secondary_compound", patterns: ["lunge", "squat"], groups: ["quads", "glutes"], mechanics: "compound", priority: 2, kind: "lower" },
    { key: "accessory", role: "accessory", patterns: ["horizontal_pull", "vertical_pull"], groups: ["back"], mechanics: "compound", priority: 3, kind: "upper_pull" },
    core(4),
    { key: "acc_press", role: "accessory", patterns: ["vertical_push"], groups: ["shoulders"], mechanics: "compound", priority: 5, kind: "upper_push" },
    { key: "iso_glutes", role: "isolation", patterns: ["hip_extension"], groups: ["glutes"], priority: 6, kind: "lower" },
    { key: "iso_biceps", role: "isolation", patterns: ["elbow_flexion"], groups: ["biceps"], priority: 7, kind: "arms" },
    { key: "iso_triceps", role: "isolation", patterns: ["elbow_extension"], groups: ["triceps"], priority: 8, kind: "arms" },
  ],
}

/**
 * A conditioning-led day for endurance (coach round 2, R17): a short full-body circuit (one lower
 * lift, a pull and trunk work, all at accessory doses so nothing counts as a heavy day) and then the
 * conditioning block as the main work, sized to the time the circuit leaves. Pressing stays on the
 * full-body lifting days: a circuit press would have to be balanced by a pull, and a beginner's
 * weekly caps leave the circuit's pull without room late in a five- or six-day week.
 */
function conditioningDay(
  key: string,
  title: string,
  mode: "steady" | "intervals",
  lower: { patterns: MovementPattern[]; groups: MuscleGroup[] },
): SplitTemplate {
  return {
    key,
    split: "conditioning",
    title,
    focus: FB_FOCUS([lower.groups[0] ?? "quads", "back", "core"]),
    // Nothing is loaded heavily: the day never waits on recovery, and it is the natural stand-in
    // when the rotation's next lifting day is not recovered.
    heavyGroups: [],
    conditioning: mode,
    slots: [
      { key: "circuit_lower", role: "accessory", patterns: lower.patterns, groups: lower.groups, mechanics: "compound", priority: 1, kind: "lower" },
      { key: "circuit_pull", role: "accessory", patterns: ["horizontal_pull", "vertical_pull"], groups: ["back"], mechanics: "compound", priority: 2, kind: "upper_pull" },
      core(3),
    ],
  }
}

const CONDITIONING_A = conditioningDay("conditioning_a", "Conditioning A", "steady", { patterns: ["squat", "lunge"], groups: ["quads", "glutes"] })
const CONDITIONING_B = conditioningDay("conditioning_b", "Conditioning B", "intervals", { patterns: ["hinge", "hip_extension"], groups: ["hamstrings", "glutes"] })
const CONDITIONING_C = conditioningDay("conditioning_c", "Conditioning C", "steady", { patterns: ["lunge", "squat"], groups: ["quads", "glutes"] })

/** Conditioning-led days. Kept apart from TEMPLATES: they have no heavy compound slots. */
export const CONDITIONING_TEMPLATES: Record<string, SplitTemplate> = {
  conditioning_a: CONDITIONING_A,
  conditioning_b: CONDITIONING_B,
  conditioning_c: CONDITIONING_C,
}

export const TEMPLATES: Record<string, SplitTemplate> = {
  push_a: PUSH_A,
  push_b: PUSH_B,
  pull_a: PULL_A,
  pull_b: PULL_B,
  legs_a: LEGS_A,
  legs_b: LEGS_B,
  upper_a: UPPER_A,
  upper_b: UPPER_B,
  lower_a: LOWER_A,
  lower_b: LOWER_B,
  full_a: FULL_A,
  full_b: FULL_B,
  full_c: FULL_C,
}

/**
 * Whether a three-day week is push/pull/legs rather than full body. Only hypertrophy work past the
 * beginner stage wants each muscle's whole weekly dose in one long session; strength, fat loss,
 * general fitness and endurance train every pattern (and every main lift) more than once a week.
 * Without a goal the historical rule applies (push/pull/legs for every non-beginner).
 */
function threeDayPushPullLegs(experience: Experience, goal?: Goal): boolean {
  if (experience === "beginner") return false
  return goal === undefined || goal === "muscle_gain"
}

/**
 * Endurance at four or more days a week (coach round 2, R17): full-body lifting days alternate
 * with conditioning-led days, instead of the hypertrophy splits that left about six conditioning
 * minutes a week. Every pattern is still lifted two or three times a week.
 */
function enduranceRotation(days: TrainingDays): SplitTemplate[] | null {
  switch (days) {
    case 4:
      return [FULL_A, CONDITIONING_A, FULL_B, CONDITIONING_B]
    case 5:
      return [FULL_A, CONDITIONING_A, FULL_B, CONDITIONING_B, FULL_C]
    case 6:
      return [FULL_A, CONDITIONING_A, FULL_B, CONDITIONING_B, FULL_C, CONDITIONING_C]
    default:
      return null
  }
}

/** The ordered rotation for a training frequency, experience level and (optionally) goal. */
export function rotationFor(days: TrainingDays, experience: Experience, goal?: Goal): SplitTemplate[] {
  const endurance = goal === "endurance" ? enduranceRotation(days) : null
  if (endurance) return endurance
  switch (days) {
    case 2:
      return [FULL_A, FULL_B]
    case 3:
      return threeDayPushPullLegs(experience, goal) ? [PUSH_A, PULL_A, LEGS_A] : [FULL_A, FULL_B, FULL_C]
    case 4:
      return [UPPER_A, LOWER_A, UPPER_B, LOWER_B]
    case 5:
      return [PUSH_A, PULL_A, LEGS_A, UPPER_B, LOWER_B]
    case 6:
    default:
      return [PUSH_A, PULL_A, LEGS_A, PUSH_B, PULL_B, LEGS_B]
  }
}

/**
 * Core spec C01: how many rotation days have a protected core slot, by training days a week. Every
 * plan gets direct trunk work on at least two sessions in any rolling 7 days (WHO 2020 and ACSM
 * 2011 frame the twice-a-week floor; the exact targets are coaching judgment).
 */
export const CORE_DAYS_TARGET: Record<TrainingDays, number> = { 2: 2, 3: 2, 4: 2, 5: 3, 6: 3 }

/**
 * Core spec C02: most sessions with direct trunk work in any rolling 7 days. Compound lifts already
 * load the trunk, so 5-6 day plans get 3-4 core days, not 6 (coaching judgment).
 */
export const MAX_CORE_DAYS: Record<TrainingDays, number> = { 2: 2, 3: 3, 4: 3, 5: 4, 6: 4 }

/** Pairs of rotation indices in `subset` that sit next to each other in the cycle. */
function cyclicAdjacentPairs(subset: readonly number[], n: number): number {
  const chosen = new Set(subset)
  if (n < 2) return 0
  let pairs = 0
  for (let i = 0; i < n; i++) if (chosen.has(i) && chosen.has((i + 1) % n)) pairs++
  // A two-day cycle has one pair, not two (0-1 and 1-0 are the same neighbours).
  return n === 2 ? Math.min(pairs, 1) : pairs
}

/** Every k-subset of `items`, in lexicographic order. */
function subsetsOf(items: readonly number[], k: number): number[][] {
  if (k <= 0) return [[]]
  const out: number[][] = []
  const walk = (start: number, acc: number[]) => {
    if (acc.length === k) {
      out.push(acc.slice())
      return
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i] as number)
      walk(i + 1, acc)
      acc.pop()
    }
  }
  walk(0, [])
  return out
}

/**
 * Core spec C01: the rotation days whose core slot is protected (template keys). Deterministic:
 * among every subset of CORE_DAYS_TARGET[days] rotation days that have a core slot, the one with
 * the fewest cyclically adjacent days (trunk work spread over the week), then the lowest sum of
 * core-slot priority (the days where core already sits highest), then the smallest indices.
 * Rotations have at most six days, so there are at most 20 subsets.
 */
export function coreDays(rotation: readonly SplitTemplate[], days: TrainingDays): Set<string> {
  const priorityOf = (t: SplitTemplate) => t.slots.find((s) => s.kind === "core")?.priority
  const eligible = rotation.map((t, i) => (priorityOf(t) === undefined ? -1 : i)).filter((i) => i >= 0)
  const k = Math.min(CORE_DAYS_TARGET[days] ?? 2, eligible.length)
  let best: { subset: number[]; adjacent: number; priority: number } | null = null
  for (const subset of subsetsOf(eligible, k)) {
    const adjacent = cyclicAdjacentPairs(subset, rotation.length)
    const priority = subset.reduce((sum, i) => sum + (priorityOf(rotation[i] as SplitTemplate) ?? 0), 0)
    // Subsets come in lexicographic order, so a strict comparison keeps the smallest indices on a tie.
    if (!best || adjacent < best.adjacent || (adjacent === best.adjacent && priority < best.priority)) best = { subset, adjacent, priority }
  }
  return new Set((best?.subset ?? []).map((i) => (rotation[i] as SplitTemplate).key))
}

/** Find the template a completed workout came from, by title first, then split. */
export function templateForHistory(rotation: SplitTemplate[], split: SplitDay, title: string): SplitTemplate | undefined {
  return rotation.find((t) => t.split === split && t.title === title) ?? rotation.find((t) => t.split === split)
}

/** Allowed main-phase slot range by time budget: 30 → 4, 45 → 5–6, 60 → 6–7, 75 → 7–8. */
export function mainSlotRange(durationMinutes: number): [number, number] {
  if (durationMinutes <= 30) return [4, 4]
  if (durationMinutes <= 45) return [5, 6]
  if (durationMinutes <= 60) return [6, 7]
  return [7, 8]
}

/**
 * Most lifting (non-conditioning) slots a session may hold. Endurance keeps its resistance work to
 * the bottom of the range less the conditioning block (three lifts at 30 minutes, four at 45, five
 * at 60, six at 75) so the conditioning block gets the rest of the time (coach round 2, R17).
 * Other goals have no cap of their own: only the slot range applies.
 */
export function liftingSlotCap(durationMinutes: number, goal?: Goal): number {
  return goal === "endurance" ? mainSlotRange(durationMinutes)[0] - 1 : Number.POSITIVE_INFINITY
}

/**
 * Starting slot count; conditioning goals take one more for the finisher when the range allows.
 * Endurance starts at the bottom of the range, finisher included (see liftingSlotCap).
 */
export function mainSlotCount(durationMinutes: number, conditioning: boolean, goal?: Goal): number {
  const [min, max] = mainSlotRange(durationMinutes)
  if (conditioning && goal === "endurance") return min
  return conditioning ? Math.min(max, min + 1) : min
}

/**
 * Fewest slots a conditioning goal reserves the finisher at. Thirty-minute sessions (four slots)
 * included: three resistance slots and the conditioning block, never four lifts and no conditioning.
 */
export const MIN_SLOTS_WITH_FINISHER = 4

/**
 * A hypertrophy week's direct triceps work (coach round 2, R18): at 60 minutes each upper day fills
 * six slots, which on Upper A ended at the biceps curl and on Upper B at the rear-delt raise, so the
 * week had no elbow extension. For muscle gain, Upper A takes its triceps isolation before its
 * biceps curl (priority 6 and 7, not 7 and 6). The coach proposed moving Upper B's triceps ahead of
 * its rear-delt work instead, but that left the week with no rear-delt slot (round 1, F23); the
 * biceps still get the week's four rows and pulldowns. Other goals keep the template order.
 */
function selectionPriority(template: SplitTemplate, slot: SlotSpec, wantIsolation: boolean): number {
  if (!wantIsolation || template.key !== "upper_a") return slot.priority
  if (slot.key === "iso_triceps") return 6
  if (slot.key === "iso_biceps") return 7
  return slot.priority
}

/** The slots to program for a template given the slot budget, in template order (finisher last). */
export function slotsForCount(template: SplitTemplate, count: number, conditioning: boolean, wantIsolation = false): SlotSpec[] {
  const withFinisher = conditioning && count >= MIN_SLOTS_WITH_FINISHER
  const budget = withFinisher ? count - 1 : count
  const sorted = template.slots
    .slice()
    .sort((a, b) => selectionPriority(template, a, wantIsolation) - selectionPriority(template, b, wantIsolation))
  const byPriority = sorted.slice(0, budget)
  // A hypertrophy day of five or more exercises always has some direct isolation work: the
  // lowest-priority compound accessory makes way for the template's first isolation slot, but
  // never the day's last pull (a press-heavy day with no row is how shoulders get cranky).
  if (wantIsolation && budget >= 5 && !byPriority.some((s) => s.role === "isolation")) {
    const iso = sorted.find((s) => s.role === "isolation")
    const pulls = byPriority.filter((s) => s.kind === "upper_pull").length
    const drop = byPriority
      .slice()
      .reverse()
      .find((s) => s.role === "accessory" && s.kind !== "core" && !(s.kind === "upper_pull" && pulls <= 1))
    if (iso && drop) byPriority.splice(byPriority.indexOf(drop), 1, iso)
  }
  const ordered = template.slots.filter((s) => byPriority.includes(s))
  return withFinisher ? [...ordered, FINISHER_SLOT] : ordered
}

/** Template slots left over after trimming; used to rescue a day that could not fill enough slots. */
export function spareSlots(template: SplitTemplate, used: SlotSpec[]): SlotSpec[] {
  return template.slots.filter((s) => !used.includes(s)).sort((a, b) => a.priority - b.priority)
}
