"use client"

import { useEffect, useState, type RefObject } from "react"

/**
 * Rendered width of an element in CSS pixels, kept in step with a ResizeObserver.
 * 0 until the first measurement, so charts can size their SVG in real pixels (text stays crisp
 * instead of scaling with a viewBox).
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    // ResizeObserver delivers an initial observation on observe(), so no synchronous read is needed.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return width
}
