/** Haptic feedback on supported devices (Android Chrome; iOS Safari ignores vibrate). Always safe to call. */
type Pattern = "tap" | "success" | "warning" | "tick"

const PATTERNS: Record<Pattern, number | number[]> = {
  tap: 10,
  success: [12, 40, 18],
  warning: [20, 30, 20],
  tick: 6,
}

export function haptic(pattern: Pattern = "tap"): void {
  if (typeof navigator === "undefined") return
  try {
    navigator.vibrate?.(PATTERNS[pattern])
  } catch {
    // ignore
  }
}
