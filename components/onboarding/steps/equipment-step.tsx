"use client"

import type { Equipment } from "@/lib/exercises/types"
import type { EquipmentPreset } from "@/lib/domain/types"

import { RadioGroup } from "@/components/app/radio-group"
import { Chip } from "@/components/onboarding/chip"
import { OptionCard } from "@/components/onboarding/option-card"
import { EQUIPMENT_OPTIONS, EQUIPMENT_PRESET_OPTIONS } from "@/components/onboarding/options"
import { StepShell } from "@/components/onboarding/step-shell"

export function EquipmentStep({
  preset,
  custom,
  onPresetChange,
  onCustomChange,
}: {
  preset: EquipmentPreset | null
  custom: Equipment[]
  onPresetChange: (p: EquipmentPreset) => void
  onCustomChange: (items: Equipment[]) => void
}) {
  function toggle(item: Equipment) {
    if (item === "bodyweight") return
    onCustomChange(custom.includes(item) ? custom.filter((e) => e !== item) : [...custom, item])
  }
  // Bodyweight is always part of the list (warm-ups and stretches need nothing else), so it is
  // shown selected and locked; the count is of everything else.
  const picked = custom.filter((e) => e !== "bodyweight").length

  return (
    <StepShell id="equipment" title="What do you train with?" subtitle="Only exercises you can actually do will show up.">
      <div className="flex flex-col gap-3">
        <RadioGroup aria-labelledby="equipment-title" className="flex flex-col gap-3">
          {EQUIPMENT_PRESET_OPTIONS.map((o) => (
            <OptionCard
              key={o.value}
              label={o.label}
              hint={o.hint}
              selected={preset === o.value}
              onSelect={() => onPresetChange(o.value)}
            />
          ))}
        </RadioGroup>
        {preset === "custom" ? (
          <fieldset className="animate-rise mt-2 flex flex-col gap-3">
            <legend className="text-label text-muted-foreground">Tap everything you have</legend>
            <div className="flex flex-wrap gap-2">
              {EQUIPMENT_OPTIONS.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  pressed={custom.includes(o.value)}
                  locked={o.value === "bodyweight"}
                  onToggle={() => toggle(o.value)}
                />
              ))}
            </div>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {picked === 0 ? "Bodyweight is always included. Pick what else you have." : `${picked} selected, plus bodyweight.`}
            </p>
          </fieldset>
        ) : null}
      </div>
    </StepShell>
  )
}
