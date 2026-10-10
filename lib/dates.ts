/** Local calendar helpers. Date keys are "YYYY-MM-DD" in the user's local timezone. */

export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function todayKey(): string {
  return dateKey(new Date())
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function addDays(key: string, days: number): string {
  const d = parseDateKey(key)
  d.setDate(d.getDate() + days)
  return dateKey(d)
}

/** Whole days between two keys (b - a). */
export function daysBetween(a: string, b: string): number {
  const ms = parseDateKey(b).getTime() - parseDateKey(a).getTime()
  return Math.round(ms / 86_400_000)
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }
  return `${m}:${String(sec).padStart(2, "0")}`
}

export function formatMinutes(totalSeconds: number): string {
  const m = Math.round(totalSeconds / 60)
  return `${m} min`
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "Tue, 7 Oct" */
export function formatDateKey(key: string): string {
  const d = parseDateKey(key)
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** "Today", "Yesterday", or formatDateKey. */
export function formatRelativeDateKey(key: string, today: string = todayKey()): string {
  const diff = daysBetween(key, today)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  return formatDateKey(key)
}
