"use client"

import { useId, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import type { Units } from "@/lib/domain/types"
import { haptic } from "@/lib/haptics"
import { formatWeight, kgToLb, toKg } from "@/lib/units"
import { cn } from "@/lib/utils"

import { WEIGHT_MAX_KG, WEIGHT_MIN_KG } from "./options"

/**
 * Parses the raw input in the given units and returns kg, or null when not a usable number.
 * Rounds to 0.1 in the user's units before converting, so 150 lb is stored as exactly 150 lb
 * and displays as 150 again (rounding the kg value instead drifts to 149.9).
 */
function parseWeightKg(input: string, units: Units): number | null {
  const n = Number.parseFloat(input.replace(",", "."))
  if (!Number.isFinite(n) || n <= 0) return null
  return toKg(Math.round(n * 10) / 10, units)
}

/** Bottom drawer for editing body weight in the user's units. Mount with a fresh key per edit. */
export function WeightDrawer({
  open,
  onOpenChange,
  weightKg,
  units,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  weightKg: number
  units: Units
  onSave: (kg: number) => void
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const messageId = `${inputId}-message`
  const [value, setValue] = useState(() => formatWeight(weightKg, units, false))
  const parsed = parseWeightKg(value, units)
  const valid = parsed != null && parsed >= WEIGHT_MIN_KG && parsed <= WEIGHT_MAX_KG
  const min = units === "kg" ? WEIGHT_MIN_KG : Math.round(kgToLb(WEIGHT_MIN_KG))
  const max = units === "kg" ? WEIGHT_MAX_KG : Math.round(kgToLb(WEIGHT_MAX_KG))

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="rounded-t-3xl bg-card" initialFocus={inputRef}>
        {/* noValidate: the range check below is the only rule; native step validation would
            silently block Save for values such as 80.2 kg. */}
        <form
          className="flex flex-col"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid || parsed == null) return
            haptic("success")
            onSave(parsed)
            onOpenChange(false)
          }}
        >
          <DrawerHeader className="px-5 pt-1 pb-3 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
            <DrawerTitle className="font-heading text-xl font-bold tracking-tight">Body weight</DrawerTitle>
            <DrawerDescription className="text-left">Used for bodyweight loads and the calorie estimate.</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-4 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">
            <div
              className={cn(
                "surface-card flex items-center gap-3 rounded-3xl px-5 py-4 transition-[border-color,box-shadow] focus-within:border-volt focus-within:shadow-volt",
                !valid && "border-destructive focus-within:border-destructive focus-within:shadow-none",
              )}
            >
              <label htmlFor={inputId} className="sr-only">
                Body weight in {units === "kg" ? "kilograms" : "pounds"}
              </label>
              <input
                id={inputId}
                ref={inputRef}
                type="number"
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                min={min}
                max={max}
                step="any"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={!valid || undefined}
                aria-describedby={messageId}
                className="text-stat w-full min-w-0 flex-1 bg-transparent text-4xl font-semibold text-foreground outline-none placeholder:text-muted-foreground/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="text-lg font-bold text-muted-foreground uppercase">{units}</span>
            </div>
            <p id={messageId} className={cn("text-sm", valid ? "text-muted-foreground" : "font-medium text-destructive")}>
              {valid ? "Switch units under Appearance." : `Enter a weight between ${min} and ${max} ${units}.`}
            </p>
            <Button
              type="submit"
              disabled={!valid}
              className="h-12 rounded-2xl bg-volt text-base font-semibold text-volt-foreground hover:bg-volt/90"
            >
              Save
            </Button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
