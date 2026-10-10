"use client"

import { useId } from "react"

import type { Units } from "@/lib/domain/types"
import { fromKg, kgToLb, toKg } from "@/lib/units"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

import { RadioGroup } from "@/components/app/radio-group"
import { StepShell } from "@/components/onboarding/step-shell"
import { WEIGHT_MAX_KG, WEIGHT_MIN_KG } from "@/components/onboarding/types"

/**
 * Parses the raw input in the given units and returns kg, or null when not a usable number.
 * Rounds to 0.1 in the user's units before converting, so an entry of 150 lb round-trips as 150.
 */
export function parseWeightKg(input: string, units: Units): number | null {
  const n = Number.parseFloat(input.replace(",", "."))
  if (!Number.isFinite(n) || n <= 0) return null
  return toKg(Math.round(n * 10) / 10, units)
}

export function isWeightValid(kg: number | null): kg is number {
  return kg !== null && kg >= WEIGHT_MIN_KG && kg <= WEIGHT_MAX_KG
}

export function WeightStep({
  value,
  units,
  showError,
  onChange,
  onUnitsChange,
}: {
  value: string
  units: Units
  /** Only show validation once the user has tried to continue. */
  showError: boolean
  onChange: (v: string) => void
  onUnitsChange: (u: Units) => void
}) {
  const inputId = useId()
  const errorId = `${inputId}-error`
  const kg = parseWeightKg(value, units)
  const invalid = showError && !isWeightValid(kg)
  const minLb = Math.round(kgToLb(WEIGHT_MIN_KG))
  const maxLb = Math.round(kgToLb(WEIGHT_MAX_KG))

  function switchUnits(next: Units) {
    if (next === units) return
    haptic("tick")
    // Keep the number meaningful across the switch.
    if (kg !== null) {
      const converted = fromKg(kg, next)
      onChange(String(Math.round(converted * 10) / 10))
    }
    onUnitsChange(next)
  }

  return (
    <StepShell id="weight" title="How much do you weigh?" subtitle="Used for bodyweight loads and a rough calorie estimate.">
      <div className="flex flex-col gap-4">
        <div
          className={cn(
            "surface-card flex items-center gap-3 rounded-3xl px-5 py-4 transition-[border-color,box-shadow] focus-within:border-volt focus-within:shadow-volt",
            invalid && "border-destructive focus-within:border-destructive focus-within:shadow-none"
          )}
        >
          <label htmlFor={inputId} className="sr-only">
            Body weight in {units === "kg" ? "kilograms" : "pounds"}
          </label>
          <input
            id={inputId}
            type="number"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="next"
            min={units === "kg" ? WEIGHT_MIN_KG : minLb}
            max={units === "kg" ? WEIGHT_MAX_KG : maxLb}
            step="any"
            placeholder={units === "kg" ? "75" : "165"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            className="text-stat w-full min-w-0 flex-1 bg-transparent text-5xl font-semibold text-foreground outline-none placeholder:text-muted-foreground/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <RadioGroup aria-label="Units" className="flex h-11 shrink-0 rounded-xl bg-surface-2 p-1">
            {(["kg", "lb"] as const).map((u) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={units === u}
                onClick={() => switchUnits(u)}
                className={cn(
                  "min-w-12 rounded-lg px-3 text-sm font-bold uppercase transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring",
                  units === u ? "bg-volt text-volt-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {u}
              </button>
            ))}
          </RadioGroup>
        </div>
        {invalid ? (
          <p id={errorId} role="alert" className="text-sm font-medium text-destructive">
            Enter a weight between {units === "kg" ? `${WEIGHT_MIN_KG} and ${WEIGHT_MAX_KG} kg` : `${minLb} and ${maxLb} lb`}.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">You can change this any time in Profile.</p>
        )}
      </div>
    </StepShell>
  )
}
