"use client"

import type { Experience } from "@/lib/domain/types"

import { RadioGroup } from "@/components/app/radio-group"
import { OptionCard } from "@/components/onboarding/option-card"
import { EXPERIENCE_OPTIONS } from "@/components/onboarding/options"
import { StepShell } from "@/components/onboarding/step-shell"

export function ExperienceStep({ value, onChange }: { value: Experience | null; onChange: (v: Experience) => void }) {
  return (
    <StepShell id="experience" title="How long have you been lifting?" subtitle="Decides exercise difficulty and weekly volume.">
      <RadioGroup aria-labelledby="experience-title" className="flex flex-col gap-3">
        {EXPERIENCE_OPTIONS.map((o) => (
          <OptionCard key={o.value} label={o.label} hint={o.hint} selected={value === o.value} onSelect={() => onChange(o.value)} />
        ))}
      </RadioGroup>
    </StepShell>
  )
}
