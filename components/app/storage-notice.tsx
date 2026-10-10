"use client"

import { useSyncExternalStore } from "react"
import { Smartphone } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * True in an iOS/iPadOS browser tab (not an app added to the Home Screen). Safari may clear data
 * a site stored on the device after 7 days of use without a visit, and navigator.storage.persist()
 * does not reliably protect a tab there.
 */
function isIosBrowserTab(): boolean {
  if (typeof window === "undefined") return false
  const nav = navigator as Navigator & { standalone?: boolean }
  const ios =
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    // iPadOS reports itself as a Mac with touch.
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1)
  if (!ios) return false
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    nav.standalone === true
  return !standalone
}

const subscribe = () => () => {}

/**
 * Guest-only nudge for iOS Safari tabs: sign in or add FORGE to the Home Screen so workouts are
 * not lost when Safari clears site data. Renders nothing elsewhere (and on the server).
 */
export function StorageNotice({ className }: { className?: string }) {
  const show = useSyncExternalStore(subscribe, isIosBrowserTab, () => false)
  if (!show) return null
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-2xl bg-surface-2 p-3 text-sm text-muted-foreground",
        className
      )}
    >
      <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        Safari may clear workouts stored on this device after 7 days without a
        visit. Sign in, or add FORGE to your Home Screen (Share › Add to Home
        Screen), to keep them.
      </span>
    </p>
  )
}
