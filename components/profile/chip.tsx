"use client"

import { Check } from "lucide-react"

import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/** Multi-select pill (44px) with aria-pressed. */
export function Chip({
  label,
  pressed,
  onToggle,
  locked = false,
  className,
}: {
  label: string
  pressed: boolean
  onToggle: () => void
  /** Always selected and cannot be turned off (shown pressed, announced as unavailable to toggle). */
  locked?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={locked || pressed}
      aria-disabled={locked || undefined}
      title={locked ? `${label} is always included` : undefined}
      onClick={() => {
        if (locked) return
        haptic("tick")
        onToggle()
      }}
      className={cn(
        "inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring active:scale-[0.98]",
        locked || pressed ? "border-volt bg-volt text-volt-foreground" : "border-border bg-surface text-foreground hover:border-foreground/20",
        locked && "cursor-default opacity-80 active:scale-100",
        className,
      )}
    >
      {locked || pressed ? <Check className="size-4" strokeWidth={3} aria-hidden="true" /> : null}
      {label}
    </button>
  )
}
