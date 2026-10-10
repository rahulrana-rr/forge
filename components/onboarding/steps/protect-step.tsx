"use client"

import type { BodyArea } from "@/lib/exercises/types"
import type { DurationPreference } from "@/lib/domain/types"

import { RadioGroup } from "@/components/app/radio-group"
import { Chip } from "@/components/onboarding/chip"
import { OptionTile } from "@/components/onboarding/option-card"
import { BODY_AREA_OPTIONS, DURATION_OPTIONS } from "@/components/onboarding/options"
import { StepShell } from "@/components/onboarding/step-shell"

export function ProtectStep({
  limitations,
  duration,
  onLimitationsChange,
  onDurationChange,
}: {
  limitations: BodyArea[]
  duration: DurationPreference
  onLimitationsChange: (areas: BodyArea[]) => void
  onDurationChange: (d: DurationPreference) => void
}) {
  function toggle(area: BodyArea) {
    onLimitationsChange(limitations.includes(area) ? limitations.filter((a) => a !== area) : [...limitations, area])
  }

  return (
    <StepShell
      id="protect"
      title="Anything to protect?"
      subtitle="Exercises that stress these areas are left out. Skip if you're good."
      optional
    >
      <div className="flex flex-col gap-8">
        <fieldset className="flex flex-col gap-3">
          <legend className="text-label text-muted-foreground">Sore or injured</legend>
          <div className="flex flex-wrap gap-2">
            {BODY_AREA_OPTIONS.map((o) => (
              <Chip key={o.value} label={o.label} pressed={limitations.includes(o.value)} onToggle={() => toggle(o.value)} />
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-3">
          <p id="duration-label" className="text-label text-muted-foreground">
            Workout length
          </p>
          <RadioGroup aria-labelledby="duration-label" className="grid grid-cols-4 gap-2">
            {DURATION_OPTIONS.map((o) => (
              <OptionTile
                key={o.value}
                label={o.label}
                caption="min"
                selected={duration === o.value}
                onSelect={() => onDurationChange(o.value)}
              />
            ))}
          </RadioGroup>
        </div>
      </div>
    </StepShell>
  )
}
