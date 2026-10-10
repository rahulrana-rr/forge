import type { BodyArea, Equipment, Goal } from "@/lib/exercises/types"
import type {
  DurationPreference,
  EquipmentPreset,
  Experience,
  Gender,
  TrainingDays,
  Units,
} from "@/lib/domain/types"

export type OnboardingStepId = "goal" | "experience" | "gender" | "weight" | "days" | "equipment" | "protect"

/** The six required steps in order, followed by the optional "protect" step. */
export const ONBOARDING_STEPS: OnboardingStepId[] = [
  "goal",
  "experience",
  "gender",
  "weight",
  "days",
  "equipment",
  "protect",
]

/** What the user has picked so far. Everything is nullable until chosen. */
export interface OnboardingDraft {
  goal: Goal | null
  experience: Experience | null
  gender: Gender | null
  /** Raw text from the number input, in `units`. Converted to kg on finish. */
  weightInput: string
  units: Units
  trainingDaysPerWeek: TrainingDays | null
  equipmentPreset: EquipmentPreset | null
  /** Only used when equipmentPreset is "custom". */
  customEquipment: Equipment[]
  limitations: BodyArea[]
  durationPreferenceMinutes: DurationPreference
}

export const EMPTY_DRAFT: OnboardingDraft = {
  goal: null,
  experience: null,
  gender: null,
  weightInput: "",
  units: "kg",
  trainingDaysPerWeek: null,
  equipmentPreset: null,
  customEquipment: [],
  limitations: [],
  durationPreferenceMinutes: 45,
}

export const WEIGHT_MIN_KG = 30
export const WEIGHT_MAX_KG = 300
