"use client"

import { RadioGroup } from "@/components/app/radio-group"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

import type { Option } from "./options"

/** Single-choice segmented control (radiogroup), 48px tall, matching the ThemeToggle look. */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string
  options: readonly Option<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <RadioGroup
      aria-label={label}
      className={cn("grid h-12 gap-1 rounded-2xl bg-surface-2 p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              if (selected) return
              haptic("tick")
              onChange(o.value)
            }}
            className={cn(
              "flex items-center justify-center rounded-xl px-1 text-sm font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring",
              selected ? "bg-background text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        )
      })}
    </RadioGroup>
  )
}
