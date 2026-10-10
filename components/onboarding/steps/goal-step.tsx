"use client"

import type { Goal } from "@/lib/exercises/types"

import { RadioGroup } from "@/components/app/radio-group"
import { OptionCard } from "@/components/onboarding/option-card"
import { GOAL_OPTIONS } from "@/components/onboarding/options"
import { StepShell } from "@/components/onboarding/step-shell"

export function GoalStep({ value, onChange }: { value: Goal | null; onChange: (goal: Goal) => void }) {
  return (
    <StepShell id="goal" title="What are you training for?" subtitle="This sets your sets, reps and rest.">
      <RadioGroup aria-labelledby="goal-title" className="flex flex-col gap-3">
        {GOAL_OPTIONS.map((o) => (
          <OptionCard key={o.value} label={o.label} hint={o.hint} selected={value === o.value} onSelect={() => onChange(o.value)} />
        ))}
      </RadioGroup>
    </StepShell>
  )
}
