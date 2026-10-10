"use client"

import { Check } from "lucide-react"

import { RadioGroup } from "@/components/app/radio-group"
import { SectionLabel } from "@/components/app/section-label"
import type { EquipmentPreset, UserProfile } from "@/lib/domain/types"
import type { Equipment } from "@/lib/exercises/types"
import { haptic } from "@/lib/haptics"
import { useProfileStore } from "@/lib/store"
import { cn } from "@/lib/utils"

import { Chip } from "./chip"
import { EQUIPMENT_OPTIONS, PRESET_LABELS, PRESET_OPTIONS } from "./options"
import { notifyPlanChange } from "./plan-change"
import { SectionCard } from "./section-card"

/** Preset picker plus per-item chips. Touching a chip turns the list into a custom one. */
export function EquipmentSection({ profile }: { profile: UserProfile }) {
  const updateProfile = useProfileStore((s) => s.updateProfile)
  const owned = new Set<Equipment>(profile.equipment)

  function choosePreset(preset: EquipmentPreset) {
    if (preset === profile.equipmentPreset) return
    haptic("tap")
    if (preset === "custom") updateProfile({ equipmentPreset: "custom", equipment: profile.equipment })
    else updateProfile({ equipmentPreset: preset })
    notifyPlanChange()
  }

  function toggle(item: Equipment) {
    // Always included (the profile store re-adds it on every write); its chip is locked.
    if (item === "bodyweight") return
    const equipment = owned.has(item) ? profile.equipment.filter((e) => e !== item) : [...profile.equipment, item]
    updateProfile({ equipmentPreset: "custom", equipment })
    notifyPlanChange()
  }

  return (
    <SectionCard id="equipment" title="Equipment" description="Pick a preset, or tap items to build your own list.">
      <div className="flex flex-col gap-5 p-5">
        <RadioGroup aria-label="Equipment preset" className="flex flex-col gap-2">
          {PRESET_OPTIONS.map((o) => {
            const selected = o.value === profile.equipmentPreset
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => choosePreset(o.value)}
                className={cn(
                  "flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-2.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring active:scale-[0.99]",
                  selected ? "border-volt bg-volt/10" : "border-border bg-surface hover:border-foreground/20",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-bold tracking-tight">{o.label}</span>
                  {o.hint ? <span className="truncate text-xs text-muted-foreground">{o.hint}</span> : null}
                </span>
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-volt bg-volt text-volt-foreground" : "border-border text-transparent",
                  )}
                  aria-hidden="true"
                >
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              </button>
            )
          })}
        </RadioGroup>

        <div className="flex flex-col gap-3">
          <SectionLabel>
            {profile.equipmentPreset === "custom" ? "Your equipment" : `Included in ${PRESET_LABELS[profile.equipmentPreset]}`}
          </SectionLabel>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Equipment you have">
            {EQUIPMENT_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                pressed={owned.has(o.value)}
                locked={o.value === "bodyweight"}
                onToggle={() => toggle(o.value)}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {owned.size} selected
            {profile.equipmentPreset !== "custom" ? " · tapping an item switches to a custom list" : ""}.
          </p>
        </div>
      </div>
    </SectionCard>
  )
}
