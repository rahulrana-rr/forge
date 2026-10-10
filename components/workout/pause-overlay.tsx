"use client"

import { useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { PlayIcon } from "lucide-react"

import { BigButton } from "@/components/app/big-button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { formatDuration } from "@/lib/dates"
import { haptic } from "@/lib/haptics"
import { useWorkoutStore } from "@/lib/store"

export interface PauseOverlayProps {
  open: boolean
  /** Called when the user ends a workout that has logged work; the parent shows the pre-save screen. */
  onEndWorkout: () => void
}

/** Full-screen glass overlay while the workout is paused. */
export function PauseOverlay({ open, onEndWorkout }: PauseOverlayProps) {
  const reducedMotion = useReducedMotion()
  const active = useWorkoutStore((s) => s.active)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  // Time is frozen while paused, so a one-off read is accurate.
  const elapsed = open ? useWorkoutStore.getState().elapsedSeconds() : 0
  // Only main work is worth saving (finish() saves nothing for a warm-up-only session).
  const anythingDone = active
    ? active.workout.exercises.some((e) => e.phase === "main" && active.logs[e.slotId]?.status === "completed")
    : false

  const resume = () => {
    haptic("tap")
    useWorkoutStore.getState().resume()
  }
  const end = () => {
    if (anythingDone) {
      useWorkoutStore.getState().resume()
      onEndWorkout()
    } else {
      setConfirmDiscard(true)
    }
  }
  const discard = () => {
    const s = useWorkoutStore.getState()
    s.discard()
    s.ensureToday()
    setConfirmDiscard(false)
  }

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.div
            key="pause"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pause-title"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className="glass fixed inset-0 z-40 flex flex-col items-center justify-center px-6 pt-safe pb-safe"
          >
            <p className="text-label text-muted-foreground">Paused</p>
            <h2 id="pause-title" className="mt-2 font-heading text-5xl font-extrabold tracking-tight uppercase">
              Take a breath
            </h2>
            <p className="mt-6 text-label text-muted-foreground">Elapsed</p>
            <p className="text-stat text-6xl font-bold leading-none">{formatDuration(elapsed)}</p>
            {active ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {active.workout.title} · {active.currentIndex} of {active.workout.exercises.length} done
              </p>
            ) : null}
            <div className="mt-10 flex w-full max-w-sm flex-col gap-3">
              <BigButton tone="volt" onClick={resume} autoFocus>
                <PlayIcon data-icon="inline-start" aria-hidden="true" />
                Resume
              </BigButton>
              <BigButton tone="ghost" onClick={end}>
                End workout
              </BigButton>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this workout?</DialogTitle>
            <DialogDescription>No main exercise has been logged yet, so there is nothing to save. A fresh plan will be ready for today.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="h-11 rounded-xl" />}>Keep going</DialogClose>
            <Button variant="destructive" className="h-11 rounded-xl" onClick={discard}>
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
