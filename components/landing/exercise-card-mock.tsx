import { ArrowRight, Repeat } from "lucide-react"

import { Stat } from "@/components/app/stat"

/**
 * Static, CSS-only mock of the swipe card used as the hero image.
 * Decorative: hidden from assistive tech, the copy around it carries the message.
 */
export function ExerciseCardMock() {
  return (
    <div className="relative mx-auto w-full max-w-[22rem]" aria-hidden="true">
      {/* volt glow */}
      <div className="pointer-events-none absolute -inset-10 -z-10 rounded-full bg-volt/18 blur-3xl" />
      {/* cards queued behind */}
      <div className="absolute inset-x-6 -bottom-4 h-full rounded-3xl border border-border bg-surface-2/60" />
      <div className="absolute inset-x-3 -bottom-2 h-full rounded-3xl border border-border bg-surface-2/80" />

      <div className="surface-card relative overflow-hidden rounded-3xl p-5 shadow-volt">
        <div className="flex items-center justify-between">
          <span className="text-label text-muted-foreground">Exercise 3 of 8</span>
          <span className="rounded-full bg-volt/12 px-2.5 py-1 text-label text-volt-ink">Push day</span>
        </div>

        {/* muscle map placeholder */}
        <div className="relative mt-5 flex h-28 items-end justify-center overflow-hidden rounded-2xl bg-surface-2">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,var(--volt)_0%,transparent_60%)] opacity-30" />
          <div className="relative mb-3 flex items-end gap-1.5">
            <span className="h-10 w-3 rounded-full bg-volt/40" />
            <span className="h-16 w-3 rounded-full bg-volt" />
            <span className="h-16 w-3 rounded-full bg-volt" />
            <span className="h-10 w-3 rounded-full bg-volt/40" />
          </div>
        </div>

        <h3 className="mt-5 font-heading text-2xl leading-tight font-bold tracking-tight">Barbell bench press</h3>
        <p className="mt-1 text-sm text-muted-foreground">Chest · Triceps · Front delts</p>

        <div className="mt-5 grid grid-cols-3 gap-3 rounded-2xl bg-surface-2 p-3">
          <Stat label="Sets" value="4" size="sm" align="center" />
          <Stat label="Reps" value="8–10" size="sm" align="center" />
          <Stat label="Load" value="60" unit="kg" size="sm" align="center" />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <span className="flex h-12 items-center justify-center gap-2 rounded-xl bg-replace/15 text-sm font-semibold text-replace">
            <Repeat className="size-4" />
            Replace
          </span>
          <span className="flex h-12 items-center justify-center gap-2 rounded-xl bg-volt text-sm font-semibold text-volt-foreground">
            Done
            <ArrowRight className="size-4" />
          </span>
        </div>
      </div>
    </div>
  )
}
