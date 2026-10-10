"use client"

import { useRef, useState } from "react"
import { ArrowLeftIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { ExerciseDetails } from "@/components/workout/exercise-details"
import type { WorkoutExercise } from "@/lib/engine/types"
import { getExercise } from "@/lib/exercises"

export interface ExerciseDetailsDrawerProps {
  /** The exercise to show; null renders an empty (closing) drawer. */
  exerciseId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Today's prescription for `exerciseId` (not shown for alternatives opened from it). */
  slot?: WorkoutExercise
}

/**
 * Bottom drawer with the full exercise reference. Alternatives open in place with a way back, so
 * browsing them never routes away from /today mid-workout (or needs the network to do so).
 */
export function ExerciseDetailsDrawer({ exerciseId, open, onOpenChange, slot }: ExerciseDetailsDrawerProps) {
  // Remembers which exercise the alternative was opened from, so a new base exercise starts fresh.
  const [viewing, setViewing] = useState<{ from: string; id: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewingId = viewing && viewing.from === exerciseId ? viewing.id : null
  const shownId = viewingId ?? exerciseId
  const base = exerciseId ? getExercise(exerciseId) : undefined
  const shown = shownId ? getExercise(shownId) : undefined

  const show = (id: string | null) => {
    setViewing(id && exerciseId && id !== exerciseId ? { from: exerciseId, id } : null)
    scrollRef.current?.scrollTo({ top: 0 })
  }
  const change = (next: boolean) => {
    if (!next) setViewing(null)
    onOpenChange(next)
  }

  return (
    <Drawer open={open} onOpenChange={change} swipeDirection="down" showSwipeHandle>
      <DrawerContent className="mx-auto w-full max-w-lg">
        <DrawerHeader className="sr-only">
          <DrawerTitle>{shown?.name ?? "Exercise"}</DrawerTitle>
          <DrawerDescription>{viewingId && base ? `Alternative to ${base.name}` : "Exercise details"}</DrawerDescription>
        </DrawerHeader>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-safe">
          {viewingId && base ? (
            <Button variant="ghost" onClick={() => show(null)} className="-ml-2 mb-2 h-11 w-fit rounded-xl text-muted-foreground">
              <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
              Back to {base.name}
            </Button>
          ) : null}
          {shownId ? (
            <ExerciseDetails
              key={shownId}
              exerciseId={shownId}
              slot={viewingId ? undefined : slot}
              onAlternativeSelect={show}
              className="pb-6"
            />
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
