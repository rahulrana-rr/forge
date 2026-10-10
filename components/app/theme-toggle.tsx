"use client"

import { useSyncExternalStore } from "react"
import { useTheme } from "next-themes"
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react"

import { RadioGroup } from "@/components/app/radio-group"
import { cn } from "@/lib/utils"

type ThemeOption = "light" | "dark" | "system"

const OPTIONS: { value: ThemeOption; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

/** Segmented Light / Dark / System control backed by next-themes. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot)

  // Until mounted the server does not know the stored theme; render with nothing selected.
  const current: ThemeOption | null = mounted && isThemeOption(theme) ? theme : null

  return (
    <RadioGroup
      aria-label="Appearance"
      className={cn("grid h-12 grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1", className)}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = current === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring",
              selected ? "bg-background text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className={cn("size-4", selected && "text-volt-ink")} aria-hidden="true" />
            {label}
          </button>
        )
      })}
    </RadioGroup>
  )
}

// Hydration-safe "has mounted" flag without a setState-in-effect cascade.
function subscribeNoop() {
  return () => {}
}
function getClientSnapshot() {
  return true
}
function getServerSnapshot() {
  return false
}

function isThemeOption(value: string | undefined): value is ThemeOption {
  return value === "light" || value === "dark" || value === "system"
}
