/**
 * Static exercise library types.
 *
 * The exercise library is a frontend-only, static data module. Nothing here is
 * ever fetched from the backend. Persistence layers reference exercises by `id`.
 */

/** Coarse training groups used for split planning and recovery tracking. */
export type MuscleGroup =
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "forearms"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "core"
  | "full_body"
  | "cardio"

/** Specific muscles. Every Muscle maps to exactly one MuscleGroup (see MUSCLE_TO_GROUP). */
export type Muscle =
  | "chest"
  | "upper_chest"
  | "front_delts"
  | "side_delts"
  | "rear_delts"
  | "lats"
  | "upper_back"
  | "traps"
  | "lower_back"
  | "biceps"
  | "triceps"
  | "forearms"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "adductors"
  | "abductors"
  | "hip_flexors"
  | "abs"
  | "obliques"
  | "neck"
  | "full_body"
  | "cardiovascular"

export const MUSCLE_TO_GROUP: Record<Muscle, MuscleGroup> = {
  chest: "chest",
  upper_chest: "chest",
  front_delts: "shoulders",
  side_delts: "shoulders",
  rear_delts: "shoulders",
  lats: "back",
  upper_back: "back",
  traps: "back",
  lower_back: "core",
  biceps: "biceps",
  triceps: "triceps",
  forearms: "forearms",
  quads: "quads",
  hamstrings: "hamstrings",
  glutes: "glutes",
  calves: "calves",
  adductors: "glutes",
  abductors: "glutes",
  hip_flexors: "core",
  abs: "core",
  obliques: "core",
  neck: "shoulders",
  full_body: "full_body",
  cardiovascular: "cardio",
}

const LEG_GROUPS: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(["quads", "hamstrings", "glutes", "calves"])

/**
 * Which side a unilateral exercise's target counts: "leg" for lower-body work (split squat,
 * single-leg RDL, walking lunge), "side" otherwise (one-arm row, side plank). Targets are per leg or
 * per side, as the instructions say. null for bilateral work.
 */
export function unilateralSide(exercise: Pick<Exercise, "isUnilateral" | "primaryMuscle" | "movementPattern">): "leg" | "side" | null {
  if (!exercise.isUnilateral) return null
  const legs = LEG_GROUPS.has(MUSCLE_TO_GROUP[exercise.primaryMuscle]) || exercise.movementPattern === "lunge" || exercise.movementPattern === "squat"
  return legs ? "leg" : "side"
}

export type ExerciseCategory =
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "legs"
  | "glutes"
  | "core"
  | "full_body"
  | "cardio"
  | "mobility"
  | "warmup"
  | "cooldown"
  | "stretching"

export type MovementPattern =
  | "horizontal_push"
  | "vertical_push"
  | "horizontal_pull"
  | "vertical_pull"
  | "squat"
  | "hinge"
  | "lunge"
  | "carry"
  | "rotation"
  | "anti_rotation"
  | "anti_extension"
  | "anti_lateral_flexion"
  | "trunk_flexion"
  | "hip_extension"
  /** Taking the leg out to the side (clamshells, lateral walks, abduction machine): glute medius work. */
  | "hip_abduction"
  | "knee_flexion"
  | "knee_extension"
  | "elbow_flexion"
  | "elbow_extension"
  | "shoulder_abduction"
  | "shoulder_flexion"
  | "calf_raise"
  | "conditioning"
  | "locomotion"
  | "mobility"
  | "stretch"

export type Equipment =
  | "barbell"
  | "dumbbell"
  | "kettlebell"
  | "cable"
  | "machine"
  | "smith_machine"
  | "bodyweight"
  | "band"
  | "pull_up_bar"
  | "bench"
  | "box"
  | "medicine_ball"
  | "foam_roller"
  | "cardio_machine"
  | "trap_bar"
  | "ez_bar"
  | "dip_station"
  | "landmine"
  | "suspension"
  | "ab_wheel"
  | "jump_rope"
  | "sled"
  /** A squat rack, power cage or squat stands with safeties: needed by every "needs_rack" lift. */
  | "rack"

export type Difficulty = "beginner" | "intermediate" | "advanced"

export type Goal =
  | "muscle_gain"
  | "strength"
  | "fat_loss"
  | "general_fitness"
  | "endurance"

export type Mechanics = "compound" | "isolation"

export type ForceType = "push" | "pull" | "static" | "other"

/**
 * How the exercise is loaded and therefore how a set is logged.
 * - external: weight + reps (barbell, dumbbell, machine, cable)
 * - bodyweight: reps only, optional added weight
 * - assisted: reps, optional assistance weight
 * - timed: seconds (planks, carries, cardio intervals)
 * - distance: metres or minutes (steady cardio)
 */
export type LoadType = "external" | "bodyweight" | "assisted" | "timed" | "distance"

/** Body areas a user can flag as a limitation. Exercises list the areas they stress. */
export type BodyArea =
  | "shoulder"
  | "elbow"
  | "wrist"
  | "lower_back"
  | "hip"
  | "knee"
  | "ankle"
  | "neck"

export interface Exercise {
  /** Stable kebab-case id, e.g. "barbell-bench-press". Never changes once shipped. */
  id: string
  name: string
  /** URL slug; identical to id. */
  slug: string
  category: ExerciseCategory
  primaryMuscle: Muscle
  secondaryMuscles: Muscle[]
  movementPattern: MovementPattern
  mechanics: Mechanics
  force: ForceType
  /** Every piece of equipment required. Bodyweight-only exercises list ["bodyweight"]. */
  equipment: Equipment[]
  difficulty: Difficulty
  goalCompatibility: Goal[]
  genderNeutral: boolean
  /** Step-by-step setup and execution. 3 to 6 short steps. */
  instructions: string[]
  /** 2 to 4 short cues a coach would say mid-set. */
  coachTips: string[]
  /** 2 to 4 common mistakes, each one sentence. */
  commonMistakes: string[]
  /** Sensible default set range for a main-workout slot, e.g. [3, 4]. */
  setsRange: [number, number]
  /** Default rep range, e.g. [8, 12]. Omit only for timed/distance exercises. */
  repRange?: [number, number]
  /** Seconds per set for timed exercises, e.g. [30, 60]. Minutes * 60 for cardio blocks. */
  durationRange?: [number, number]
  /** Rest between sets in seconds, e.g. [60, 90]. */
  restRange: [number, number]
  /** Eccentric-pause-concentric-pause, e.g. "3-1-1-0". Omit when not meaningful. */
  tempo?: string
  /** True for heavy compounds that need ramp-up sets before working sets. */
  warmupRequired: boolean
  loadType: LoadType
  isUnilateral?: boolean
  /**
   * Typical seconds per rep (per side for unilateral work) when a rep takes clearly longer than a
   * plain lift: complexes (man maker) and skill lifts (Turkish get-up). Omit to use the default.
   */
  secondsPerRep?: number
  /** Body areas this exercise stresses; used to exclude exercises for flagged limitations. */
  contraindications: BodyArea[]
  videoUrl?: string
  imageUrl?: string
  /** Ids of good substitutes, best first. May reference exercises in other category files. */
  alternativeExercises: string[]
  /** Optional parent exercise id (e.g. "incline-dumbbell-press" is a variation of "dumbbell-bench-press"). */
  variationOf?: string
  /**
   * Free-form tags. Tags the engine reads: "olympic" and "skill" (technique-limited lifts: no
   * body-weight starting load, reps never inflated past the lift's range), "complex" (multi-move
   * reps: reps never inflated), "overhead" (the load finishes overhead, e.g. thrusters: starting
   * loads follow the press). "skill", "overhead", "olympic" and "complex" lifts are never
   * prescribed closer than 3 reps in reserve.
   * "explosive" (jumps, throws, ballistic lifts): no RIR target (null); never progressed by adding
   * reps; ordered before the day's other main work. A bodyweight, non-conditioning explosive lift
   * is a plyometric primer: 3 × 3–5 with at least 90 s rest, and in strength and hypertrophy blocks
   * it only fills the primary slot (never a loaded accessory slot after the heavy lifts).
   * "beginner_friendly": a regression beginners start on before its variationOf parent.
   * "big_lift": a strength block's main barbell lifts.
   *
   * Data tags that mark a property for engine rules (library.test.ts keeps them consistent):
   * - "single_implement": a bilateral lift holding ONE dumbbell in both hands (goblet squat): its
   *   starting load is twice the per-hand figure.
   * - "needs_rack": a barbell lift that is unracked from a rack or stands. The engine only offers
   *   it when the user's equipment includes "rack" (full_gym and home_gym presets do).
   * - "needs_adjustable_bench" (a bench set to an incline or decline: incline presses,
   *   chest-supported rows), "needs_elevated_bench" (a bench raised high enough to row a bar under
   *   it: the seal row) and "needs_battle_rope": kit the Equipment list cannot name yet. A flat
   *   bench or a cardio machine does not satisfy them; until onboarding asks, only the full_gym
   *   preset does (lib/engine/selection.ts kitTagsAllowed).
   * - "ballistic": a momentum-driven warm-up drill (arm, leg and torso swings). It lists the joint
   *   it swings as a contraindication; a controlled drill is preferred for a flagged area.
   * - "sprint" / "agility": all-out running or change-of-direction conditioning.
   * - "inversion": the body is upside down (handstand work).
   * - "corrective": a targeted corrective drill kept out of the automatic warm-up and cool-down.
   * - "program_only": a step written for an assigned, coach-approved program (lib/programs: sprint
   *   drills, box pistols, handstand and L-sit steps). The engine never generates it or offers it
   *   as a swap in a generated workout; program workouts use it and swap between its steps.
   * - "<area>_friendly" (e.g. "lower_back_friendly"): a variation built to spare a BodyArea its
   *   variationOf parent lists, so it deliberately does not inherit that contraindication.
   *
   * Core-category data tags (core programming spec; library.test.ts keeps them consistent):
   * - "hip_flexor_led": trunk work where the hip flexors carry much of the load (leg raises,
   *   sit-ups, flutter kicks, knee tucks, Russian twists, the L-sit, mountain climbers). Core slots
   *   down-weight these for beginners, hip-flagged users and trained strength and hypertrophy
   *   lifters who have a loadable option (hanging work excepted).
   * - "hanging": trunk work done hanging from a bar or supported on dip bars or a captain's chair.
   *   It loads the grip and the shoulders, so it is kept away from heavy-hinge, pull-heavy and
   *   pressing days.
   * - "lateral_flexion": dynamic side bending (the dumbbell side bend). Filed as trunk_flexion, not
   *   anti_lateral_flexion, so it never counts as anti-lateral work.
   * - "conditioning" on a core exercise (the mountain climber): done fast it is conditioning, so it
   *   never fills a core slot or counts toward core volume, and it may be a finisher.
   */
  tags?: string[]
}

export const ALL_MUSCLE_GROUPS: MuscleGroup[] = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "core",
  "full_body",
  "cardio",
]

export const MUSCLE_LABELS: Record<Muscle, string> = {
  chest: "Chest",
  upper_chest: "Upper chest",
  front_delts: "Front delts",
  side_delts: "Side delts",
  rear_delts: "Rear delts",
  lats: "Lats",
  upper_back: "Upper back",
  traps: "Traps",
  lower_back: "Lower back",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  adductors: "Adductors",
  abductors: "Abductors",
  hip_flexors: "Hip flexors",
  abs: "Abs",
  obliques: "Obliques",
  neck: "Neck",
  full_body: "Full body",
  cardiovascular: "Cardio",
}

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  core: "Core",
  full_body: "Full body",
  cardio: "Cardio",
}

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: "Barbell",
  dumbbell: "Dumbbells",
  kettlebell: "Kettlebell",
  cable: "Cable",
  machine: "Machine",
  smith_machine: "Smith machine",
  bodyweight: "Bodyweight",
  band: "Band",
  pull_up_bar: "Pull-up bar",
  bench: "Bench",
  box: "Box",
  medicine_ball: "Medicine ball",
  foam_roller: "Foam roller",
  cardio_machine: "Cardio machine",
  trap_bar: "Trap bar",
  ez_bar: "EZ bar",
  dip_station: "Dip station",
  landmine: "Landmine",
  suspension: "Suspension trainer",
  ab_wheel: "Ab wheel",
  jump_rope: "Jump rope",
  sled: "Sled",
  rack: "Squat rack",
}

export const MOVEMENT_PATTERN_LABELS: Record<MovementPattern, string> = {
  horizontal_push: "Horizontal push",
  vertical_push: "Vertical push",
  horizontal_pull: "Horizontal pull",
  vertical_pull: "Vertical pull",
  squat: "Squat",
  hinge: "Hinge",
  lunge: "Lunge",
  carry: "Carry",
  rotation: "Rotation",
  anti_rotation: "Anti-rotation",
  anti_extension: "Anti-extension",
  anti_lateral_flexion: "Anti-lateral flexion",
  trunk_flexion: "Trunk flexion",
  hip_extension: "Hip extension",
  hip_abduction: "Hip abduction",
  knee_flexion: "Knee flexion",
  knee_extension: "Knee extension",
  elbow_flexion: "Elbow flexion",
  elbow_extension: "Elbow extension",
  shoulder_abduction: "Shoulder abduction",
  shoulder_flexion: "Shoulder flexion",
  calf_raise: "Calf raise",
  conditioning: "Conditioning",
  locomotion: "Locomotion",
  mobility: "Mobility",
  stretch: "Stretch",
}

export const CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  legs: "Legs",
  glutes: "Glutes",
  core: "Core",
  full_body: "Full body",
  cardio: "Cardio",
  mobility: "Mobility",
  warmup: "Warm-up",
  cooldown: "Cool-down",
  stretching: "Stretching",
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
}

export const DIFFICULTY_RANK: Record<Difficulty, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
}

export const GOAL_LABELS: Record<Goal, string> = {
  muscle_gain: "Muscle gain",
  strength: "Strength",
  fat_loss: "Fat loss",
  general_fitness: "General fitness",
  endurance: "Endurance",
}
