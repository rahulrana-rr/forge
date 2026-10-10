"use client"

import { ThemeToggle } from "@/components/app/theme-toggle"
import { Switch } from "@/components/ui/switch"
import type { UserProfile } from "@/lib/domain/types"
import { haptic } from "@/lib/haptics"
import { useTimerSound } from "@/hooks/use-timer-sound"
import { useProfileStore } from "@/lib/store"

import { UNIT_OPTIONS } from "./options"
import { SectionCard } from "./section-card"
import { Segmented } from "./segmented"

/** Theme, units and the rest-timer chime. */
export function AppearanceSection({ profile }: { profile: UserProfile }) {
  const updateProfile = useProfileStore((s) => s.updateProfile)
  const [timerSound, setTimerSound] = useTimerSound()

  return (
    <SectionCard id="appearance" title="Appearance">
      <div className="flex flex-col divide-y divide-border">
        <div className="flex flex-col gap-3 px-5 py-4">
          <span className="text-sm font-semibold">Theme</span>
          <ThemeToggle />
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          <span className="text-sm font-semibold">Units</span>
          <Segmented
            label="Units"
            options={UNIT_OPTIONS}
            value={profile.units}
            onChange={(units) => updateProfile({ units })}
          />
          <p className="text-xs text-muted-foreground">
            Weights are stored in kilograms and shown in your units.
          </p>
        </div>

        <label className="flex min-h-14 cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold">Rest timer sound</span>
            <span className="text-xs text-muted-foreground">
              Chime when a rest period ends
            </span>
          </span>
          <Switch
            checked={timerSound}
            onCheckedChange={(checked) => {
              haptic("tick")
              setTimerSound(checked)
            }}
            className="data-checked:bg-volt"
          />
        </label>
      </div>
    </SectionCard>
  )
}
