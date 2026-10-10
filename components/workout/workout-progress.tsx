"use client"

import { PHASE_LABELS } from "@/components/workout/prescription"
import type { ExerciseLog, WorkoutPhase } from "@/lib/domain/types"
import type { WorkoutExercise } from "@/lib/engine/types"
import { cn } from "@/lib/utils"

const PHASE_SEGMENT: Record<WorkoutPhase, { done: string; current: string; pending: string }> = {
  warmup: { done: "bg-muted-foreground/70", current: "bg-muted-foreground", pending: "bg-muted-foreground/25" },
  main: { done: "bg-volt", current: "bg-volt", pending: "bg-volt/25" },
  cooldown: { done: "bg-info", current: "bg-info", pending: "bg-info/25" },
}

export interface WorkoutProgressProps {
  exercises: WorkoutExercise[]
  currentIndex: number
  logs: Record<string, ExerciseLog>
  className?: string
}

/** Segmented progress bar (one segment per slot, grouped by phase) with "Exercise N of M". */
export function WorkoutProgress({ exercises, currentIndex, logs, className }: WorkoutProgressProps) {
  const current = exercises[Math.min(currentIndex, exercises.length - 1)]
  const phase: WorkoutPhase = current?.phase ?? "main"
  const inPhase = exercises.filter((e) => e.phase === phase)
  const positionInPhase = current ? inPhase.findIndex((e) => e.slotId === current.slotId) + 1 : inPhase.length
  const noun = phase === "main" ? "Exercise" : PHASE_LABELS[phase]
  const label = `${noun} ${Math.max(1, positionInPhase)} of ${inPhase.length}`

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-heading text-base font-bold tracking-tight">{label}</p>
        <p className="text-label text-muted-foreground">{PHASE_LABELS[phase]}</p>
      </div>
      <ol
        className="flex h-1.5 w-full gap-1"
        aria-label={`Workout progress: ${label}`}
        role="list"
      >
        {exercises.map((slot, i) => {
          const status = logs[slot.slotId]?.status ?? "pending"
          const tones = PHASE_SEGMENT[slot.phase]
          const isCurrent = i === currentIndex
          const isDone = i < currentIndex || (status !== "pending" && status !== "replaced")
          const tone = isCurrent ? tones.current : isDone ? tones.done : tones.pending
          return (
            <li
              key={slot.slotId}
              className={cn(
                "h-full flex-1 rounded-full transition-colors duration-300",
                tone,
                isCurrent && "animate-pulse-soft ring-2 ring-background",
                slot.phase !== (exercises[i - 1]?.phase ?? slot.phase) && "ml-1.5",
              )}
              aria-current={isCurrent ? "step" : undefined}
              aria-label={`${PHASE_LABELS[slot.phase]} ${i + 1}${isDone ? ", done" : isCurrent ? ", current" : ""}`}
            />
          )
        })}
      </ol>
    </div>
  )
}
