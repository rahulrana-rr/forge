"use client"

import type { TrainingDays } from "@/lib/domain/types"

import { RadioGroup } from "@/components/app/radio-group"
import { OptionTile } from "@/components/onboarding/option-card"
import { DAYS_OPTIONS } from "@/components/onboarding/options"
import { StepShell } from "@/components/onboarding/step-shell"

export function DaysStep({ value, onChange }: { value: TrainingDays | null; onChange: (v: TrainingDays) => void }) {
  const selected = DAYS_OPTIONS.find((o) => o.value === value)
  return (
    <StepShell id="days" title="How many days a week?" subtitle="Be honest. The split is built around it.">
      <div className="flex flex-col gap-4">
        <RadioGroup aria-labelledby="days-title" className="grid grid-cols-5 gap-2">
          {DAYS_OPTIONS.map((o) => (
            <OptionTile
              key={o.value}
              label={o.label}
              caption={o.hint ? "days" : undefined}
              selected={value === o.value}
              onSelect={() => onChange(o.value)}
              className="min-h-20"
            />
          ))}
        </RadioGroup>
        <p className="min-h-6 text-base text-muted-foreground" aria-live="polite">
          {selected?.hint ? (
            <>
              <span className="font-semibold text-foreground">{selected.value} days</span> → {selected.hint}
            </>
          ) : (
            "Pick a number to see the split."
          )}
        </p>
      </div>
    </StepShell>
  )
}
