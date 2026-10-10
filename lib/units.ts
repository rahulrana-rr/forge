import type { Units } from "@/lib/domain/types"

const KG_PER_LB = 0.45359237

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB
}

/** Display a stored kg value in the user's units, rounded sensibly. */
export function formatWeight(kg: number | null | undefined, units: Units, withUnit = true): string {
  if (kg == null) return "—"
  const value = units === "kg" ? kg : kgToLb(kg)
  const rounded = Math.round(value * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return withUnit ? `${text} ${units}` : text
}

/** Convert a user-entered value in their units to stored kg. */
export function toKg(value: number, units: Units): number {
  return units === "kg" ? value : lbToKg(value)
}

/** Convert stored kg to the user's units (unrounded). */
export function fromKg(kg: number, units: Units): number {
  return units === "kg" ? kg : kgToLb(kg)
}

/** Equipment classes with their own load step. */
export type LoadStepKind = "barbell" | "dumbbell" | "kettlebell" | "machine" | "other"

/**
 * Smallest practical load step in the user's units for a given equipment class. Kettlebells come
 * in fixed sizes 4 kg / 5 lb apart (lib/engine/starting-load.ts KETTLEBELL_STEP).
 */
export function loadStep(units: Units, kind: LoadStepKind = "other"): number {
  if (kind === "kettlebell") return units === "kg" ? 4 : 5
  if (units === "kg") return kind === "barbell" ? 2.5 : kind === "dumbbell" ? 2 : 2.5
  return 5
}

/** Round a kg value to the nearest practical increment in the user's units, returning kg. */
export function roundToStep(kg: number, units: Units, kind: LoadStepKind = "other"): number {
  const step = loadStep(units, kind)
  const inUnits = fromKg(kg, units)
  const rounded = Math.round(inUnits / step) * step
  return toKg(rounded, units)
}
