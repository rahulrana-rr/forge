import type { BodyArea, Equipment, Goal } from "@/lib/exercises/types"
import { EQUIPMENT_LABELS } from "@/lib/exercises/types"
import type { DurationPreference, EquipmentPreset, Experience, Gender, TrainingDays } from "@/lib/domain/types"

export interface Option<T extends string | number> {
  value: T
  label: string
  hint?: string
}

export const GOAL_OPTIONS: Option<Goal>[] = [
  { value: "muscle_gain", label: "Build muscle", hint: "6–15 reps, moderate rest, more volume." },
  { value: "strength", label: "Get stronger", hint: "Heavy compounds, 3–6 reps, long rest." },
  { value: "fat_loss", label: "Lose fat", hint: "Higher reps, short rest, a finisher." },
  { value: "general_fitness", label: "General fitness", hint: "Balanced sessions you can keep up." },
  { value: "endurance", label: "Endurance", hint: "15–25 reps, short rest, keep moving." },
]

export const EXPERIENCE_OPTIONS: Option<Experience>[] = [
  { value: "beginner", label: "New to lifting", hint: "Under a year of consistent training." },
  { value: "intermediate", label: "Intermediate", hint: "1–3 years. You know the main lifts." },
  { value: "advanced", label: "Advanced", hint: "3+ years. You train close to failure." },
]

export const GENDER_OPTIONS: Option<Gender>[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "unspecified", label: "Prefer not to say" },
]

export const DAYS_OPTIONS: Option<TrainingDays>[] = [
  { value: 2, label: "2", hint: "Full body A/B" },
  { value: 3, label: "3", hint: "Full body or push/pull/legs" },
  { value: 4, label: "4", hint: "Upper/lower, twice" },
  { value: 5, label: "5", hint: "Push/pull/legs + upper/lower" },
  { value: 6, label: "6", hint: "Push/pull/legs, twice" },
]

export const EQUIPMENT_PRESET_OPTIONS: Option<EquipmentPreset>[] = [
  { value: "full_gym", label: "Full gym", hint: "Barbells, machines, cables, the lot." },
  { value: "dumbbells", label: "Dumbbells only", hint: "A pair of dumbbells and a bench." },
  { value: "home_gym", label: "Home gym", hint: "Barbell and rack, dumbbells, bands, pull-up bar." },
  { value: "bodyweight", label: "Bodyweight", hint: "No equipment. A bar helps." },
  { value: "custom", label: "Pick my own", hint: "Choose exactly what you have." },
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

export const DURATION_OPTIONS: Option<DurationPreference>[] = [
  { value: 30, label: "30" },
  { value: 45, label: "45" },
  { value: 60, label: "60" },
  { value: 75, label: "75" },
]
