"use client"

import { useState } from "react"

import { todayKey } from "@/lib/dates"

/** Today's local date key, fixed for the life of the component (screens remount on navigation). */
export function useTodayKey(): string {
  const [today] = useState(() => todayKey())
  return today
}
