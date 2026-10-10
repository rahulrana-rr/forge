"use client"

import type { Gender } from "@/lib/domain/types"

import { RadioGroup } from "@/components/app/radio-group"
import { OptionCard } from "@/components/onboarding/option-card"
import { GENDER_OPTIONS } from "@/components/onboarding/options"
import { StepShell } from "@/components/onboarding/step-shell"

export function GenderStep({ value, onChange }: { value: Gender | null; onChange: (v: Gender) => void }) {
  return (
    <StepShell id="gender" title="How do you identify?" subtitle="Only used to pick sensible starting loads.">
      <RadioGroup aria-labelledby="gender-title" className="flex flex-col gap-3">
        {GENDER_OPTIONS.map((o) => (
          <OptionCard key={o.value} label={o.label} selected={value === o.value} onSelect={() => onChange(o.value)} />
        ))}
      </RadioGroup>
    </StepShell>
  )
}
