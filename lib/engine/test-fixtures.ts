/**
 * Small in-file exercise library and profile builders for engine unit tests.
 * Not shipped: only imported from *.test.ts files.
 */
import type { Exercise, Equipment, Goal, Muscle, MovementPattern, Mechanics, Difficulty, ExerciseCategory, LoadType } from "@/lib/exercises/types"
import type { CompletedWorkout, ExerciseProgress, UserProfile, TrainingDays, DurationPreference, EquipmentPreset } from "@/lib/domain/types"
import { EQUIPMENT_PRESETS } from "@/lib/domain/types"
import { loadStep } from "@/lib/units"
import { loadKindOf } from "./progression"
import { isSingleImplementLift, KETTLEBELL_STEP } from "./starting-load"
import { FEEDER_SET_NOTE, needsFeederSet, needsRampUp, RAMP_UP_NOTE } from "./duration"
import type { EngineInput, Workout, WorkoutExercise } from "./types"

interface Spec {
  id: string
  category: ExerciseCategory
  primary: Muscle
  secondary?: Muscle[]
  pattern: MovementPattern
  mechanics?: Mechanics
  equipment: Equipment[]
  difficulty?: Difficulty
  loadType?: LoadType
  reps?: [number, number]
  duration?: [number, number]
  sets?: [number, number]
  rest?: [number, number]
  warmupRequired?: boolean
  unilateral?: boolean
  contraindications?: Exercise["contraindications"]
  tags?: string[]
  goals?: Goal[]
  force?: Exercise["force"]
}

const ALL_GOALS: Goal[] = ["muscle_gain", "strength", "fat_loss", "general_fitness", "endurance"]

export function makeExercise(spec: Spec): Exercise {
  const timed = spec.loadType === "timed" || spec.loadType === "distance"
  return {
    id: spec.id,
    name: spec.id.replace(/-/g, " "),
    slug: spec.id,
    category: spec.category,
    primaryMuscle: spec.primary,
    secondaryMuscles: spec.secondary ?? [],
    movementPattern: spec.pattern,
    mechanics: spec.mechanics ?? "compound",
    force: spec.force ?? "push",
    equipment: spec.equipment,
    difficulty: spec.difficulty ?? "beginner",
    goalCompatibility: spec.goals ?? ALL_GOALS,
    genderNeutral: true,
    instructions: ["Set up.", "Move.", "Reset."],
    coachTips: ["Brace.", "Breathe."],
    commonMistakes: ["Rushing.", "Shortening the range."],
    setsRange: spec.sets ?? [3, 4],
    repRange: timed ? undefined : (spec.reps ?? [8, 12]),
    durationRange: spec.duration,
    restRange: spec.rest ?? [60, 90],
    warmupRequired: spec.warmupRequired ?? false,
    loadType: spec.loadType ?? "external",
    isUnilateral: spec.unilateral,
    contraindications: spec.contraindications ?? [],
    alternativeExercises: [],
    tags: spec.tags,
  }
}

/** A compact library covering every slot kind the templates ask for. */
export const FIXTURE_LIBRARY: Exercise[] = [
  // chest
  makeExercise({ id: "barbell-bench-press", category: "chest", primary: "chest", secondary: ["triceps", "front_delts"], pattern: "horizontal_push", equipment: ["barbell", "bench"], difficulty: "intermediate", reps: [4, 10], rest: [120, 180], warmupRequired: true, contraindications: ["shoulder"] }),
  makeExercise({ id: "dumbbell-bench-press", category: "chest", primary: "chest", secondary: ["triceps", "front_delts"], pattern: "horizontal_push", equipment: ["dumbbell", "bench"], reps: [6, 15], rest: [90, 120], contraindications: ["shoulder"] }),
  makeExercise({ id: "incline-dumbbell-press", category: "chest", primary: "upper_chest", secondary: ["triceps", "front_delts"], pattern: "horizontal_push", equipment: ["dumbbell", "bench"], reps: [8, 15], contraindications: ["shoulder"] }),
  makeExercise({ id: "machine-chest-press", category: "chest", primary: "chest", secondary: ["triceps"], pattern: "horizontal_push", equipment: ["machine"], reps: [8, 15] }),
  makeExercise({ id: "push-up", category: "chest", primary: "chest", secondary: ["triceps", "front_delts", "abs"], pattern: "horizontal_push", equipment: ["bodyweight"], loadType: "bodyweight", reps: [8, 20], contraindications: ["wrist"] }),
  makeExercise({ id: "cable-fly", category: "chest", primary: "chest", pattern: "horizontal_push", mechanics: "isolation", equipment: ["cable"], reps: [10, 15], rest: [45, 75] }),
  // shoulders
  makeExercise({ id: "overhead-press", category: "shoulders", primary: "front_delts", secondary: ["triceps", "upper_chest"], pattern: "vertical_push", equipment: ["barbell"], difficulty: "intermediate", reps: [4, 10], rest: [120, 180], warmupRequired: true, contraindications: ["shoulder"] }),
  makeExercise({ id: "seated-dumbbell-shoulder-press", category: "shoulders", primary: "front_delts", secondary: ["triceps", "side_delts"], pattern: "vertical_push", equipment: ["dumbbell", "bench"], reps: [6, 15], contraindications: ["shoulder"] }),
  makeExercise({ id: "pike-push-up", category: "shoulders", primary: "front_delts", secondary: ["triceps"], pattern: "vertical_push", equipment: ["bodyweight"], loadType: "bodyweight", reps: [6, 15], contraindications: ["shoulder", "wrist"] }),
  makeExercise({ id: "dumbbell-lateral-raise", category: "shoulders", primary: "side_delts", pattern: "shoulder_abduction", mechanics: "isolation", equipment: ["dumbbell"], reps: [10, 20], rest: [45, 60] }),
  makeExercise({ id: "band-lateral-raise", category: "shoulders", primary: "side_delts", pattern: "shoulder_abduction", mechanics: "isolation", equipment: ["band"], reps: [12, 20], rest: [30, 60] }),
  makeExercise({ id: "face-pull", category: "shoulders", primary: "rear_delts", secondary: ["upper_back"], pattern: "horizontal_pull", mechanics: "isolation", equipment: ["cable"], reps: [12, 20], rest: [45, 60], force: "pull" }),
  // back
  makeExercise({ id: "pull-up", category: "back", primary: "lats", secondary: ["biceps", "upper_back"], pattern: "vertical_pull", equipment: ["pull_up_bar"], difficulty: "intermediate", loadType: "bodyweight", reps: [4, 12], rest: [90, 150], force: "pull", contraindications: ["elbow", "shoulder"] }),
  makeExercise({ id: "lat-pulldown", category: "back", primary: "lats", secondary: ["biceps"], pattern: "vertical_pull", equipment: ["cable"], reps: [8, 15], force: "pull" }),
  makeExercise({ id: "bent-over-barbell-row", category: "back", primary: "upper_back", secondary: ["lats", "biceps", "lower_back"], pattern: "horizontal_pull", equipment: ["barbell"], difficulty: "intermediate", reps: [5, 10], rest: [90, 150], warmupRequired: true, force: "pull", contraindications: ["lower_back"] }),
  makeExercise({ id: "single-arm-dumbbell-row", category: "back", primary: "lats", secondary: ["biceps", "upper_back"], pattern: "horizontal_pull", equipment: ["dumbbell", "bench"], reps: [8, 15], unilateral: true, force: "pull" }),
  makeExercise({ id: "seated-cable-row", category: "back", primary: "upper_back", secondary: ["lats", "biceps"], pattern: "horizontal_pull", equipment: ["cable"], reps: [8, 15], force: "pull" }),
  makeExercise({ id: "inverted-row", category: "back", primary: "upper_back", secondary: ["biceps", "lats"], pattern: "horizontal_pull", equipment: ["bodyweight"], loadType: "bodyweight", reps: [6, 15], force: "pull" }),
  // arms
  makeExercise({ id: "dumbbell-curl", category: "biceps", primary: "biceps", secondary: ["forearms"], pattern: "elbow_flexion", mechanics: "isolation", equipment: ["dumbbell"], reps: [8, 15], rest: [45, 75], force: "pull" }),
  makeExercise({ id: "band-curl", category: "biceps", primary: "biceps", pattern: "elbow_flexion", mechanics: "isolation", equipment: ["band"], reps: [12, 20], rest: [30, 60], force: "pull" }),
  makeExercise({ id: "cable-triceps-pushdown", category: "triceps", primary: "triceps", pattern: "elbow_extension", mechanics: "isolation", equipment: ["cable"], reps: [10, 15], rest: [45, 75] }),
  makeExercise({ id: "bench-dip", category: "triceps", primary: "triceps", secondary: ["chest"], pattern: "elbow_extension", equipment: ["bodyweight", "bench"], loadType: "bodyweight", reps: [8, 15], contraindications: ["shoulder"] }),
  makeExercise({ id: "diamond-push-up", category: "triceps", primary: "triceps", secondary: ["chest"], pattern: "horizontal_push", equipment: ["bodyweight"], loadType: "bodyweight", reps: [6, 15], contraindications: ["wrist"] }),
  // legs
  makeExercise({ id: "barbell-back-squat", category: "legs", primary: "quads", secondary: ["glutes", "hamstrings", "lower_back"], pattern: "squat", equipment: ["barbell"], difficulty: "intermediate", reps: [3, 10], rest: [120, 240], warmupRequired: true, contraindications: ["knee", "lower_back"] }),
  makeExercise({ id: "goblet-squat", category: "legs", primary: "quads", secondary: ["glutes"], pattern: "squat", equipment: ["dumbbell"], reps: [8, 15], contraindications: ["knee"] }),
  makeExercise({ id: "bodyweight-squat", category: "legs", primary: "quads", secondary: ["glutes"], pattern: "squat", equipment: ["bodyweight"], loadType: "bodyweight", reps: [10, 25] }),
  makeExercise({ id: "leg-press", category: "legs", primary: "quads", secondary: ["glutes"], pattern: "squat", equipment: ["machine"], reps: [8, 15], contraindications: ["knee"] }),
  makeExercise({ id: "bulgarian-split-squat", category: "legs", primary: "quads", secondary: ["glutes"], pattern: "lunge", equipment: ["dumbbell", "bench"], difficulty: "intermediate", reps: [8, 12], unilateral: true, contraindications: ["knee"] }),
  makeExercise({ id: "reverse-lunge", category: "legs", primary: "quads", secondary: ["glutes"], pattern: "lunge", equipment: ["bodyweight"], loadType: "bodyweight", reps: [8, 15], unilateral: true, contraindications: ["knee"] }),
  makeExercise({ id: "romanian-deadlift", category: "legs", primary: "hamstrings", secondary: ["glutes", "lower_back"], pattern: "hinge", equipment: ["barbell"], difficulty: "intermediate", reps: [6, 12], rest: [90, 150], warmupRequired: true, force: "pull", contraindications: ["lower_back"] }),
  makeExercise({ id: "dumbbell-romanian-deadlift", category: "legs", primary: "hamstrings", secondary: ["glutes"], pattern: "hinge", equipment: ["dumbbell"], reps: [8, 15], force: "pull", contraindications: ["lower_back"] }),
  makeExercise({ id: "conventional-deadlift", category: "legs", primary: "hamstrings", secondary: ["glutes", "lower_back", "upper_back"], pattern: "hinge", equipment: ["barbell"], difficulty: "advanced", reps: [1, 6], rest: [180, 240], warmupRequired: true, force: "pull", contraindications: ["lower_back"] }),
  makeExercise({ id: "lying-leg-curl", category: "legs", primary: "hamstrings", pattern: "knee_flexion", mechanics: "isolation", equipment: ["machine"], reps: [8, 15], rest: [45, 75], force: "pull" }),
  makeExercise({ id: "leg-extension", category: "legs", primary: "quads", pattern: "knee_extension", mechanics: "isolation", equipment: ["machine"], reps: [10, 15], rest: [45, 75], contraindications: ["knee"] }),
  makeExercise({ id: "standing-calf-raise", category: "legs", primary: "calves", pattern: "calf_raise", mechanics: "isolation", equipment: ["bodyweight"], loadType: "bodyweight", reps: [12, 25], rest: [30, 60] }),
  // glutes
  makeExercise({ id: "barbell-hip-thrust", category: "glutes", primary: "glutes", secondary: ["hamstrings"], pattern: "hip_extension", equipment: ["barbell", "bench"], difficulty: "intermediate", reps: [6, 12], rest: [90, 120] }),
  makeExercise({ id: "glute-bridge", category: "glutes", primary: "glutes", secondary: ["hamstrings"], pattern: "hip_extension", equipment: ["bodyweight"], loadType: "bodyweight", reps: [12, 20], rest: [30, 60] }),
  makeExercise({ id: "single-leg-glute-bridge", category: "glutes", primary: "glutes", secondary: ["hamstrings"], pattern: "hip_extension", equipment: ["bodyweight"], loadType: "bodyweight", reps: [8, 15], unilateral: true, rest: [30, 60] }),
  // core
  makeExercise({ id: "plank", category: "core", primary: "abs", secondary: ["obliques"], pattern: "anti_extension", mechanics: "isolation", equipment: ["bodyweight"], loadType: "timed", duration: [30, 60], rest: [30, 60], force: "static" }),
  makeExercise({ id: "dead-bug", category: "core", primary: "abs", pattern: "anti_extension", mechanics: "isolation", equipment: ["bodyweight"], loadType: "bodyweight", reps: [8, 12], rest: [30, 60], force: "static" }),
  makeExercise({ id: "hanging-leg-raise", category: "core", primary: "abs", secondary: ["hip_flexors"], pattern: "trunk_flexion", mechanics: "isolation", equipment: ["pull_up_bar"], difficulty: "intermediate", loadType: "bodyweight", reps: [8, 15], rest: [45, 60], force: "pull" }),
  makeExercise({ id: "pallof-press", category: "core", primary: "obliques", secondary: ["abs"], pattern: "anti_rotation", mechanics: "isolation", equipment: ["cable"], reps: [10, 15], rest: [30, 60], unilateral: true, force: "static" }),
  // full body / cardio
  makeExercise({ id: "kettlebell-swing", category: "full_body", primary: "glutes", secondary: ["hamstrings", "lower_back"], pattern: "hinge", equipment: ["kettlebell"], difficulty: "intermediate", reps: [10, 20], rest: [45, 90], force: "pull", contraindications: ["lower_back"] }),
  makeExercise({ id: "farmers-carry", category: "full_body", primary: "forearms", secondary: ["traps", "abs"], pattern: "carry", equipment: ["dumbbell"], loadType: "timed", duration: [30, 60], rest: [60, 90], force: "static" }),
  makeExercise({ id: "burpee", category: "cardio", primary: "full_body", secondary: ["chest", "quads"], pattern: "conditioning", equipment: ["bodyweight"], loadType: "timed", duration: [30, 60], rest: [30, 60], sets: [3, 5], contraindications: ["wrist", "knee"] }),
  makeExercise({ id: "rowing-machine", category: "cardio", primary: "cardiovascular", secondary: ["lats", "quads"], pattern: "conditioning", equipment: ["cardio_machine"], loadType: "timed", duration: [60, 240], rest: [30, 60], sets: [3, 5], force: "pull" }),
  makeExercise({ id: "jump-rope", category: "cardio", primary: "cardiovascular", secondary: ["calves"], pattern: "conditioning", equipment: ["jump_rope"], loadType: "timed", duration: [45, 120], rest: [30, 60], sets: [3, 5], contraindications: ["ankle"] }),
  makeExercise({ id: "mountain-climber", category: "cardio", primary: "cardiovascular", secondary: ["abs"], pattern: "conditioning", equipment: ["bodyweight"], loadType: "timed", duration: [30, 45], rest: [30, 45], sets: [3, 4], contraindications: ["wrist"] }),
  // warm-ups
  makeExercise({ id: "warmup-jumping-jacks", category: "warmup", primary: "cardiovascular", pattern: "locomotion", equipment: ["bodyweight"], loadType: "timed", duration: [120, 240], rest: [0, 15], sets: [1, 1], tags: ["for:full_body"], contraindications: ["ankle"] }),
  makeExercise({ id: "warmup-bike", category: "warmup", primary: "cardiovascular", pattern: "locomotion", equipment: ["cardio_machine"], loadType: "timed", duration: [180, 300], rest: [0, 15], sets: [1, 1], tags: ["for:quads", "for:full_body"] }),
  makeExercise({ id: "warmup-jump-rope", category: "warmup", primary: "cardiovascular", pattern: "conditioning", equipment: ["jump_rope"], loadType: "timed", duration: [120, 180], rest: [0, 15], sets: [1, 1], tags: ["for:full_body", "for:calves"], contraindications: ["ankle"] }),
  makeExercise({ id: "arm-circles", category: "warmup", primary: "side_delts", pattern: "mobility", mechanics: "isolation", equipment: ["bodyweight"], loadType: "bodyweight", reps: [10, 15], rest: [0, 15], sets: [1, 1], tags: ["for:shoulders", "for:chest"] }),
  makeExercise({ id: "band-pull-apart", category: "warmup", primary: "rear_delts", pattern: "horizontal_pull", mechanics: "isolation", equipment: ["band"], loadType: "bodyweight", reps: [12, 20], rest: [0, 15], sets: [1, 1], tags: ["for:shoulders", "for:back"], force: "pull" }),
  makeExercise({ id: "scapular-push-up", category: "warmup", primary: "chest", pattern: "mobility", equipment: ["bodyweight"], loadType: "bodyweight", reps: [8, 12], rest: [0, 15], sets: [1, 1], tags: ["for:chest", "for:shoulders"], contraindications: ["wrist"] }),
  makeExercise({ id: "leg-swing", category: "warmup", primary: "hip_flexors", pattern: "mobility", equipment: ["bodyweight"], loadType: "bodyweight", reps: [10, 15], rest: [0, 15], sets: [1, 1], tags: ["for:quads", "for:hamstrings", "for:glutes"], unilateral: true }),
  makeExercise({ id: "hip-circle", category: "mobility", primary: "glutes", pattern: "mobility", equipment: ["bodyweight"], loadType: "bodyweight", reps: [8, 12], rest: [0, 15], sets: [1, 1], tags: ["for:glutes", "for:quads"] }),
  makeExercise({ id: "cat-cow", category: "mobility", primary: "lower_back", pattern: "mobility", equipment: ["bodyweight"], loadType: "bodyweight", reps: [8, 12], rest: [0, 15], sets: [1, 1], tags: ["for:core", "for:full_body", "for:back"] }),
  makeExercise({ id: "thoracic-rotation", category: "mobility", primary: "upper_back", pattern: "rotation", equipment: ["bodyweight"], loadType: "bodyweight", reps: [8, 12], rest: [0, 15], sets: [1, 1], tags: ["for:back", "for:core"] }),
  // cool-downs
  makeExercise({ id: "chest-doorway-stretch", category: "stretching", primary: "chest", pattern: "stretch", mechanics: "isolation", equipment: ["bodyweight"], loadType: "timed", duration: [30, 60], rest: [0, 10], sets: [1, 1], tags: ["for:chest", "for:shoulders"], force: "static" }),
  makeExercise({ id: "lat-stretch", category: "stretching", primary: "lats", pattern: "stretch", mechanics: "isolation", equipment: ["bodyweight"], loadType: "timed", duration: [30, 60], rest: [0, 10], sets: [1, 1], tags: ["for:back"], force: "static" }),
  makeExercise({ id: "quad-stretch", category: "stretching", primary: "quads", pattern: "stretch", mechanics: "isolation", equipment: ["bodyweight"], loadType: "timed", duration: [30, 60], rest: [0, 10], sets: [1, 1], tags: ["for:quads"], unilateral: true, force: "static" }),
  makeExercise({ id: "hamstring-stretch", category: "stretching", primary: "hamstrings", pattern: "stretch", mechanics: "isolation", equipment: ["bodyweight"], loadType: "timed", duration: [30, 60], rest: [0, 10], sets: [1, 1], tags: ["for:hamstrings", "for:glutes"], force: "static" }),
  makeExercise({ id: "triceps-stretch", category: "stretching", primary: "triceps", pattern: "stretch", mechanics: "isolation", equipment: ["bodyweight"], loadType: "timed", duration: [20, 40], rest: [0, 10], sets: [1, 1], tags: ["for:triceps", "for:shoulders"], force: "static" }),
  makeExercise({ id: "childs-pose", category: "cooldown", primary: "lower_back", pattern: "stretch", mechanics: "isolation", equipment: ["bodyweight"], loadType: "timed", duration: [30, 60], rest: [0, 10], sets: [1, 1], tags: ["for:full_body", "for:back", "for:core"], force: "static" }),
  makeExercise({ id: "box-breathing", category: "cooldown", primary: "full_body", pattern: "stretch", mechanics: "isolation", equipment: ["bodyweight"], loadType: "timed", duration: [60, 120], rest: [0, 0], sets: [1, 1], tags: ["breathing", "for:full_body"], force: "static" }),
]

export const FIXTURE_BY_ID = new Map(FIXTURE_LIBRARY.map((e) => [e.id, e]))

export interface ProfileOverrides extends Partial<Omit<UserProfile, "trainingDaysPerWeek" | "durationPreferenceMinutes" | "equipmentPreset">> {
  trainingDaysPerWeek?: TrainingDays
  durationPreferenceMinutes?: DurationPreference
  equipmentPreset?: EquipmentPreset
}

export function makeProfile(overrides: ProfileOverrides = {}): UserProfile {
  const preset = overrides.equipmentPreset ?? "full_gym"
  const equipment = overrides.equipment ?? (preset === "custom" ? ["bodyweight"] : EQUIPMENT_PRESETS[preset])
  return {
    id: "profile-test",
    goal: "muscle_gain",
    gender: "unspecified",
    weightKg: 75,
    experience: "intermediate",
    trainingDaysPerWeek: 4,
    equipmentPreset: preset,
    equipment,
    durationPreferenceMinutes: 60,
    units: "kg",
    limitations: [],
    excludedExerciseIds: [],
    preferredExerciseIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

export function makeInput(profile: UserProfile, date = "2026-10-07", history: CompletedWorkout[] = [], progress: Record<string, ExerciseProgress> = {}, seed?: number): EngineInput {
  const input: EngineInput = { profile, history, progress, date, now: `${date}T07:00:00.000Z` }
  if (seed !== undefined) input.seed = seed
  return input
}

/**
 * Training days of a week for a plan of N days, as offsets from the week's first day (Monday):
 * the schedule a lifter on that plan keeps. Harnesses simulate sessions on these days instead of
 * every round(7 / N) days, which trained 5- and 6-day plans every day and 3-day plans every other
 * day (four sessions in some 7-day windows). Coach round 1, F21.
 */
export const WEEKLY_TRAINING_DAYS: Record<TrainingDays, readonly number[]> = {
  2: [0, 3], // Mon, Thu
  3: [0, 2, 4], // Mon, Wed, Fri
  4: [0, 1, 3, 4], // Mon, Tue, Thu, Fri
  5: [0, 1, 2, 3, 4], // Mon–Fri
  6: [0, 1, 2, 3, 4, 5], // six on, one off
}

/** Day offsets 0 … totalDays - 1 on which a plan of N days a week trains. */
export function trainingDayOffsets(days: TrainingDays, totalDays: number): number[] {
  const pattern = WEEKLY_TRAINING_DAYS[days]
  const out: number[] = []
  for (let day = 0; day < totalDays; day++) if (pattern.includes(day % 7)) out.push(day)
  return out
}

/** The load step (kg) a lifter can set up on this exercise: 2.5 kg plates, 2 kg dumbbells, 4 kg bells. */
function setupStepKg(exercise: Exercise): number {
  const kind = loadKindOf(exercise)
  return kind === "kettlebell" ? KETTLEBELL_STEP.kg : loadStep("kg", kind)
}

/**
 * The working load a simulated lifter settles on from a starting estimate: the estimate is a
 * deliberately light guess, so they log about 15% more, rounded to a load they can set up
 * (2.5 kg plates, 2 kg dumbbells, 4 kg bells), and always at least the next step above the
 * estimate. Coach round 2 (R24): rounding alone could land back on the estimate (6 kg × 1.15 =
 * 6.9 kg → 6 kg), so the sample lifter never calibrated a light dumbbell.
 */
export const CALIBRATED_LOAD_FACTOR = 1.15

export function calibratedLoadKg(estimateKg: number, exercise: Exercise): number {
  const step = setupStepKg(exercise)
  const rounded = Math.round((estimateKg * CALIBRATED_LOAD_FACTOR) / step) * step
  const nextStep = (Math.floor(estimateKg / step + 1e-9) + 1) * step
  return Math.round(Math.max(nextStep, rounded) * 100) / 100
}

/**
 * The load a simulated intermediate lifter picks on a card that shows none (machines, cables,
 * bands, landmines, patterns without a starting estimate), as a share of body weight for the whole
 * load (both hands, the stack, the bar): [compound, isolation]. Coaching judgment for the sample
 * harness, not reference data. Coach round 2, R24.
 */
export const NO_LOAD_SHARE: Record<MovementPattern, readonly [compound: number, isolation: number]> = {
  horizontal_push: [0.6, 0.25],
  vertical_push: [0.4, 0.15],
  horizontal_pull: [0.6, 0.2],
  vertical_pull: [0.6, 0.8], // isolation: shrugs
  squat: [1, 0.5],
  hinge: [0.8, 0.4],
  lunge: [0.4, 0.2],
  carry: [0.6, 0.3],
  rotation: [0.2, 0.1],
  anti_rotation: [0.3, 0.3], // held in both hands; halved as a unilateral lift (Pallof press)
  anti_extension: [0.15, 0.15],
  anti_lateral_flexion: [0.25, 0.25],
  trunk_flexion: [0.3, 0.3],
  hip_extension: [0.6, 0.2],
  hip_abduction: [0.3, 0.3], // abduction machine, cable ankle strap
  knee_flexion: [0.4, 0.4],
  knee_extension: [0.5, 0.5],
  elbow_flexion: [0.3, 0.25],
  elbow_extension: [0.4, 0.3],
  shoulder_abduction: [0.35, 0.12],
  shoulder_flexion: [0.2, 0.2],
  calf_raise: [0.6, 0.6],
  conditioning: [0.25, 0.25],
  locomotion: [0.25, 0.25],
  mobility: [0.1, 0.1],
  stretch: [0.1, 0.1],
}

/** Scales NO_LOAD_SHARE by training age (the same spread as the engine's starting estimates). */
export const NO_LOAD_EXPERIENCE: Record<Difficulty, number> = { beginner: 0.6, intermediate: 1, advanced: 1.25 }
/** A medicine ball is chosen by feel, not strength: about a tenth of body weight. */
const MEDICINE_BALL_SHARE = 0.1
/** Speed or technique, not strength, limits these: half the share. */
const SPEED_TAGS: readonly string[] = ["explosive", "ballistic", "olympic", "skill", "conditioning"]

/**
 * What the simulated lifter logs on a no-load card: NO_LOAD_SHARE × body weight × experience,
 * halved for speed lifts, for a band (its rated tension) and per hand (one dumbbell or bell in
 * each hand, or the one in the working hand), floored to a load they can set up, never below one
 * step. Rear-delt pulls (face pulls) load like isolation work. Deterministic.
 */
export function plausibleLoadKg(exercise: Exercise, lifter: Pick<UserProfile, "weightKg" | "experience">): number {
  const step = setupStepKg(exercise)
  const kind = loadKindOf(exercise)
  let share: number
  if (exercise.equipment.includes("medicine_ball")) share = MEDICINE_BALL_SHARE
  else {
    const isolation = exercise.mechanics !== "compound" || exercise.primaryMuscle === "rear_delts"
    share = NO_LOAD_SHARE[exercise.movementPattern][isolation ? 1 : 0]
    if (exercise.tags?.some((t) => SPEED_TAGS.includes(t))) share *= 0.5
    if (kind === "other" && exercise.equipment.includes("band")) share *= 0.5
    if (exercise.isUnilateral || ((kind === "dumbbell" || kind === "kettlebell") && !isSingleImplementLift(exercise))) share *= 0.5
  }
  const raw = share * lifter.weightKg * NO_LOAD_EXPERIENCE[lifter.experience]
  return Math.round(Math.max(step, Math.floor(raw / step + 1e-9) * step) * 100) / 100
}

export interface CompleteOptions {
  /**
   * What the simulated lifter logs on external-load main lifts.
   * - "fallback" (default): the card's load when it came from history; otherwise
   *   `fallbackWeightKg`, the same number for every lift (per hand or not).
   * - "calibrated": the card's load when it came from history; a starting estimate scaled by
   *   CALIBRATED_LOAD_FACTOR (calibratedLoadKg); on a card that showed no load, plausibleLoadKg
   *   for `lifter` (nothing without one). Every logged load then traces back to the engine's own
   *   numbers or the NO_LOAD_SHARE table (coach samples, F21, R24).
   * - "plausible": the same as "calibrated" (the name scripts/coach/core-audit.test.ts uses).
   */
  loads?: "fallback" | "calibrated" | "plausible"
  /**
   * "calibrated" only: the simulated lifter. With it, a no-load card (find your working weight) is
   * logged at plausibleLoadKg with weightSource "user", so machine, cable and band lifts build
   * history and their next card shows a load (coach round 2, R24).
   */
  lifter?: Pick<UserProfile, "weightKg" | "experience">
}

function loggedLoadKg(e: WorkoutExercise, ex: Exercise, fallbackWeightKg: number, options: CompleteOptions): number | null {
  if ((options.loads ?? "fallback") === "fallback") return e.weightSource === "estimate" ? fallbackWeightKg : (e.recommendedWeightKg ?? fallbackWeightKg)
  if (e.recommendedWeightKg == null) return options.lifter ? plausibleLoadKg(ex, options.lifter) : null
  return e.weightSource === "estimate" ? calibratedLoadKg(e.recommendedWeightKg, ex) : e.recommendedWeightKg
}

/** Turn a generated workout into a completed one with every set done at the top of its range. */
export function completeAtTop(
  workout: Workout,
  lookup: (id: string) => Exercise | undefined,
  fallbackWeightKg = 40,
  options: CompleteOptions = {},
): CompletedWorkout {
  const exercises = workout.exercises.map((e) => {
    const ex = lookup(e.exerciseId)
    const external = ex?.loadType === "external"
    // A starting estimate is only a guess: the simulated lifter logs their real working weight.
    const weightKg = e.phase === "main" && external && ex ? loggedLoadKg(e, ex, fallbackWeightKg, options) : null
    const sets = Array.from({ length: e.sets }, (_, i) => ({
      setNumber: i + 1,
      weightKg,
      reps: e.reps ? e.reps[1] : null,
      durationSeconds: e.durationSeconds,
      completed: true,
    }))
    return {
      slotId: e.slotId,
      exerciseId: e.exerciseId,
      role: e.role,
      phase: e.phase,
      status: "completed" as const,
      sets,
      prescribedSets: e.sets,
      prescribedReps: e.reps,
      prescribedDurationSeconds: e.durationSeconds,
      recommendedWeightKg: e.recommendedWeightKg,
      // A load the lifter chose on a card that showed none (R24) is their own.
      weightSource: e.recommendedWeightKg == null && weightKg != null && options.loads !== undefined && options.loads !== "fallback" ? ("user" as const) : (e.weightSource ?? null),
      // As the workout store records them (coach round 2, R12): an earned tempo, a shortened rest
      // and a suggested harder variation carry into the next session.
      prescribedTempo: e.tempo ?? null,
      prescribedRestSeconds: e.restSeconds,
      suggestedExerciseId: e.suggestedExerciseId ?? null,
    }
  })
  return {
    id: `done-${workout.id}`,
    date: workout.date,
    title: workout.title,
    split: workout.split,
    focus: workout.focus,
    goal: workout.goal,
    startedAt: workout.generatedAt,
    completedAt: workout.generatedAt,
    durationSeconds: workout.estimatedMinutes * 60,
    exercises,
    totals: { exercisesCompleted: exercises.length, exercisesSkipped: 0, sets: 0, reps: 0, volumeKg: 0, caloriesEstimate: null },
    personalRecords: [],
    engineVersion: workout.engineVersion,
    synced: false,
  }
}

/** Build the progress map the history store would derive from completed workouts. */
export function progressFromHistory(history: CompletedWorkout[]): Record<string, ExerciseProgress> {
  const out: Record<string, ExerciseProgress> = {}
  for (const w of history.slice().sort((a, b) => (a.date < b.date ? 1 : -1))) {
    for (const e of w.exercises) {
      if (e.status !== "completed") continue
      const entry = out[e.exerciseId] ?? {
        exerciseId: e.exerciseId,
        bestWeightKg: null,
        bestReps: null,
        bestVolumeKg: null,
        bestE1rmKg: null,
        timesPerformed: 0,
        lastPerformedAt: null,
        recentSessions: [],
        updatedAt: w.completedAt,
      }
      entry.timesPerformed += 1
      entry.lastPerformedAt = entry.lastPerformedAt ?? w.completedAt
      if (entry.recentSessions.length < 5) entry.recentSessions.push({ workoutId: w.id, date: w.date, sets: e.sets })
      out[e.exerciseId] = entry
    }
  }
  return out
}

/**
 * The ramp-up rule a main slot's card note must follow (coach review F16, F02): the ramp-up or
 * feeder-set sentence is present exactly when the card's load needs lighter sets below it, and a
 * "find your working weight" note (which already builds up from light sets) may take its place.
 * Returns a description of the violation, or null.
 */
export function setupNoteViolation(e: WorkoutExercise, exercise: Exercise): string | null {
  const note = e.note ?? ""
  if (/Find your working weight/.test(note)) return null
  const ramp = needsRampUp(e.role, exercise, e.recommendedWeightKg)
  const feeder = needsFeederSet(e.role, exercise, e.recommendedWeightKg)
  if (ramp && !note.includes(RAMP_UP_NOTE)) return `missing ramp-up sentence at ${e.recommendedWeightKg} kg: "${note}"`
  if (!ramp && note.includes(RAMP_UP_NOTE)) return `ramp-up sentence at ${e.recommendedWeightKg} kg, too light for lighter sets`
  if (feeder && !note.includes(FEEDER_SET_NOTE)) return `missing feeder-set sentence at ${e.recommendedWeightKg} kg: "${note}"`
  return null
}
