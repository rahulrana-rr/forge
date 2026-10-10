"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalendarDays, Dumbbell, TrendingUp, UserRound, type LucideIcon } from "lucide-react"

import { useWorkoutStore } from "@/lib/store"
import { cn } from "@/lib/utils"

interface Tab {
  href: string
  label: string
  icon: LucideIcon
}

const TABS: Tab[] = [
  { href: "/today", label: "Today", icon: Dumbbell },
  { href: "/progress", label: "Progress", icon: TrendingUp },
  { href: "/history", label: "History", icon: CalendarDays },
  { href: "/profile", label: "Profile", icon: UserRound },
]

/**
 * Four-tab bottom navigation. 56px tall plus the home-indicator inset, glass background.
 * Slides out of view on Today while a workout is active or paused so the swipe deck owns the
 * thumb zone. Every other tab keeps it, so the user can always get back to the workout.
 */
export function BottomNav() {
  const pathname = usePathname()
  const status = useWorkoutStore((s) => s.active?.status)
  const onToday = pathname === "/today" || pathname.startsWith("/today/")
  const hidden = onToday && (status === "active" || status === "paused")

  return (
    <nav
      aria-label="Primary"
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      className={cn(
        "glass fixed inset-x-0 bottom-0 z-40 border-t border-border pb-safe transition-transform duration-300 ease-out-expo motion-reduce:transition-none",
        hidden ? "pointer-events-none translate-y-full" : "translate-y-0"
      )}
    >
      <ul className="mx-auto flex h-14 w-full max-w-lg items-stretch">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <li key={href} className="flex flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                tabIndex={hidden ? -1 : undefined}
                className={cn(
                  "group flex flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[0.6875rem] font-semibold tracking-wide transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset",
                  active ? "text-volt-ink" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active && "bg-volt/12"
                  )}
                >
                  <Icon className="size-[22px]" strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
                </span>
                <span>{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
