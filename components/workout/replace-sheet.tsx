"use client"

import { useMemo } from "react"
import { ChevronRightIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { EmptyState } from "@/components/app/empty-state"
import { DIFFICULTY_LABELS, EQUIPMENT_LABELS, MUSCLE_LABELS } from "@/lib/exercises/types"
import { getExercise } from "@/lib/exercises"
import { haptic } from "@/lib/haptics"
import { useWorkoutStore } from "@/lib/store"
import { cn } from "@/lib/utils"

export interface ReplaceSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  limit?: number
}

// Light theme keeps the tint for the colour cue but sets the text in foreground: the bright brand
// colours read at under 3:1 on white.
const DIFFICULTY_TONE = {
  beginner: "bg-success/15 text-foreground dark:text-success",
  intermediate: "bg-volt/15 text-volt-ink",
  advanced: "bg-replace/15 text-foreground dark:text-replace",
} as const

/** Manual replacement picker: ranked candidates for the current slot from the engine. */
export function ReplaceSheet({ open, onOpenChange, limit = 8 }: ReplaceSheetProps) {
  const active = useWorkoutStore((s) => s.active)
  const current = active ? active.workout.exercises[active.currentIndex] : undefined
  const suggestedId = current?.suggestedExerciseId ?? null
  const candidates = useMemo(() => {
    if (!open || !active) return []
    // Depends on `active` so the list refreshes when the slot or workout changes.
    const store = useWorkoutStore.getState()
    const ranked = store.candidatesForCurrent(limit)
    if (!suggestedId) return ranked
    // The harder variation the card's note names (a bodyweight lift maxed out on reps and sets)
    // leads the list, when the engine accepts it as a swap for this slot.
    const suggested = store.candidatesForCurrent(200).find((c) => c.exerciseId === suggestedId)
    if (!suggested) return ranked
    const lead = { ...suggested, reason: `Next step up: you have maxed out reps and sets · ${suggested.reason}` }
    return [lead, ...ranked.filter((c) => c.exerciseId !== suggestedId)].slice(0, limit)
  }, [open, active, limit, suggestedId])

  const currentName = current ? (getExercise(current.exerciseId)?.name ?? "this exercise") : "this exercise"

  const pick = (exerciseId: string) => {
    haptic("tap")
    useWorkoutStore.getState().replaceCurrent(exerciseId)
    onOpenChange(false)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="down" showSwipeHandle>
      <DrawerContent className="mx-auto w-full max-w-lg">
        <DrawerHeader className="text-left">
          <DrawerTitle className="font-heading text-xl font-bold tracking-tight uppercase">Replace exercise</DrawerTitle>
          <DrawerDescription>Alternatives for {currentName}, best match first.</DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-safe">
          {candidates.length === 0 ? (
            <EmptyState
              title="No alternatives fit"
              description="Nothing else in your equipment set trains this slot. Skip it or keep going."
              className="mb-4"
            />
          ) : (
            <ul className="mb-4 flex flex-col gap-2" aria-label="Replacement candidates">
              {candidates.map((c) => {
                const ex = getExercise(c.exerciseId)
                if (!ex) return null
                return (
                  <li key={c.exerciseId}>
                    <button
                      type="button"
                      onClick={() => pick(c.exerciseId)}
                      className="surface-card flex w-full items-center gap-3 rounded-2xl p-3.5 text-left transition-colors outline-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring active:scale-[0.99]"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-heading text-base font-bold tracking-tight">{ex.name}</span>
                          <Badge variant="secondary" className={cn("h-5 px-2 text-[0.65rem]", DIFFICULTY_TONE[ex.difficulty])}>
                            {DIFFICULTY_LABELS[ex.difficulty]}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/80">{MUSCLE_LABELS[ex.primaryMuscle]}</span>
                          {" · "}
                          {ex.equipment.map((e) => EQUIPMENT_LABELS[e]).join(", ")}
                        </p>
                        <p className="text-xs leading-snug text-muted-foreground">{c.reason}</p>
                      </div>
                      <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
