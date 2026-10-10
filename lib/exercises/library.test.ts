/**
 * Integrity tests for the static exercise library.
 *
 * Every category file is populated, so every check runs unconditionally.
 */
import { describe, expect, it } from "vitest"

import { EQUIPMENT_PRESETS } from "@/lib/domain/types"
import { CORE_FAMILIES, coreFamily, loadableTrunk, type CoreFamily } from "@/lib/engine/selection"
import {
  ALL_MUSCLE_GROUPS,
  EXERCISES,
  MUSCLE_TO_GROUP,
  getExercise,
} from "./index"
import type { BodyArea, Equipment, Exercise, ExerciseCategory, Goal, MovementPattern, MuscleGroup } from "./types"

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const MUSCLE_GROUP_SET: ReadonlySet<string> = new Set<string>(ALL_MUSCLE_GROUPS)

/** Categories whose entries must carry at least one "for:<muscleGroup>" tag. */
const TAGGED_CATEGORIES: ReadonlySet<ExerciseCategory> =
  new Set<ExerciseCategory>(["warmup", "mobility", "stretching", "cooldown"])

/**
 * Ids every category file is contractually required to ship. Any file may reference
 * these in alternativeExercises / variationOf, so while the library is still partly
 * stubbed a reference to one of them counts as resolvable.
 */
const CANONICAL_IDS: ReadonlySet<string> = new Set<string>([
  // chest
  "barbell-bench-press",
  "incline-barbell-bench-press",
  "decline-barbell-bench-press",
  "dumbbell-bench-press",
  "incline-dumbbell-press",
  "decline-dumbbell-press",
  "machine-chest-press",
  "smith-machine-bench-press",
  "cable-fly",
  "incline-cable-fly",
  "low-to-high-cable-fly",
  "dumbbell-fly",
  "incline-dumbbell-fly",
  "pec-deck",
  "push-up",
  "incline-push-up",
  "decline-push-up",
  "diamond-push-up",
  "chest-dip",
  "floor-press",
  "dumbbell-floor-press",
  "landmine-press",
  "band-chest-press",
  "dumbbell-pullover",
  // shoulders
  "overhead-press",
  "seated-dumbbell-shoulder-press",
  "standing-dumbbell-shoulder-press",
  "arnold-press",
  "machine-shoulder-press",
  "push-press",
  "landmine-shoulder-press",
  "dumbbell-lateral-raise",
  "cable-lateral-raise",
  "machine-lateral-raise",
  "band-lateral-raise",
  "dumbbell-front-raise",
  "rear-delt-fly",
  "reverse-pec-deck",
  "cable-rear-delt-fly",
  "face-pull",
  "upright-row",
  "barbell-shrug",
  "dumbbell-shrug",
  "pike-push-up",
  "handstand-push-up",
  "dumbbell-y-raise",
  // back
  "pull-up",
  "chin-up",
  "neutral-grip-pull-up",
  "assisted-pull-up",
  "lat-pulldown",
  "close-grip-lat-pulldown",
  "single-arm-lat-pulldown",
  "bent-over-barbell-row",
  "pendlay-row",
  "single-arm-dumbbell-row",
  "chest-supported-dumbbell-row",
  "seated-cable-row",
  "t-bar-row",
  "machine-row",
  "inverted-row",
  "band-row",
  "meadows-row",
  "straight-arm-pulldown",
  "rack-pull",
  "landmine-row",
  "cable-pullover",
  "kettlebell-row",
  // biceps
  "barbell-curl",
  "ez-bar-curl",
  "dumbbell-curl",
  "alternating-dumbbell-curl",
  "hammer-curl",
  "incline-dumbbell-curl",
  "preacher-curl",
  "concentration-curl",
  "cable-curl",
  "machine-bicep-curl",
  "spider-curl",
  "reverse-curl",
  "band-curl",
  "zottman-curl",
  "bayesian-cable-curl",
  "wrist-curl",
  "reverse-wrist-curl",
  "plate-pinch",
  // triceps
  "close-grip-bench-press",
  "cable-triceps-pushdown",
  "rope-pushdown",
  "overhead-cable-triceps-extension",
  "overhead-dumbbell-triceps-extension",
  "skull-crusher",
  "dumbbell-skull-crusher",
  "triceps-dip",
  "bench-dip",
  "dumbbell-kickback",
  "cable-kickback",
  "jm-press",
  "machine-triceps-extension",
  "band-pushdown",
  "single-arm-overhead-extension",
  "tate-press",
  // legs
  "barbell-back-squat",
  "front-squat",
  "goblet-squat",
  "hack-squat",
  "leg-press",
  "smith-machine-squat",
  "box-squat",
  "bulgarian-split-squat",
  "dumbbell-walking-lunge",
  "reverse-lunge",
  "forward-lunge",
  "step-up",
  "leg-extension",
  "lying-leg-curl",
  "seated-leg-curl",
  "nordic-hamstring-curl",
  "conventional-deadlift",
  "sumo-deadlift",
  "trap-bar-deadlift",
  "romanian-deadlift",
  "dumbbell-romanian-deadlift",
  "single-leg-romanian-deadlift",
  "good-morning",
  "standing-calf-raise",
  "seated-calf-raise",
  "leg-press-calf-raise",
  "single-leg-calf-raise",
  "bodyweight-squat",
  "pistol-squat",
  "wall-sit",
  "sissy-squat",
  "dumbbell-sumo-squat",
  // glutes
  "barbell-hip-thrust",
  "dumbbell-hip-thrust",
  "machine-hip-thrust",
  "glute-bridge",
  "single-leg-glute-bridge",
  "cable-glute-kickback",
  "cable-pull-through",
  "kettlebell-swing",
  "frog-pump",
  "hip-abduction-machine",
  "hip-adduction-machine",
  "banded-lateral-walk",
  "clamshell",
  "fire-hydrant",
  "donkey-kick",
  "curtsy-lunge",
  "reverse-hyperextension",
  "single-leg-hip-thrust",
  "glute-ham-raise",
  // core
  "plank",
  "side-plank",
  "dead-bug",
  "bird-dog",
  "hanging-leg-raise",
  "hanging-knee-raise",
  "captains-chair-leg-raise",
  "cable-crunch",
  "crunch",
  "bicycle-crunch",
  "reverse-crunch",
  "ab-wheel-rollout",
  "pallof-press",
  "russian-twist",
  "mountain-climber",
  "hollow-body-hold",
  "v-up",
  "cable-woodchop",
  "landmine-rotation",
  "copenhagen-plank",
  "back-extension",
  "superman",
  "suitcase-carry",
  "weighted-plank",
  "decline-sit-up",
  "lying-leg-raise",
  "flutter-kick",
  // core spec D10-D13: the hold regressions the engine names (C18) and the loaded dumbbell drills
  "knee-side-plank",
  "incline-plank",
  "weighted-dead-bug",
  "weighted-crunch",
  // full body
  "farmers-carry",
  "kettlebell-clean",
  "kettlebell-clean-and-press",
  "kettlebell-snatch",
  "barbell-thruster",
  "dumbbell-thruster",
  "burpee",
  "power-clean",
  "hang-power-clean",
  "sled-push",
  "sled-drag",
  "man-maker",
  "dumbbell-snatch",
  "turkish-get-up",
  "medicine-ball-slam",
  "wall-ball",
  "battle-rope",
  "box-jump",
  "jump-squat",
  "broad-jump",
  "bear-crawl",
  "renegade-row",
  "devil-press",
  "overhead-carry",
  // cardio
  "treadmill-run",
  "treadmill-incline-walk",
  "treadmill-intervals",
  "stationary-bike",
  "bike-intervals",
  "rowing-machine",
  "rowing-intervals",
  "elliptical",
  "stair-climber",
  "assault-bike",
  "ski-erg",
  "jump-rope",
  "jump-rope-intervals",
  "high-knees",
  "jumping-jacks",
  "shadow-boxing",
  "outdoor-run",
  "outdoor-walk",
  "sprint-intervals",
  // warmup
  "warmup-bike",
  "warmup-treadmill-walk",
  "warmup-row",
  "warmup-jump-rope",
  "warmup-jumping-jacks",
  "arm-circles",
  "band-pull-apart",
  "band-external-rotation",
  "shoulder-pass-through",
  "scapular-push-up",
  "scapular-pull-up",
  "cat-cow",
  "worlds-greatest-stretch",
  "leg-swings-front",
  "leg-swings-side",
  "hip-circles",
  "bodyweight-squat-primer",
  "walking-lunge-primer",
  "glute-bridge-primer",
  "inchworm",
  "ankle-rocks",
  "wrist-circles",
  "thoracic-rotation",
  "wall-slides",
  "band-good-morning",
  "kettlebell-halo",
  "torso-twists",
  "dead-bug-primer",
  // mobility
  "ninety-ninety-hip-switch",
  "deep-squat-hold",
  "hip-airplane",
  "thoracic-extension-foam-roller",
  "open-book",
  "shoulder-cars",
  "hip-cars",
  "ankle-dorsiflexion-wall",
  "frog-rock",
  "adductor-rock-back",
  "scorpion",
  "spiderman-lunge",
  "downward-dog-to-cobra",
  "prone-swimmers",
  "wall-angel",
  "dead-hang",
  "foam-roll-quads",
  "foam-roll-lats",
  "foam-roll-upper-back",
  "lateral-lunge-mobility",
  // cooldown
  "chest-doorway-stretch",
  "cross-body-shoulder-stretch",
  "overhead-triceps-stretch",
  "lat-stretch",
  "child-pose",
  "standing-quad-stretch",
  "standing-hamstring-stretch",
  "seated-hamstring-stretch",
  "pigeon-pose",
  "figure-four-stretch",
  "kneeling-hip-flexor-stretch",
  "couch-stretch",
  "butterfly-stretch",
  "standing-calf-stretch",
  "wall-calf-stretch",
  "seated-spinal-twist",
  "cobra-stretch",
  "knees-to-chest",
  "upper-trap-stretch",
  "wrist-flexor-stretch",
  "bicep-wall-stretch",
  "lying-glute-stretch",
  "forward-fold",
  "walking-cooldown",
  "box-breathing",
])

/**
 * Entries whose text names an overhead or punching action but which, on review, do not load a
 * protected shoulder overhead (coach review F03). Each needs a reason.
 */
const OVERHEAD_TEXT_SHOULDER_EXEMPT: ReadonlyMap<string, string> = new Map([
  ["band-pushdown", '"overhead" is where the band is anchored; the arms work below the chest'],
  ["zercher-squat", '"punched" is a bracing cue'],
  // band-lat-pulldown was exempt here until round 2 (R15): every other overhead pull lists the
  // shoulder, and the band starts with the arms fully overhead, so it now lists it too.
  ["hollow-body-hold", "static and unloaded; the instructions offer the arms-by-the-sides version"],
  ["dead-bug-primer", "a slow, unloaded single-arm reach while lying supported on the floor"],
  ["jump-squat", "an unloaded arm swing; the legs carry the load"],
  ["kneeling-hip-flexor-stretch", "the overhead reach is an optional cue to deepen a hip stretch"],
])

/** Categories that must each hold at least MIN_PER_CATEGORY exercises once the library is populated. */
const MAIN_CATEGORIES: readonly ExerciseCategory[] = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "legs",
  "glutes",
  "core",
  "full_body",
  "cardio",
  "mobility",
  "warmup",
]
/** "cooldown" and "stretching" are both cool-down phase content and are counted as one pool. */
const COOLDOWN_CATEGORIES: readonly ExerciseCategory[] = [
  "cooldown",
  "stretching",
]
const MIN_PER_CATEGORY = 10

type Range = [number, number]

/** Runs `check` over every exercise and collects "<id>: <problem>" strings for the ones that fail. */
function collectProblems(check: (ex: Exercise) => string | null): string[] {
  const out: string[] = []
  for (const ex of EXERCISES) {
    const problem = check(ex)
    if (problem) out.push(`${ex.id}: ${problem}`)
  }
  return out
}

function rangeProblem(
  name: string,
  range: Range | undefined,
  minLo: number
): string | null {
  if (!range) return null
  const [lo, hi] = range
  if (!Number.isFinite(lo) || !Number.isFinite(hi))
    return `${name} must be finite numbers`
  if (lo < minLo) return `${name} lower bound ${lo} must be >= ${minLo}`
  if (lo > hi) return `${name} lower bound ${lo} exceeds upper bound ${hi}`
  return null
}

function referenceResolves(id: string): boolean {
  return getExercise(id) !== undefined
}

function forTags(ex: Exercise): string[] {
  return (ex.tags ?? [])
    .filter((t) => t.startsWith("for:"))
    .map((t) => t.slice("for:".length))
}

describe("exercise library: identity", () => {
  it("has globally unique ids", () => {
    const seen = new Map<string, number>()
    for (const ex of EXERCISES) seen.set(ex.id, (seen.get(ex.id) ?? 0) + 1)
    const duplicates = [...seen.entries()]
      .filter(([, n]) => n > 1)
      .map(([id, n]) => `${id} x${n}`)
    expect(duplicates).toEqual([])
  })

  it("uses kebab-case ids with slug === id", () => {
    expect(
      collectProblems((ex) => {
        if (!KEBAB_CASE.test(ex.id)) return `id "${ex.id}" is not kebab-case`
        if (ex.slug !== ex.id) return `slug "${ex.slug}" differs from id`
        return null
      })
    ).toEqual([])
  })

  it("has a non-empty name", () => {
    expect(
      collectProblems((ex) => (ex.name.trim().length > 0 ? null : "empty name"))
    ).toEqual([])
  })
})

describe("exercise library: references", () => {
  it("resolves every alternativeExercises id", () => {
    expect(
      collectProblems((ex) => {
        for (const alt of ex.alternativeExercises) {
          if (alt === ex.id) return "lists itself as an alternative"
          if (!referenceResolves(alt)) return `unknown alternative "${alt}"`
        }
        return null
      })
    ).toEqual([])
  })

  it("resolves every variationOf id", () => {
    expect(
      collectProblems((ex) => {
        if (ex.variationOf === undefined) return null
        if (ex.variationOf === ex.id) return "is a variation of itself"
        if (!referenceResolves(ex.variationOf))
          return `unknown variationOf "${ex.variationOf}"`
        return null
      })
    ).toEqual([])
  })

  it("ships every canonical id", () => {
    const missing = [...CANONICAL_IDS].filter((id) => !getExercise(id))
    expect(missing).toEqual([])
  })
})

describe("exercise library: content", () => {
  it("has at least 3 instructions, 2 coach tips and 2 common mistakes", () => {
    expect(
      collectProblems((ex) => {
        if (ex.instructions.length < 3)
          return `only ${ex.instructions.length} instructions`
        if (ex.coachTips.length < 2)
          return `only ${ex.coachTips.length} coach tips`
        if (ex.commonMistakes.length < 2)
          return `only ${ex.commonMistakes.length} common mistakes`
        const blank = [
          ...ex.instructions,
          ...ex.coachTips,
          ...ex.commonMistakes,
        ].some((s) => s.trim().length === 0)
        return blank ? "contains an empty text item" : null
      })
    ).toEqual([])
  })

  it("lists at least one piece of equipment", () => {
    expect(
      collectProblems((ex) =>
        ex.equipment.length > 0 ? null : "no equipment listed"
      )
    ).toEqual([])
  })
})

describe("exercise library: prescriptions", () => {
  it("has well-formed ranges ([lo, hi], lo <= hi, lo > 0; rest may start at 0)", () => {
    expect(
      collectProblems(
        (ex) =>
          rangeProblem("setsRange", ex.setsRange, 1) ??
          rangeProblem("repRange", ex.repRange, 1) ??
          rangeProblem("durationRange", ex.durationRange, 1) ??
          rangeProblem("restRange", ex.restRange, 0)
      )
    ).toEqual([])
  })

  it("matches loadType to the prescribed range", () => {
    expect(
      collectProblems((ex) => {
        switch (ex.loadType) {
          case "timed":
          case "distance":
            return ex.durationRange
              ? null
              : `${ex.loadType} load type needs durationRange`
          case "external":
          case "bodyweight":
          case "assisted":
            return ex.repRange
              ? null
              : `${ex.loadType} load type needs repRange`
        }
      })
    ).toEqual([])
  })
})

describe("exercise library: muscle groups and tags", () => {
  it("maps every primary and secondary muscle to a muscle group", () => {
    expect(
      collectProblems((ex) => {
        if (!(ex.primaryMuscle in MUSCLE_TO_GROUP))
          return `unknown primary muscle "${ex.primaryMuscle}"`
        const bad = ex.secondaryMuscles.find((m) => !(m in MUSCLE_TO_GROUP))
        return bad ? `unknown secondary muscle "${bad}"` : null
      })
    ).toEqual([])
  })

  it('gives every warm-up, mobility, stretching and cool-down exercise a valid "for:<muscleGroup>" tag', () => {
    expect(
      collectProblems((ex) => {
        if (!TAGGED_CATEGORIES.has(ex.category)) return null
        const groups = forTags(ex)
        if (groups.length === 0) return 'missing a "for:" tag'
        const invalid = groups.find((g) => !MUSCLE_GROUP_SET.has(g))
        return invalid ? `"for:${invalid}" is not a MuscleGroup` : null
      })
    ).toEqual([])
  })

  it("covers every muscle group with at least one primary-muscle exercise", () => {
    const covered = new Set<MuscleGroup>()
    for (const ex of EXERCISES) covered.add(MUSCLE_TO_GROUP[ex.primaryMuscle])
    const missing = ALL_MUSCLE_GROUPS.filter((g) => !covered.has(g))
    expect(missing).toEqual([])
  })
})

describe("exercise library: contraindications", () => {
  it("flags every straight-leg raise for the lower back, lying or hanging alike", () => {
    // The hip flexors pull on the lumbar spine through the long lever whatever the setup, so a
    // lower-back limitation that removes the lying leg raise also removes the hanging versions.
    // Bent-knee raises and tucks (shorter lever) stay available.
    const straightLeg = EXERCISES.filter(
      (ex) =>
        ex.movementPattern === "trunk_flexion" &&
        (ex.id.endsWith("leg-raise") || ex.id === "toes-to-bar" || ex.id === "v-up")
    )
    expect(straightLeg.map((ex) => ex.id)).toEqual(
      expect.arrayContaining(["lying-leg-raise", "hanging-leg-raise", "toes-to-bar", "captains-chair-leg-raise"])
    )
    expect(
      collectProblems((ex) =>
        straightLeg.includes(ex) && !ex.contraindications.includes("lower_back")
          ? "straight-leg raise without a lower_back contraindication"
          : null
      )
    ).toEqual([])
  })

  it("never flags a harder trunk-flexion variation for an area its parent is not flagged for", () => {
    const rank = { beginner: 0, intermediate: 1, advanced: 2 } as const
    expect(
      collectProblems((ex) => {
        if (ex.movementPattern !== "trunk_flexion" || !ex.variationOf) return null
        const parent = getExercise(ex.variationOf)
        if (!parent || rank[ex.difficulty] <= rank[parent.difficulty]) return null
        const extra = ex.contraindications.filter((c) => !parent.contraindications.includes(c))
        return extra.length > 0 ? `parent ${parent.id} is not flagged for ${extra.join(", ")}` : null
      })
    ).toEqual([])
  })

  it('keeps every parent contraindication on its variations unless the variation is tagged "<area>_friendly"', () => {
    // Coach review F03: the limitation filter reads only contraindications, so a variation that
    // silently drops its parent's area (band lateral raise, easy row) reaches users who flagged it.
    // A variation built to spare that area says so with a tag, e.g. "lower_back_friendly".
    expect(
      collectProblems((ex) => {
        if (!ex.variationOf) return null
        const parent = getExercise(ex.variationOf)
        if (!parent) return null
        const dropped = parent.contraindications.filter(
          (area) => !ex.contraindications.includes(area) && !(ex.tags ?? []).includes(`${area}_friendly`)
        )
        return dropped.length > 0 ? `drops ${dropped.join(", ")} from ${parent.id}` : null
      })
    ).toEqual([])
  })

  it('only claims "<area>_friendly" for a real BodyArea', () => {
    const areas: readonly BodyArea[] = ["shoulder", "elbow", "wrist", "lower_back", "hip", "knee", "ankle", "neck"]
    expect(
      collectProblems((ex) => {
        const bad = (ex.tags ?? []).find(
          (t) => t.endsWith("_friendly") && !["home_friendly", "beginner_friendly", "joint_friendly"].includes(t) &&
            !areas.includes(t.slice(0, -"_friendly".length) as BodyArea)
        )
        if (bad) return `unknown area tag "${bad}"`
        const contradicts = (ex.tags ?? []).find((t) => t.endsWith("_friendly") && ex.contraindications.includes(t.slice(0, -"_friendly".length) as BodyArea))
        return contradicts ? `tagged "${contradicts}" but lists that area` : null
      })
    ).toEqual([])
  })

  it("flags the shoulder for every entry that works the arms overhead or punches, unless reviewed", () => {
    // Coach review F03: jumping jacks, the ski erg, shadow boxing and the burpee's overhead clap
    // all reached shoulder-protect users. Text that names an overhead or punching action needs a
    // shoulder contraindication; the exemptions below were reviewed one by one.
    const pattern = /\boverhead\b|\bpunch/i
    const exempt = OVERHEAD_TEXT_SHOULDER_EXEMPT
    const matches = (ex: Exercise) => pattern.test([...ex.instructions, ...ex.coachTips].join(" "))
    expect(
      collectProblems((ex) =>
        matches(ex) && !ex.contraindications.includes("shoulder") && !exempt.has(ex.id)
          ? "works the arms overhead (or punches) without a shoulder contraindication"
          : null
      )
    ).toEqual([])
    // The exemption list cannot go stale: each id still exists, still matches and is still unflagged.
    for (const id of exempt.keys()) {
      const ex = getExercise(id)
      expect(ex, id).toBeDefined()
      expect(matches(ex!) && !ex!.contraindications.includes("shoulder"), id).toBe(true)
    }
  })

  it("protects the areas the round-1 review found unprotected", () => {
    const required: Record<string, BodyArea[]> = {
      "sphinx-push-up": ["shoulder"],
      "bodyweight-triceps-extension": ["shoulder"],
      "band-lateral-raise": ["shoulder"],
      "warmup-jumping-jacks": ["shoulder"],
      "jumping-jacks": ["shoulder"],
      "v-up": ["shoulder", "lower_back"],
      "ski-erg": ["shoulder"],
      "ski-erg-intervals": ["shoulder"],
      "shadow-boxing": ["shoulder"],
      burpee: ["shoulder"],
      inchworm: ["lower_back"],
      "rowing-intervals": ["knee"],
      "warmup-row": ["lower_back"],
    }
    for (const [id, areas] of Object.entries(required)) {
      expect(getExercise(id)?.contraindications, id).toEqual(expect.arrayContaining(areas))
    }
  })
})

describe("exercise library: category coverage", () => {
  it(`has at least ${MIN_PER_CATEGORY} exercises in every main category`, () => {
    const counts = new Map<ExerciseCategory, number>()
    for (const ex of EXERCISES)
      counts.set(ex.category, (counts.get(ex.category) ?? 0) + 1)
    const short = MAIN_CATEGORIES.filter(
      (c) => (counts.get(c) ?? 0) < MIN_PER_CATEGORY
    ).map((c) => `${c}: ${counts.get(c) ?? 0}`)
    expect(short).toEqual([])
  })

  it(`has at least ${MIN_PER_CATEGORY} cool-down phase exercises (cooldown + stretching)`, () => {
    const total = EXERCISES.filter((ex) =>
      COOLDOWN_CATEGORIES.includes(ex.category)
    ).length
    expect(total).toBeGreaterThanOrEqual(MIN_PER_CATEGORY)
  })
})

describe("exercise library: coach review round 1", () => {
  it("F08: tags the kettlebell windmill as an overhead skill lift, and every overhead lift flags the shoulder", () => {
    // "skill" keeps it off body-weight starting loads and rep inflation; "overhead" marks the
    // locked-out bell the engine must keep away from push days.
    expect(getExercise("kettlebell-windmill")?.tags).toEqual(expect.arrayContaining(["skill", "overhead"]))
    expect(
      collectProblems((ex) =>
        ex.tags?.includes("overhead") && !ex.contraindications.includes("shoulder")
          ? 'tagged "overhead" without a shoulder contraindication'
          : null
      )
    ).toEqual([])
  })

  it("F18: keeps multi-move complexes out of muscle-gain programming", () => {
    expect(getExercise("man-maker")?.goalCompatibility).not.toContain("muscle_gain")
    expect(
      collectProblems((ex) =>
        ex.movementPattern === "conditioning" && ex.tags?.includes("complex") && ex.goalCompatibility.includes("muscle_gain")
          ? "a conditioning complex offered for muscle gain"
          : null
      )
    ).toEqual([])
  })

  it('F18: tags sprint and agility running "sprint"/"agility", and those always flag knee and ankle', () => {
    expect(getExercise("shuttle-run")?.tags).toEqual(expect.arrayContaining(["sprint", "agility"]))
    expect(
      collectProblems((ex) => {
        const tags = ex.tags ?? []
        const fast = tags.includes("sprint") || tags.includes("agility")
        // Cardio that needs its own ramp-up is sprint work; the engine keeps it off upper days.
        if (ex.category === "cardio" && ex.warmupRequired && !fast) return 'needs a ramp-up but is not tagged "sprint" or "agility"'
        if (fast && !(ex.contraindications.includes("knee") && ex.contraindications.includes("ankle")))
          return "sprint or agility work without knee and ankle contraindications"
        return null
      })
    ).toEqual([])
  })

  it("F19: rates hanging core work and floor pike presses above beginner, with a beginner regression", () => {
    for (const id of ["pike-push-up", "hanging-knee-raise", "lying-leg-raise"]) {
      expect(getExercise(id)?.difficulty, id).not.toBe("beginner")
    }
    expect(
      collectProblems((ex) =>
        ex.category === "core" && ex.equipment.includes("pull_up_bar") && ex.difficulty === "beginner"
          ? "a sustained hang rated beginner"
          : null
      )
    ).toEqual([])
    const regression = getExercise("hands-elevated-pike-push-up")
    const pike = getExercise("pike-push-up")!
    expect(regression?.difficulty).toBe("beginner")
    expect(regression?.variationOf).toBe("pike-push-up")
    expect(regression?.tags).toContain("beginner_friendly")
    expect(regression?.contraindications).toEqual(expect.arrayContaining(pike.contraindications))
    expect(pike.alternativeExercises[0]).toBe("hands-elevated-pike-push-up")
  })

  it("F20: offers every external-load, no-ramp-up fat-loss lift to endurance too", () => {
    // slotCandidates narrows to goal-compatible exercises, so a gap here left the inverted
    // wall-handstand-hold as the endurance vertical press. The exemptions are technique- or
    // stability-limited lifts that should not be pushed to 15-25 reps. The two loaded trunk drills
    // (core spec D12, D13) are strength and hypertrophy steps: the weighted dead bug is a
    // position-limited anti-extension drill (6-10, stopped before the back lifts), and endurance
    // trunk work keeps the bodyweight crunch family, Pallof presses and cable or machine crunches.
    const exempt = new Set([
      "kettlebell-clean",
      "kettlebell-clean-and-press",
      "dumbbell-clean-and-press",
      "renegade-row",
      "weighted-dead-bug",
      "weighted-crunch",
    ])
    expect(
      collectProblems((ex) =>
        ex.loadType === "external" &&
        !ex.warmupRequired &&
        ex.goalCompatibility.includes("fat_loss") &&
        !ex.goalCompatibility.includes("endurance") &&
        !exempt.has(ex.id)
          ? "fat-loss compatible but not endurance compatible"
          : null
      )
    ).toEqual([])
    for (const id of exempt) expect(getExercise(id)?.goalCompatibility, id).not.toContain("endurance")
  })

  it("F20: offers every loadable side- and rear-delt exercise to strength", () => {
    // Without this a strength user's delt isolation slot was locked to the bodyweight prone Y raise.
    expect(
      collectProblems((ex) =>
        ex.loadType === "external" &&
        (ex.primaryMuscle === "side_delts" || ex.primaryMuscle === "rear_delts") &&
        !ex.goalCompatibility.includes("strength")
          ? "loadable delt work not strength compatible"
          : null
      )
    ).toEqual([])
  })

  it('F20: tags every handstand "inversion" and gives the wall hold a bail-out and an entry version', () => {
    expect(
      collectProblems((ex) =>
        /handstand/i.test(`${ex.id} ${ex.name}`) && !ex.tags?.includes("inversion") ? 'handstand without the "inversion" tag' : null
      )
    ).toEqual([])
    const hold = getExercise("wall-handstand-hold")!
    expect(hold.tags).toEqual(expect.arrayContaining(["inversion", "skill"]))
    const text = hold.instructions.join(" ")
    expect(text).toMatch(/bail out/i)
    expect(text).toMatch(/wall walk-up/i)
  })

  it("F24: says where every rack-dependent barbell lift is racked, and tags it needs_rack", () => {
    // There is no rack Equipment value: the tag lets the engine and onboarding ask about one, and
    // the instructions tell the lifter. Exempt: the floor press can be rolled into place.
    const racked = /unrack|out of the rack|inside a rack|in (a|the) rack/i
    const exempt = new Set(["floor-press"])
    expect(
      collectProblems((ex) => {
        const text = ex.instructions.join(" ")
        const tagged = ex.tags?.includes("needs_rack") ?? false
        if (tagged && !/\b(un)?rack/i.test(text)) return "needs_rack but the instructions never mention the rack"
        if (!tagged && racked.test(text) && !exempt.has(ex.id)) return 'unracks a bar but is not tagged "needs_rack"'
        return null
      })
    ).toEqual([])
    expect(getExercise("inverted-row")?.tags).toContain("needs_rack")
    expect(getExercise("barbell-back-squat")?.tags).toContain("needs_rack")
  })

  it("F24: sets safety arms or a spotter for every racked barbell squat and bench press", () => {
    expect(
      collectProblems((ex) =>
        ex.tags?.includes("needs_rack") &&
        (ex.movementPattern === "squat" || ex.movementPattern === "horizontal_push") &&
        !/safety arms|safety pins|\bpins\b|spotter/i.test(ex.instructions.join(" "))
          ? "no safety arms, pins or spotter in the instructions"
          : null
      )
    ).toEqual([])
    // The bench press pauses on the chest (tempo 2-1-1-0); "touch lightly" contradicted it.
    const bench = getExercise("barbell-bench-press")!
    expect(bench.instructions.join(" ")).not.toMatch(/touch the chest lightly/i)
    expect(bench.instructions.join(" ")).toMatch(/pause briefly on the chest/i)
  })

  it("F24: makes the doorway row grip-safe and the reverse hyperextension doable on a flat bench", () => {
    const row = getExercise("doorway-row")!
    expect(row.instructions.join(" ")).toMatch(/solid door frame/i)
    expect(row.instructions.join(" ")).toMatch(/never the door itself or a handle/i)
    expect(row.commonMistakes.join(" ")).toMatch(/grip can slip/i)
    const hyper = getExercise("reverse-hyperextension")!
    expect(hyper.equipment).toEqual(["bench"])
    expect(hyper.instructions.join(" ")).toMatch(/flat bench/i)
    expect(hyper.instructions.join(" ")).not.toMatch(/high bench|machine/i)
  })

  it("F25: labels the prone Y raise as rear-delt and trap work, and keeps side delts for abduction", () => {
    const y = getExercise("prone-y-raise")!
    expect(y.primaryMuscle).toBe("rear_delts")
    expect(y.secondaryMuscles).toEqual(["traps", "upper_back"])
    // Round 2 (R09) removed the old vertical_pull exception: it was there for the upright rows,
    // which then filled back-pull slots as a "second pull". Side-delt work is abduction work.
    expect(
      collectProblems((ex) =>
        ex.primaryMuscle === "side_delts" && ex.movementPattern !== "shoulder_abduction"
          ? `side_delts primary on a ${ex.movementPattern} movement`
          : null
      )
    ).toEqual([])
  })

  it('F26: tags the sleeper stretch "corrective", and only cool-down or mobility work is corrective', () => {
    expect(getExercise("sleeper-stretch")?.tags).toContain("corrective")
    expect(
      collectProblems((ex) =>
        ex.tags?.includes("corrective") && !["cooldown", "stretching", "mobility"].includes(ex.category)
          ? "corrective tag outside cool-down and mobility work"
          : null
      )
    ).toEqual([])
  })

  it('F29: tags every bilateral one-dumbbell lift "single_implement", and only those', () => {
    // Starting loads use per-hand dumbbell fractions; a goblet squat holds the whole load in one bell.
    const oneDumbbell = (ex: Exercise) => {
      const text = ex.instructions.join(" ")
      return /\b(one|a) dumbbell\b/i.test(text) && !/dumbbell in each hand|two dumbbells|the dumbbells/i.test(text)
    }
    expect(
      collectProblems((ex) => {
        const tagged = ex.tags?.includes("single_implement") ?? false
        const bilateralDumbbell = ex.loadType === "external" && ex.equipment.includes("dumbbell") && !ex.isUnilateral
        if (tagged && !bilateralDumbbell) return "single_implement on a lift that is not a bilateral dumbbell lift"
        if (bilateralDumbbell && oneDumbbell(ex) !== tagged) return tagged ? "single_implement but holds two dumbbells" : 'holds one dumbbell but is not tagged "single_implement"'
        return null
      })
    ).toEqual([])
    for (const id of ["goblet-squat", "dumbbell-sumo-squat", "dumbbell-hip-thrust"]) {
      expect(getExercise(id)?.tags, id).toContain("single_implement")
    }
  })

  it("F29: says the reps are per leg or per side whenever a unilateral exercise alternates", () => {
    // The engine prescribes and times unilateral reps per side; "alternate for the target number of
    // steps" read as total steps and halved the work.
    expect(
      collectProblems((ex) => {
        if (!ex.isUnilateral || !ex.repRange) return null
        const text = [...ex.instructions, ...ex.coachTips].join(" ")
        if (!/alternat|number of steps/i.test(text)) return null
        return /per (leg|side|arm)|both arms have completed|both have completed/i.test(text)
          ? null
          : "alternates without saying the reps are per leg or per side"
      })
    ).toEqual([])
    expect(getExercise("dumbbell-walking-lunge")?.instructions.join(" ")).not.toMatch(/target number of steps/i)
  })
})

/** Patterns that count a lift as a back pull (slot matching, push/pull balance). */
const BACK_PULL_PATTERNS: readonly MovementPattern[] = ["horizontal_pull", "vertical_pull"]

/** Instructions that kneel, or sit or rock the hips back toward the heels (a deep, loaded knee bend). */
const KNEEL_TEXT = /\bkneel|\b(toward|towards|onto|back on) the (kneeling )?heels?\b/i

/**
 * Entries whose instructions kneel but which, on review, do not load a protected knee (coach
 * review round 2, R15). Each needs a reason; the check below keeps the list from going stale.
 */
const KNEEL_TEXT_KNEE_EXEMPT: ReadonlyMap<string, string> = new Map([
  ["assisted-pull-up", "the instructions offer standing on the platform instead of kneeling"],
  ["single-arm-lat-pulldown", "the instructions offer sitting instead of kneeling"],
  ["hip-cars", "the instructions offer a standing version holding a rack"],
  ["thread-the-needle", "all fours with the hips kept over the knees (no sitting back); the hands share the load, as in bird-dog and cat-cow"],
  ["bird-dog-primer", "all fours with the hips kept over the knees; the hands share the load, as in bird-dog and cat-cow"],
])

/** Kit tags: equipment the Equipment list cannot name (see the tags doc in types.ts). */
const KIT_TAGS: readonly string[] = ["needs_rack", "needs_adjustable_bench", "needs_elevated_bench", "needs_battle_rope"]

/** The joint a momentum drill swings through, from the drill's primary group. */
function swungArea(ex: Exercise): BodyArea | null {
  const group = MUSCLE_TO_GROUP[ex.primaryMuscle]
  if (["shoulders", "chest", "back", "biceps", "triceps"].includes(group)) return "shoulder"
  if (["glutes", "hamstrings", "quads"].includes(group)) return "hip"
  return group === "core" ? "lower_back" : null
}

/** Whether the bodyweight preset's kit covers a lift (no kit tag, every item owned). */
function bodyweightPresetAllows(ex: Exercise): boolean {
  const kit: readonly string[] = EQUIPMENT_PRESETS.bodyweight
  if ((ex.tags ?? []).some((t) => t.startsWith("needs_"))) return false
  return ex.equipment.every((e) => e === "bodyweight" || kit.includes(e))
}

/** Whether the instructions set the bench to an incline or decline (an upright seat, 75 degrees or more, is not one). */
function setsAngledBench(ex: Exercise): boolean {
  const text = ex.instructions.join(" ")
  if (/\bdecline bench\b|\bdegree decline\b/i.test(text)) return true
  const angle = /\bset (?:the|a) bench to (?:about )?(\d+)/i.exec(text) ?? /\bbench set to (?:about )?(\d+)/i.exec(text)
  return angle !== null && Number(angle[1]) < 75
}

describe("exercise library: coach review round 2", () => {
  it("R09: files upright rows as shoulder abduction, so delt and trap work never fills a compound back pull", () => {
    // general-b-d1, strength-i-lb-d1/d7: upright rows filed as vertical_pull took Full body A's
    // second pull and dodged the same-pattern and same-primary penalties real back pulls pay.
    for (const id of ["upright-row", "cable-upright-row"]) {
      expect(getExercise(id)?.movementPattern, id).toBe("shoulder_abduction")
    }
    expect(
      collectProblems((ex) => {
        if (!BACK_PULL_PATTERNS.includes(ex.movementPattern)) return null
        if (ex.primaryMuscle === "side_delts") return `side-delt work filed as ${ex.movementPattern}`
        // Shrugs stay vertical_pull: re-filing them as abduction would give them the lateral-raise
        // starting-load fraction and flag honest shrug loads as slips. As isolation work they never
        // match a compound-pinned back slot.
        if (ex.primaryMuscle === "traps" && ex.mechanics !== "isolation") return `compound trap work filed as ${ex.movementPattern}`
        return null
      })
    ).toEqual([])
  })

  it("R15: lists the knee for every entry that kneels or sits back toward the heels, unless reviewed", () => {
    // fatloss-i-knee-d1/d7: the kneeling lat stretch (hips back toward the heels) reached a
    // knee-flagged user, while child-pose in the same position lists the knee.
    const kneels = (ex: Exercise) => KNEEL_TEXT.test(ex.instructions.join(" "))
    expect(
      collectProblems((ex) =>
        kneels(ex) && !ex.contraindications.includes("knee") && !KNEEL_TEXT_KNEE_EXEMPT.has(ex.id)
          ? "kneels or sits back toward the heels without a knee contraindication"
          : null
      )
    ).toEqual([])
    for (const id of KNEEL_TEXT_KNEE_EXEMPT.keys()) {
      const ex = getExercise(id)
      expect(ex, id).toBeDefined()
      expect(kneels(ex!) && !ex!.contraindications.includes("knee"), id).toBe(true)
    }
    // The lat stretch is now standing and bench-supported, so a knee-flagged user keeps a lat
    // stretch that never loads the knee; the push-up ladder's kneeling rung lists the knee.
    const lat = getExercise("lat-stretch")!
    expect(kneels(lat)).toBe(false)
    expect(lat.instructions.join(" ")).toMatch(/hinge at the hips/i)
    expect(lat.contraindications).not.toContain("knee")
    expect(getExercise("knee-push-up")?.contraindications).toContain("knee")
  })

  it("R15: flags the shoulder on the band lat pulldown, the cobra stretch and every overhead back pull", () => {
    // general-i-shoulder-d1: the band pulldown (arms overhead) and the cobra (shoulders in
    // extension under body weight) both reached a shoulder-flagged user.
    for (const id of ["band-lat-pulldown", "cobra-stretch"]) {
      expect(getExercise(id)?.contraindications, id).toContain("shoulder")
    }
    expect(
      collectProblems((ex) =>
        ex.category === "back" && ex.movementPattern === "vertical_pull" && !ex.contraindications.includes("shoulder")
          ? "overhead back pull without a shoulder contraindication"
          : null
      )
    ).toEqual([])
  })

  it('R15: tags momentum drills "ballistic", each lists the joint it swings, and a controlled cuff drill remains', () => {
    // general-i-shoulder-d1: cross-body arm swings warmed up a shoulder-flagged user ahead of
    // band external rotation.
    const arm = getExercise("arm-swings")!
    expect(arm.tags).toContain("ballistic")
    expect(arm.contraindications).toContain("shoulder")
    const swings = (ex: Exercise) =>
      (ex.category === "warmup" || ex.category === "mobility") &&
      ex.movementPattern !== "locomotion" &&
      ex.movementPattern !== "conditioning" &&
      /\bswing/i.test(ex.instructions.join(" "))
    expect(
      collectProblems((ex) => {
        const ballistic = (ex.tags ?? []).includes("ballistic")
        if (swings(ex) !== ballistic) return ballistic ? '"ballistic" but the instructions never swing' : 'swings a limb or the trunk but is not tagged "ballistic"'
        const area = ballistic ? swungArea(ex) : null
        return area && !ex.contraindications.includes(area) ? `swings the ${area} without listing it` : null
      })
    ).toEqual([])
    const cuff = getExercise("band-external-rotation")!
    expect(cuff.contraindications).not.toContain("shoulder")
    expect(cuff.tags ?? []).not.toContain("ballistic")
  })

  it("R15: has the negative pull-up step up to the bar, never jump, and never shows an explosive concentric", () => {
    // endurance-b-d7, fatloss-b-d7: "a box or a jump" and tempo 4-0-X-0 for a lifter who cannot pull up yet.
    const neg = getExercise("negative-pull-up")!
    const text = neg.instructions.join(" ")
    expect(text).toMatch(/sturdy box, bench or chair/i)
    expect(text).toMatch(/never jump into the top position/i)
    expect(text).not.toMatch(/\bor a jump\b/i)
    expect(neg.commonMistakes.join(" ")).toMatch(/jumping into the top position/i)
    expect(neg.tempo).toBe("4-0-0-1")
    expect(
      collectProblems((ex) =>
        (ex.tags ?? []).includes("eccentric") && /^\s*\d+\s*-\s*\d+\s*-\s*x/i.test(ex.tempo ?? "")
          ? `eccentric work with an explosive concentric (${ex.tempo})`
          : null
      )
    ).toEqual([])
  })

  it("R26: gives every beginner bodyweight push-up an easier same-pattern option on the bodyweight preset", () => {
    // fatloss-b-d1: incline-push-up required a bench, so the knee push-up's swaps were all harder.
    expect(getExercise("incline-push-up")?.equipment).toEqual(["bodyweight"])
    const regression = (ex: Exercise) =>
      ex.movementPattern === "horizontal_push" && (ex.tags ?? []).includes("beginner_friendly") && bodyweightPresetAllows(ex)
    // The bottom rung scales itself: the higher the surface, the easier the rep.
    const selfScaling = (ex: Exercise) => /the higher the surface, the easier/i.test([...ex.instructions, ...ex.coachTips].join(" "))
    expect(
      collectProblems((ex) => {
        if (TAGGED_CATEGORIES.has(ex.category)) return null
        if (ex.movementPattern !== "horizontal_push" || ex.loadType !== "bodyweight" || ex.difficulty !== "beginner") return null
        if (!bodyweightPresetAllows(ex) || selfScaling(ex)) return null
        const easier = ex.alternativeExercises.some((id) => {
          const alt = getExercise(id)
          return alt !== undefined && regression(alt)
        })
        return easier ? null : "no easier same-pattern alternative on the bodyweight preset"
      })
    ).toEqual([])
    expect(selfScaling(getExercise("incline-push-up")!)).toBe(true)
  })

  it("R26: tags lifts that need an incline, decline or raised bench, and only those", () => {
    // general-i-shoulder-d7: seal-row on a flat home bench; hypertrophy-b-d7: incline presses and
    // chest-supported rows for a possibly flat bench. There is no adjustable-bench Equipment value.
    expect(getExercise("seal-row")?.tags).toContain("needs_elevated_bench")
    expect(
      collectProblems((ex) => {
        const tags = ex.tags ?? []
        const raised = /\bon blocks\b|\braise (?:a|the) (?:flat )?bench\b/i.test(ex.instructions.join(" "))
        if (raised !== tags.includes("needs_elevated_bench"))
          return raised ? 'raises the bench but is not tagged "needs_elevated_bench"' : 'tagged "needs_elevated_bench" but never raises the bench'
        const angled = setsAngledBench(ex)
        if (angled !== tags.includes("needs_adjustable_bench"))
          return angled ? 'sets an incline or decline bench but is not tagged "needs_adjustable_bench"' : 'tagged "needs_adjustable_bench" without an incline or decline'
        return null
      })
    ).toEqual([])
    for (const id of ["incline-dumbbell-press", "chest-supported-dumbbell-row", "chest-supported-rear-delt-fly"]) {
      expect(getExercise(id)?.tags, id).toContain("needs_adjustable_bench")
    }
    // A flat bench keeps its staples.
    for (const id of ["dumbbell-bench-press", "single-arm-dumbbell-row", "seated-dumbbell-shoulder-press"]) {
      expect(getExercise(id)?.tags ?? [], id).not.toContain("needs_adjustable_bench")
    }
  })

  it("R26: keeps cardio_machine for machines and names other kit with a known needs_ tag", () => {
    // general-b-d5: battle ropes were filed under cardio_machine, so a treadmill reached rope waves.
    expect(getExercise("battle-rope")?.tags).toContain("needs_battle_rope")
    expect(
      collectProblems((ex) => {
        const tags = ex.tags ?? []
        const unknown = tags.find((t) => t.startsWith("needs_") && !KIT_TAGS.includes(t))
        if (unknown) return `unknown kit tag "${unknown}"`
        const machineCardio = ex.category === "cardio" || ex.category === "warmup" || ex.category === "cooldown"
        return ex.equipment.includes("cardio_machine") && !machineCardio && !tags.some((t) => t.startsWith("needs_"))
          ? "lists cardio_machine for kit that is not a cardio machine"
          : null
      })
    ).toEqual([])
  })

  it("R20: every strength-compatible heavy press, squat and floor pull can be prescribed at 4 reps or fewer", () => {
    // strength-a-d1: the bench (5–8) sat above the overhead press secondary (4–6). Rows and hip
    // thrusts are support lifts in strength and keep their own floors.
    const HEAVY_PATTERNS: readonly MovementPattern[] = ["horizontal_push", "vertical_push", "squat", "hinge"]
    expect(
      collectProblems((ex) =>
        ex.tags?.includes("big_lift") && ex.goalCompatibility.includes("strength") && HEAVY_PATTERNS.includes(ex.movementPattern) && ex.repRange && ex.repRange[0] > 4
          ? `strength big lift starts at ${ex.repRange[0]} reps`
          : null,
      ),
    ).toEqual([])
    expect(getExercise("barbell-bench-press")?.restRange).toEqual([120, 240])
    for (const id of ["dumbbell-bench-press", "incline-dumbbell-press", "seated-dumbbell-shoulder-press"]) {
      expect(getExercise(id)?.restRange, id).toEqual([90, 180])
    }
  })

  it("R19: files hip abduction drills under hip_abduction, never hip extension, and has a bodyweight leg curl", () => {
    // hypertrophy-b-d1: clamshells and fire hydrants filled the hamstring slot as "hip extension".
    expect(
      collectProblems((ex) =>
        ex.primaryMuscle === "abductors" && ex.mechanics === "isolation" && ex.movementPattern !== "hip_abduction"
          ? `abduction drill filed as ${ex.movementPattern}`
          : null,
      ),
    ).toEqual([])
    expect(collectProblems((ex) => (ex.movementPattern === "hip_abduction" && ex.tags?.includes("abduction") !== true ? "hip_abduction without the abduction tag" : null))).toEqual([])
    const curls = EXERCISES.filter(
      (ex) => ex.movementPattern === "knee_flexion" && ex.difficulty === "beginner" && ex.equipment.every((e) => EQUIPMENT_PRESETS.bodyweight.includes(e)),
    )
    expect(curls.map((ex) => ex.id)).toContain("slider-hamstring-curl")
  })

  it("R14: the renegade row is not a strength lift, lists the lower back and is counted per arm", () => {
    const row = getExercise("renegade-row")!
    expect(row.goalCompatibility).not.toContain("strength")
    expect(row.contraindications).toContain("lower_back")
    expect(row.isUnilateral).toBe(true)
  })

  it("R25: tags the light cardio, keeps impact pulse raisers short and has a low-impact march", () => {
    const march = getExercise("warmup-march")!
    expect(march.tags).toEqual(expect.arrayContaining(["light_cardio", "low_impact"]))
    expect(march.equipment).toEqual(["bodyweight"])
    for (const id of ["warmup-bike", "warmup-treadmill-walk", "warmup-row", "warmup-elliptical", "warmup-jump-rope", "warmup-jumping-jacks"]) {
      expect(getExercise(id)?.tags, id).toContain("light_cardio")
    }
    for (const id of ["warmup-jumping-jacks", "warmup-jump-rope"]) {
      expect(getExercise(id)?.durationRange, id).toEqual([60, 120])
      expect(getExercise(id)?.alternativeExercises, id).toContain("warmup-march")
    }
  })
})

const ALL_GOALS: readonly Goal[] = ["muscle_gain", "strength", "fat_loss", "general_fitness", "endurance"]

/** The four trunk pattern families of the core programming spec (C07), as the engine assigns them. */
const coreFamilyOf = coreFamily

type Preset = keyof typeof EQUIPMENT_PRESETS

/** Whether a preset's kit covers an exercise (mirrors selection.ts equipmentAllowed and kitTagsAllowed). */
function presetAllows(ex: Exercise, preset: Preset): boolean {
  const kit: readonly Equipment[] = EQUIPMENT_PRESETS[preset]
  const tags = ex.tags ?? []
  if (tags.includes("needs_rack") && !kit.includes("rack")) return false
  if (preset !== "full_gym" && tags.some((t) => t.startsWith("needs_") && t !== "needs_rack")) return false
  return ex.equipment.every((e) => e === "bodyweight" || kit.includes(e))
}

/** Instructions that hold the head and shoulders off the floor (crunches, sit-ups, hollow holds). */
const HEAD_LIFTED_TEXT = /shoulder blades off|shoulders off the floor|shoulders (?:slightly )?lifted|lift the shoulders|curl (?:the spine )?up\b/i

describe("exercise library: core programming spec", () => {
  it("D01: files the bird dog as anti-rotation, like its warm-up primer, and offers it to every goal", () => {
    const birdDog = getExercise("bird-dog")!
    expect(birdDog.movementPattern).toBe("anti_rotation")
    expect(birdDog.movementPattern).toBe(getExercise("bird-dog-primer")?.movementPattern)
    expect(birdDog.goalCompatibility).toEqual(expect.arrayContaining([...ALL_GOALS]))
  })

  it('D02: files the dumbbell side bend as flexion tagged "lateral_flexion", never as anti-lateral work', () => {
    const bend = getExercise("dumbbell-side-bend")!
    expect(bend.movementPattern).toBe("trunk_flexion")
    expect(bend.tags).toContain("lateral_flexion")
    expect(coreFamilyOf(bend)).toBe("flexion_rotation")
    expect(
      collectProblems((ex) =>
        (ex.tags ?? []).includes("lateral_flexion") && (ex.category !== "core" || ex.movementPattern !== "trunk_flexion")
          ? '"lateral_flexion" on work that is not core trunk flexion'
          : null,
      ),
    ).toEqual([])
  })

  it("D03: loads the weighted plank with a plate, so a bodyweight-only user is never offered it", () => {
    const plank = getExercise("weighted-plank")!
    expect(plank.equipment).toEqual(["barbell"])
    expect(plank.instructions.join(" ")).toMatch(/a weight plate on your upper back/i)
    expect(presetAllows(plank, "bodyweight")).toBe(false)
    expect(presetAllows(plank, "home_gym")).toBe(true)
    expect(loadableTrunk(plank)).toBe(true)
  })

  it("D04: offers the accessory-dose anti-movement drills to every goal", () => {
    for (const id of ["band-pallof-press", "plank-shoulder-tap", "side-plank-hip-dip", "hollow-body-hold", "bird-dog"]) {
      expect(getExercise(id)?.goalCompatibility, id).toEqual(expect.arrayContaining([...ALL_GOALS]))
    }
  })

  it("D08: lists the neck for every head-lifted flexion drill, and neck-safe trunk work remains", () => {
    for (const id of ["crunch", "bicycle-crunch", "sit-up", "decline-sit-up", "v-up", "hollow-body-hold", "flutter-kick", "weighted-crunch"]) {
      expect(getExercise(id)?.contraindications, id).toContain("neck")
    }
    expect(
      collectProblems((ex) =>
        ex.category === "core" && HEAD_LIFTED_TEXT.test(ex.instructions.join(" ")) && !ex.contraindications.includes("neck")
          ? "holds the head and shoulders off the floor without a neck contraindication"
          : null,
      ),
    ).toEqual([])
    // A neck-flagged lifter keeps head-down anti-movement work and supported or cable flexion.
    for (const id of ["dead-bug", "bird-dog", "pallof-press", "plank", "side-plank", "suitcase-carry", "reverse-crunch", "cable-crunch", "machine-crunch"]) {
      expect(getExercise(id)?.contraindications, id).not.toContain("neck")
    }
    expect(getExercise("machine-crunch")?.tags).toContain("neck_friendly")
  })

  it('D09: tags hip-flexor-led and hanging trunk work, and keeps both tags consistent', () => {
    const hipFlexorLed = [
      "flutter-kick",
      "lying-leg-raise",
      "seated-knee-tuck",
      "sit-up",
      "decline-sit-up",
      "v-up",
      "hanging-knee-raise",
      "hanging-leg-raise",
      "toes-to-bar",
      "captains-chair-leg-raise",
      "russian-twist",
      "medicine-ball-russian-twist",
      "mountain-climber",
    ]
    for (const id of hipFlexorLed) expect(getExercise(id)?.tags, id).toContain("hip_flexor_led")
    for (const id of ["hanging-knee-raise", "hanging-leg-raise", "toes-to-bar", "captains-chair-leg-raise", "l-sit"]) {
      expect(getExercise(id)?.tags, id).toContain("hanging")
    }
    // Trunk work the coach rules read in core slots; the drills a hip-flagged beginner should meet
    // first (dead bug, planks, Pallof presses) are not tagged.
    for (const id of ["dead-bug", "plank", "pallof-press", "reverse-crunch", "crunch"]) {
      expect(getExercise(id)?.tags ?? [], id).not.toContain("hip_flexor_led")
    }
    expect(
      collectProblems((ex) => {
        const tags = ex.tags ?? []
        const hanging = tags.includes("hanging")
        const hipLed = tags.includes("hip_flexor_led")
        if ((hanging || hipLed) && ex.category !== "core") return "core-only tag outside the core category"
        if (hipLed && !ex.secondaryMuscles.includes("hip_flexors")) return '"hip_flexor_led" without hip flexors among the secondary muscles'
        if (hanging && !hipLed) return '"hanging" work that is not tagged "hip_flexor_led"'
        const onBars = ex.category === "core" && ex.equipment.some((e) => e === "pull_up_bar" || e === "dip_station")
        if (onBars && !hanging) return 'bar or dip-station trunk work not tagged "hanging"'
        return null
      }),
    ).toEqual([])
  })

  it("D10, D11: gives the side plank and the plank a beginner regression any bodyweight user can do", () => {
    const pairs: readonly [string, string][] = [
      ["knee-side-plank", "side-plank"],
      ["incline-plank", "plank"],
    ]
    for (const [id, parentId] of pairs) {
      const ex = getExercise(id)!
      const parent = getExercise(parentId)!
      expect(ex, id).toBeDefined()
      expect(ex.variationOf, id).toBe(parentId)
      expect(ex.difficulty, id).toBe("beginner")
      expect(ex.tags, id).toEqual(expect.arrayContaining(["beginner_friendly", "home_friendly"]))
      expect(ex.movementPattern, id).toBe(parent.movementPattern)
      expect(ex.loadType, id).toBe("timed")
      expect(ex.durationRange![1], id).toBeLessThanOrEqual(parent.durationRange![1])
      expect(ex.contraindications, id).toEqual(expect.arrayContaining(parent.contraindications))
      expect(ex.goalCompatibility, id).toEqual(expect.arrayContaining([...ALL_GOALS]))
      expect(bodyweightPresetAllows(ex), id).toBe(true)
    }
    const knee = getExercise("knee-side-plank")!
    expect(knee.durationRange).toEqual([15, 30])
    expect(knee.isUnilateral).toBe(true)
    expect(knee.contraindications).toEqual(["shoulder"])
    expect(getExercise("incline-plank")?.contraindications).toEqual([])
  })

  it("D12, D13: adds one-dumbbell loaded trunk work: a weighted dead bug and a weighted crunch", () => {
    const deadBug = getExercise("weighted-dead-bug")!
    expect(deadBug.variationOf).toBe("dead-bug")
    expect(deadBug.movementPattern).toBe("anti_extension")
    expect(deadBug.difficulty).toBe("intermediate")
    expect(deadBug.repRange).toEqual([6, 10])
    expect(deadBug.contraindications).toEqual([])
    const crunch = getExercise("weighted-crunch")!
    expect(crunch.variationOf).toBe("crunch")
    expect(crunch.movementPattern).toBe("trunk_flexion")
    expect(crunch.difficulty).toBe("beginner")
    expect(crunch.repRange).toEqual([8, 15])
    expect(crunch.contraindications).toEqual(["neck"])
    for (const ex of [deadBug, crunch]) {
      expect(ex.equipment, ex.id).toEqual(["dumbbell"])
      expect(ex.loadType, ex.id).toBe("external")
      expect(ex.tags, ex.id).toContain("single_implement")
      expect(ex.goalCompatibility, ex.id).toEqual(expect.arrayContaining(["strength", "muscle_gain", "general_fitness", "fat_loss"]))
      expect(ex.goalCompatibility, ex.id).not.toContain("endurance")
      expect(loadableTrunk(ex), ex.id).toBe(true)
    }
  })

  it("keeps the mountain climber out of every trunk family: it is conditioning (C13)", () => {
    const climber = getExercise("mountain-climber")!
    expect(climber.tags).toContain("conditioning")
    expect(coreFamilyOf(climber)).toBeNull()
  })

  it("gives every equipment preset a beginner drill in each of the four trunk families", () => {
    const presets: readonly Preset[] = ["bodyweight", "dumbbells", "home_gym", "full_gym"]
    const gaps: string[] = []
    for (const preset of presets) {
      for (const family of CORE_FAMILIES) {
        const found = EXERCISES.some((ex) => coreFamilyOf(ex) === family && ex.difficulty === "beginner" && presetAllows(ex, preset))
        if (!found) gaps.push(`${preset}: ${family}`)
      }
    }
    expect(gaps).toEqual([])
  })

  it("gives trained lifters loadable anti-extension and flexion work on dumbbell, home-gym and full-gym kit (C11)", () => {
    const presets: readonly Preset[] = ["dumbbells", "home_gym", "full_gym"]
    const gaps: string[] = []
    for (const preset of presets) {
      for (const family of ["anti_extension", "flexion_rotation"] as const) {
        const found = EXERCISES.some(
          (ex) => coreFamilyOf(ex) === family && ex.difficulty !== "advanced" && loadableTrunk(ex) && presetAllows(ex, preset),
        )
        if (!found) gaps.push(`${preset}: ${family}`)
      }
    }
    expect(gaps).toEqual([])
  })

  it("leaves shoulder- and neck-flagged lifters trunk work in every family they can reach (limitation rules)", () => {
    const reachable = (preset: Preset, area: BodyArea, family: CoreFamily) =>
      EXERCISES.filter((ex) => coreFamilyOf(ex) === family && presetAllows(ex, preset) && !ex.contraindications.includes(area)).map((ex) => ex.id)
    // The suitcase carry is the anti-lateral option a shoulder-flagged dumbbell lifter keeps (C06).
    expect(reachable("dumbbells", "shoulder", "anti_lateral")).toContain("suitcase-carry")
    const gaps: string[] = []
    for (const preset of ["dumbbells", "home_gym", "full_gym"] as const) {
      for (const area of ["shoulder", "neck"] as const) {
        for (const family of CORE_FAMILIES) {
          if (reachable(preset, area, family).length === 0) gaps.push(`${preset} ${area}: ${family}`)
        }
      }
    }
    expect(gaps).toEqual([])
  })
})
