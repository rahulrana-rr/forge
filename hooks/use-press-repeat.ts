"use client"

import { useCallback, useEffect, useRef } from "react"
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react"

interface Options {
  /** Milliseconds before auto-repeat starts. */
  delay?: number
  /** Milliseconds between repeats while held. */
  interval?: number
  disabled?: boolean
}

interface Timers {
  timeout: number | null
  interval: number | null
  release: (() => void) | null
}

function clear(timers: Timers) {
  if (timers.timeout != null) window.clearTimeout(timers.timeout)
  if (timers.interval != null) window.clearInterval(timers.interval)
  if (timers.release) {
    window.removeEventListener("pointerup", timers.release)
    window.removeEventListener("pointercancel", timers.release)
  }
  timers.timeout = null
  timers.interval = null
  timers.release = null
}

/**
 * Press-and-hold repeat for stepper buttons. Fires `step` once on pointer down, then repeatedly
 * while the pointer stays down. Keyboard activation (Enter/Space → click with detail 0) steps once.
 * Spread the returned handlers onto a <button>.
 */
export function usePressRepeat(step: () => void, { delay = 400, interval = 80, disabled = false }: Options = {}) {
  const stepRef = useRef(step)
  const timersRef = useRef<Timers>({ timeout: null, interval: null, release: null })

  useEffect(() => {
    stepRef.current = step
  }, [step])

  useEffect(() => {
    const timers = timersRef.current
    return () => clear(timers)
  }, [])

  const stop = useCallback(() => clear(timersRef.current), [])

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (disabled || e.button !== 0) return
      const timers = timersRef.current
      clear(timers)
      stepRef.current()
      const release = () => clear(timers)
      timers.release = release
      window.addEventListener("pointerup", release)
      window.addEventListener("pointercancel", release)
      timers.timeout = window.setTimeout(() => {
        timers.interval = window.setInterval(() => stepRef.current(), interval)
      }, delay)
    },
    [delay, disabled, interval],
  )

  const onClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      // detail === 0 means the click came from the keyboard; pointer clicks were handled on pointerdown.
      if (!disabled && e.detail === 0) stepRef.current()
    },
    [disabled],
  )

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
    // Prevent key auto-repeat from stacking with the native click.
    if (e.repeat && (e.key === "Enter" || e.key === " ")) e.preventDefault()
  }, [])

  const onContextMenu = useCallback((e: MouseEvent<HTMLButtonElement>) => e.preventDefault(), [])

  return { onPointerDown, onPointerLeave: stop, onClick, onKeyDown, onContextMenu }
}
