"use client"

import { useState } from "react"
import { Plus, X } from "lucide-react"

import { exerciseName } from "@/components/progress/format"
import { Button } from "@/components/ui/button"
import type { UserProfile } from "@/lib/domain/types"
import { haptic } from "@/lib/haptics"
import { useProfileStore } from "@/lib/store"

import { ExercisePickerDrawer } from "./exercise-picker-drawer"
import { notifyPlanChange } from "./plan-change"
import { SectionCard } from "./section-card"

/** Exercises the user likes (profile.preferredExerciseIds). The engine picks them first when they fit the slot. */
export function FavouritesSection({ profile }: { profile: UserProfile }) {
  const updateProfile = useProfileStore((s) => s.updateProfile)
  const [pickerOpen, setPickerOpen] = useState(false)
  const favourites = profile.preferredExerciseIds

  function add(id: string) {
    if (!favourites.includes(id)) {
      updateProfile({ preferredExerciseIds: [...favourites, id] })
      haptic("success")
      notifyPlanChange()
    }
    setPickerOpen(false)
  }

  function remove(id: string) {
    updateProfile({ preferredExerciseIds: favourites.filter((x) => x !== id) })
    haptic("tick")
    notifyPlanChange()
  }

  return (
    <SectionCard id="favourites" title="Favourites" description="Exercises you like. They are picked first when they fit the day.">
      <div className="flex flex-col gap-3 p-5">
        {favourites.length ? (
          <ul className="flex flex-col divide-y divide-border">
            {favourites.map((id) => {
              const name = exerciseName(id)
              return (
                <li key={id} className="flex items-center gap-3 py-1">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="size-11 rounded-xl text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${name} from favourites`}
                    onClick={() => remove(id)}
                  >
                    <X className="size-5" />
                  </Button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No favourites yet.</p>
        )}
        <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => setPickerOpen(true)}>
          <Plus />
          Add favourite exercise
        </Button>
      </div>

      <ExercisePickerDrawer
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        excludedIds={[...favourites, ...profile.excludedExerciseIds]}
        onPick={add}
        title="Add favourite exercise"
        description="It is picked first whenever it fits the day's plan."
      />
    </SectionCard>
  )
}
