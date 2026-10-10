"use client"

import { useEffect, useState } from "react"

const nowMs = () => Date.now()

/** Epoch ms, refreshed on an interval, for relative timestamps ("5 min ago"). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(nowMs)

  useEffect(() => {
    const id = window.setInterval(() => setNow(nowMs()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return now
}
