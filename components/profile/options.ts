/** Labelled option lists for the Profile editors. Labels come from the exercise contract where one exists. */
import type {
  DurationPreference,
  EquipmentPreset,
  Experience,
  Gender,
  TrainingDays,
  Units,
} from "@/lib/domain/types"
import type { BodyArea, Equipment, Goal } from "@/lib/exercises/types"
import { DIFFICULTY_LABELS, EQUIPMENT_LABELS, GOAL_LABELS } from "@/lib/exercises/types"

export interface Option<T extends string | number> {
  value: T
  label: string
  hint?: string
}

export const GOAL_OPTIONS: Option<Goal>[] = [
  { value: "muscle_gain", label: GOAL_LABELS.muscle_gain, hint: "6–15 reps, moderate rest, more volume." },
  { value: "strength", label: GOAL_LABELS.strength, hint: "Heavy compounds, 3–6 reps, long rest." },
  { value: "fat_loss", label: GOAL_LABELS.fat_loss, hint: "Higher reps, short rest, a finisher." },
  { value: "general_fitness", label: GOAL_LABELS.general_fitness, hint: "Balanced sessions you can keep up." },
  { value: "endurance", label: GOAL_LABELS.endurance, hint: "15–25 reps, short rest, keep moving." },
]

export const EXPERIENCE_OPTIONS: Option<Experience>[] = [
  { value: "beginner", label: DIFFICULTY_LABELS.beginner, hint: "Under a year of consistent training." },
  { value: "intermediate", label: DIFFICULTY_LABELS.intermediate, hint: "1–3 years. You know the main lifts." },
  { value: "advanced", label: DIFFICULTY_LABELS.advanced, hint: "3+ years. You train close to failure." },
]

export const GENDER_LABELS: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  unspecified: "Prefer not to say",
}

export const GENDER_OPTIONS: Option<Gender>[] = (["male", "female", "unspecified"] as const).map((value) => ({
  value,
  label: GENDER_LABELS[value],
}))

export const DAYS_OPTIONS: Option<TrainingDays>[] = [
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "5" },
  { value: 6, label: "6" },
]

export const DAYS_HINTS: Record<TrainingDays, string> = {
  2: "Full body A/B",
  3: "Full body or push/pull/legs",
  4: "Upper/lower, twice",
  5: "Push/pull/legs + upper/lower",
  6: "Push/pull/legs, twice",
}

export const DURATION_OPTIONS: Option<DurationPreference>[] = [
  { value: 30, label: "30" },
  { value: 45, label: "45" },
  { value: 60, label: "60" },
  { value: 75, label: "75" },
]

export const PRESET_LABELS: Record<EquipmentPreset, string> = {
  full_gym: "Full gym",
  dumbbells: "Dumbbells only",
  home_gym: "Home gym",
  bodyweight: "Bodyweight",
  custom: "Custom",
}

export const PRESET_OPTIONS: Option<EquipmentPreset>[] = [
  { value: "full_gym", label: PRESET_LABELS.full_gym, hint: "Barbells, machines, cables, the lot." },
  { value: "dumbbells", label: PRESET_LABELS.dumbbells, hint: "A pair of dumbbells and a bench." },
  { value: "home_gym", label: PRESET_LABELS.home_gym, hint: "Barbell and rack, dumbbells, bands, pull-up bar." },
  { value: "bodyweight", label: PRESET_LABELS.bodyweight, hint: "No equipment. A bar helps." },
  { value: "custom", label: PRESET_LABELS.custom, hint: "Exactly what you have." },
]

const EQUIPMENT_ORDER: Equipment[] = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "cable",
  "machine",
  "smith_machine",
  "bench",
  "rack",
  "pull_up_bar",
  "dip_station",
  "band",
  "bodyweight",
  "trap_bar",
  "ez_bar",
  "landmine",
  "suspension",
  "box",
  "medicine_ball",
  "ab_wheel",
  "jump_rope",
  "cardio_machine",
  "sled",
  "foam_roller",
]

export const EQUIPMENT_OPTIONS: Option<Equipment>[] = EQUIPMENT_ORDER.map((value) => ({
  value,
  label: EQUIPMENT_LABELS[value],
}))

export const BODY_AREA_OPTIONS: Option<BodyArea>[] = [
  { value: "shoulder", label: "Shoulders" },
  { value: "elbow", label: "Elbows" },
  { value: "wrist", label: "Wrists" },
  { value: "lower_back", label: "Lower back" },
  { value: "hip", label: "Hips" },
  { value: "knee", label: "Knees" },
  { value: "ankle", label: "Ankles" },
  { value: "neck", label: "Neck" },
]

export const UNIT_OPTIONS: Option<Units>[] = [
  { value: "kg", label: "kg" },
  { value: "lb", label: "lb" },
]

export const WEIGHT_MIN_KG = 30
export const WEIGHT_MAX_KG = 300
