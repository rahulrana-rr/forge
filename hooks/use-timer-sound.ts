"use client"

import { useSyncExternalStore } from "react"

/**
 * Rest-timer chime preference, shared by the RestTimer and the Profile appearance section.
 * Stored in localStorage as the string "true" | "false"; a missing key means enabled.
 * Per-device, never synced.
 */
export const TIMER_SOUND_KEY = "forge:timer-sound"
const CHANGE_EVENT = "forge:timer-sound-change"

export function readTimerSound(): boolean {
  try {
    return window.localStorage.getItem(TIMER_SOUND_KEY) !== "false"
  } catch {
    return true
  }
}

export function writeTimerSound(enabled: boolean): void {
  try {
    window.localStorage.setItem(TIMER_SOUND_KEY, enabled ? "true" : "false")
  } catch {
    // Storage unavailable (private mode); the toggle still reflects the in-memory event below.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange)
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}

function serverSnapshot(): boolean {
  return true
}

export function useTimerSound(): [
  enabled: boolean,
  setEnabled: (enabled: boolean) => void,
] {
  const enabled = useSyncExternalStore(
    subscribe,
    readTimerSound,
    serverSnapshot
  )
  return [enabled, writeTimerSound]
}
