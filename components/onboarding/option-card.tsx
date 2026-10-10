"use client"

import { Check } from "lucide-react"

import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/**
 * Large tappable choice (min 56px). Used as a radio inside a <RadioGroup> (components/app/radio-group).
 */
export function OptionCard({
  label,
  hint,
  selected,
  onSelect,
  className,
}: {
  label: string
  hint?: string
  selected: boolean
  onSelect: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => {
        haptic("tap")
        onSelect()
      }}
      className={cn(
        "flex min-h-14 w-full items-center gap-4 rounded-2xl border px-5 py-4 text-left transition-[background-color,border-color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring active:scale-[0.99]",
        selected
          ? "border-volt bg-volt/10 shadow-volt"
          : "surface-card border-border hover:border-foreground/20",
        className
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-heading text-lg leading-tight font-bold tracking-tight">{label}</span>
        {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
      </span>
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
          selected ? "border-volt bg-volt text-volt-foreground" : "border-border bg-transparent text-transparent"
        )}
        aria-hidden="true"
      >
        <Check className="size-4" strokeWidth={3} />
      </span>
    </button>
  )
}

/** Compact square choice for numeric pickers (days per week, minutes). */
export function OptionTile({
  label,
  caption,
  selected,
  onSelect,
  className,
}: {
  label: string
  caption?: string
  selected: boolean
  onSelect: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={caption ? `${label} ${caption}` : undefined}
      onClick={() => {
        haptic("tap")
        onSelect()
      }}
      className={cn(
        "flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl border transition-[background-color,border-color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring active:scale-[0.98]",
        selected ? "border-volt bg-volt text-volt-foreground shadow-volt" : "surface-card border-border hover:border-foreground/20",
        className
      )}
    >
      <span className="text-stat text-2xl font-semibold leading-none">{label}</span>
      {caption ? (
        <span className={cn("text-[0.6875rem] font-semibold", selected ? "text-volt-foreground/80" : "text-muted-foreground")}>
          {caption}
        </span>
      ) : null}
    </button>
  )
}
