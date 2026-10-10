"use client"

import { useState } from "react"
import { Plus, X } from "lucide-react"

import { SectionLabel } from "@/components/app/section-label"
import { exerciseName } from "@/components/progress/format"
import { Button } from "@/components/ui/button"
import type { UserProfile } from "@/lib/domain/types"
import type { BodyArea } from "@/lib/exercises/types"
import { haptic } from "@/lib/haptics"
import { useProfileStore } from "@/lib/store"

import { Chip } from "./chip"
import { ExercisePickerDrawer } from "./exercise-picker-drawer"
import { BODY_AREA_OPTIONS } from "./options"
import { notifyPlanChange } from "./plan-change"
import { SectionCard } from "./section-card"

/** Body areas to protect and a list of exercises the engine must never program. */
export function LimitationsSection({ profile }: { profile: UserProfile }) {
  const updateProfile = useProfileStore((s) => s.updateProfile)
  const [pickerOpen, setPickerOpen] = useState(false)
  const flagged = new Set<BodyArea>(profile.limitations)

  function toggleArea(area: BodyArea) {
    const limitations = flagged.has(area) ? profile.limitations.filter((a) => a !== area) : [...profile.limitations, area]
    updateProfile({ limitations })
    notifyPlanChange()
  }

  function exclude(id: string) {
    if (!profile.excludedExerciseIds.includes(id)) {
      // An exercise to avoid can't also be a favourite.
      updateProfile({
        excludedExerciseIds: [...profile.excludedExerciseIds, id],
        preferredExerciseIds: profile.preferredExerciseIds.filter((x) => x !== id),
      })
      haptic("success")
      notifyPlanChange()
    }
    setPickerOpen(false)
  }

  function allow(id: string) {
    updateProfile({ excludedExerciseIds: profile.excludedExerciseIds.filter((x) => x !== id) })
    haptic("tick")
    notifyPlanChange()
  }

  return (
    <SectionCard id="limitations" title="Protect" description="Flag anything that hurts. Exercises that stress it are left out.">
      <div className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Body areas to protect">
          {BODY_AREA_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label} pressed={flagged.has(o.value)} onToggle={() => toggleArea(o.value)} />
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <SectionLabel>Exercises to avoid</SectionLabel>
          {profile.excludedExerciseIds.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {profile.excludedExerciseIds.map((id) => {
                const name = exerciseName(id)
                return (
                  <li key={id} className="flex items-center gap-3 py-1">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      className="size-11 rounded-xl text-muted-foreground hover:text-foreground"
                      aria-label={`Allow ${name} again`}
                      onClick={() => allow(id)}
                    >
                      <X className="size-5" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing excluded yet.</p>
          )}
          <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => setPickerOpen(true)}>
            <Plus />
            Add exercise to avoid
          </Button>
        </div>
      </div>

      <ExercisePickerDrawer
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        excludedIds={profile.excludedExerciseIds}
        onPick={exclude}
      />
    </SectionCard>
  )
}
