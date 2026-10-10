"use client"

import { useSyncExternalStore } from "react"

export interface ViewportSize {
  width: number
  height: number
}

const SERVER_SIZE: ViewportSize = { width: 0, height: 0 }
let cached: ViewportSize = SERVER_SIZE

function read(): ViewportSize {
  const width = window.innerWidth
  const height = window.visualViewport?.height ?? window.innerHeight
  if (cached.width !== width || cached.height !== height) cached = { width, height }
  return cached
}

function subscribe(onChange: () => void) {
  window.addEventListener("resize", onChange)
  window.addEventListener("orientationchange", onChange)
  window.visualViewport?.addEventListener("resize", onChange)
  return () => {
    window.removeEventListener("resize", onChange)
    window.removeEventListener("orientationchange", onChange)
    window.visualViewport?.removeEventListener("resize", onChange)
  }
}

/** Live viewport size. Returns 0×0 on the server and during hydration. */
export function useViewportSize(): ViewportSize {
  return useSyncExternalStore(subscribe, read, () => SERVER_SIZE)
}
