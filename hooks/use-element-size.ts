"use client"

import { useCallback, useState } from "react"

export interface ElementSize {
  width: number
  height: number
}

/**
 * Measures an element with ResizeObserver. Attach the returned `ref` to the element.
 * Size is 0×0 until the element mounts and the first observation fires.
 */
export function useElementSize<T extends HTMLElement = HTMLDivElement>(): {
  ref: (node: T | null) => void
  size: ElementSize
} {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })

  const ref = useCallback((node: T | null): (() => void) | undefined => {
    if (!node || typeof ResizeObserver === "undefined") return undefined
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { ref, size }
}
