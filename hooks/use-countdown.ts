"use client"

import { useCallback, useSyncExternalStore } from "react"

import type { RestTimerState } from "@/lib/store/types"

function remainingAt(timer: RestTimerState, nowMs: number): number {
  if (timer.totalSeconds == null) return 0
  if (timer.running && timer.endsAt != null) return Math.max(0, Math.ceil((timer.endsAt - nowMs) / 1000))
  if (timer.pausedRemaining != null) return Math.max(0, Math.ceil(timer.pausedRemaining))
  return 0
}

const noop = () => {}

/**
 * Seconds remaining on the store's rest timer. The timer is `endsAt`-based so the value is always
 * correct after a background tab wakes up; a 250ms interval only runs while the timer is running.
 * Implemented with useSyncExternalStore so only the subscriber re-renders on each tick.
 */
export function useCountdown(timer: RestTimerState): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!timer.running || timer.endsAt == null) return noop
      const id = window.setInterval(onChange, 250)
      return () => window.clearInterval(id)
    },
    [timer],
  )
  const getSnapshot = useCallback(() => remainingAt(timer, Date.now()), [timer])
  const getServerSnapshot = useCallback(
    () => (timer.running ? (timer.totalSeconds ?? 0) : remainingAt(timer, 0)),
    [timer],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
