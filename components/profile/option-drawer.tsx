"use client"

import { Check } from "lucide-react"

import { RadioGroup } from "@/components/app/radio-group"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

import type { Option } from "./options"

/** Bottom drawer with a single-choice list. Picking an option saves and closes. */
export function OptionDrawer<T extends string | number>({
  open,
  onOpenChange,
  title,
  description,
  options,
  value,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  options: readonly Option<T>[]
  value: T
  onSelect: (value: T) => void
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="rounded-t-3xl bg-card">
        <DrawerHeader className="px-5 pt-1 pb-3 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
          <DrawerTitle className="font-heading text-xl font-bold tracking-tight">{title}</DrawerTitle>
          {description ? <DrawerDescription className="text-left">{description}</DrawerDescription> : null}
        </DrawerHeader>
        <RadioGroup
          selectOnFocus={false}
          aria-label={title}
          className="flex flex-col gap-2 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]"
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
                  haptic("tap")
                  if (!selected) onSelect(o.value)
                  onOpenChange(false)
                }}
                className={cn(
                  "flex min-h-14 w-full items-center gap-4 rounded-2xl border px-5 py-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring active:scale-[0.99]",
                  selected ? "border-volt bg-volt/10" : "border-border bg-surface hover:border-foreground/20",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-heading text-base font-bold tracking-tight">{o.label}</span>
                  {o.hint ? <span className="text-sm text-muted-foreground">{o.hint}</span> : null}
                </span>
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                    selected ? "border-volt bg-volt text-volt-foreground" : "border-border text-transparent",
                  )}
                  aria-hidden="true"
                >
                  <Check className="size-4" strokeWidth={3} />
                </span>
              </button>
            )
          })}
        </RadioGroup>
      </DrawerContent>
    </Drawer>
  )
}
