"use client"

import { MinusIcon, PlusIcon } from "lucide-react"

import { usePressRepeat } from "@/hooks/use-press-repeat"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

function StepButton({
  onStep,
  disabled,
  label,
  children,
}: {
  onStep: () => void
  disabled?: boolean
  label: string
  children: React.ReactNode
}) {
  const handlers = usePressRepeat(
    () => {
      haptic("tick")
      onStep()
    },
    { disabled },
  )
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className="flex size-11 shrink-0 touch-none items-center justify-center rounded-xl bg-surface-3 text-foreground transition-colors outline-none select-none hover:bg-surface-3/80 focus-visible:ring-3 focus-visible:ring-ring active:scale-95 disabled:opacity-40 [&_svg]:size-5"
      {...handlers}
    >
      {children}
    </button>
  )
}

export interface StepperProps {
  label: string
  value: number
  /** Display text for the value, e.g. "60" or "0:45". Defaults to the number. */
  display?: string
  unit?: string
  step: number
  min?: number
  max?: number
  onChange: (next: number) => void
  className?: string
}

/** Big −/+ stepper with press-and-hold repeat. Value is shown in the middle in text-stat. */
export function Stepper({ label, value, display, unit, step, min = 0, max = Number.POSITIVE_INFINITY, onChange, className }: StepperProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n * 100) / 100))
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)} role="group" aria-label={label}>
      <StepButton label={`Decrease ${label}`} onStep={() => onChange(clamp(value - step))} disabled={value <= min}>
        <MinusIcon aria-hidden="true" />
      </StepButton>
      <div className="flex min-w-0 flex-1 flex-col items-center leading-none" aria-live="polite" aria-atomic="true">
        <span className="text-stat text-[clamp(1.125rem,5.2vw,1.5rem)] font-semibold whitespace-nowrap">{display ?? value}</span>
        {unit ? <span className="mt-0.5 text-label text-muted-foreground">{unit}</span> : null}
      </div>
      <StepButton label={`Increase ${label}`} onStep={() => onChange(clamp(value + step))} disabled={value >= max}>
        <PlusIcon aria-hidden="true" />
      </StepButton>
    </div>
  )
}
