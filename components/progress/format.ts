/**
 * Display formatters shared by the Progress and History screens.
 * Weights arrive in kilograms and are converted at this edge with lib/units.
 */
import type { PersonalRecord, PersonalRecordKind, SetLog, Units } from "@/lib/domain/types"
import { dateKey, formatDuration, parseDateKey } from "@/lib/dates"
import { getExercise } from "@/lib/exercises"
import { formatWeight, fromKg } from "@/lib/units"

export const RECORD_KIND_LABELS: Record<PersonalRecordKind, string> = {
  weight: "Heaviest set",
  reps_at_weight: "Reps at weight",
  e1rm: "Est. 1RM",
  volume: "Set volume",
}

/** Display name for an exercise id; falls back to a readable form of the id if it left the library. */
export function exerciseName(id: string): string {
  return getExercise(id)?.name ?? id.replace(/-/g, " ")
}

export function exerciseHref(id: string): string {
  return `/exercise/${getExercise(id)?.slug ?? id}`
}

/** 12450 → "12.5k", 980 → "980". */
export function compactNumber(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M`
  if (abs >= 1000) return `${trimZero((n / 1000).toFixed(1))}k`
  return String(Math.round(n))
}

function trimZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s
}

/** Total volume (stored kg) in the user's units, compact. */
export function formatVolume(kg: number, units: Units, withUnit = true): string {
  const text = compactNumber(fromKg(kg, units))
  return withUnit ? `${text} ${units}` : text
}

export function formatRecordValue(record: PersonalRecord, units: Units): string {
  switch (record.kind) {
    case "weight":
      return record.reps ? `${formatWeight(record.value, units)} × ${record.reps}` : formatWeight(record.value, units)
    case "reps_at_weight":
      return `${record.value} reps @ ${formatWeight(record.weightKg, units)}`
    case "e1rm":
    case "volume":
      return formatWeight(record.value, units)
  }
}

export function formatSeconds(seconds: number): string {
  return seconds >= 60 ? formatDuration(seconds) : `${Math.round(seconds)} s`
}

/** "55 kg × 8", "8 reps", "45 s", "8 reps · 20 kg assist". */
export function formatSetLine(set: SetLog, units: Units): string {
  const reps = set.reps != null && set.reps > 0 ? set.reps : null
  const w = set.weightKg
  if (w != null && w > 0 && reps != null) return `${formatWeight(w, units)} × ${reps}`
  if (w != null && w < 0 && reps != null) return `${reps} reps · ${formatWeight(-w, units)} assist`
  if (reps != null) return `${reps} reps`
  if (set.durationSeconds != null && set.durationSeconds > 0) return formatSeconds(set.durationSeconds)
  if (w != null && w > 0) return formatWeight(w, units)
  return "—"
}

/** "55 kg × 8, 8, 7 · 60 kg × 6" over completed sets; "BW" for unloaded reps. */
export function formatSetsCompact(sets: SetLog[], units: Units): string {
  const done = sets.filter((s) => s.completed)
  if (!done.length) return "No sets logged"
  const groups: { head: string; reps: string[] }[] = []
  for (const set of done) {
    const reps = set.reps != null && set.reps > 0 ? set.reps : null
    if (reps == null) {
      groups.push({ head: formatSetLine(set, units), reps: [] })
      continue
    }
    const w = set.weightKg
    const head =
      w != null && w > 0 ? formatWeight(w, units) : w != null && w < 0 ? `${formatWeight(-w, units)} assist` : "BW"
    const last = groups[groups.length - 1]
    if (last && last.head === head && last.reps.length) last.reps.push(String(reps))
    else groups.push({ head, reps: [String(reps)] })
  }
  return groups.map((g) => (g.reps.length ? `${g.head} × ${g.reps.join(", ")}` : g.head)).join(" · ")
}

/** Epley estimated one-rep max in kg: w × (1 + reps / 30). A single rep is the lift itself. */
export function epley1rm(weightKg: number, reps: number): number {
  if (!(weightKg > 0) || !(reps > 0)) return 0
  if (reps === 1) return weightKg
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10
}

/** Local calendar key for an ISO timestamp (an ISO string sliced to its date would be UTC). */
export function isoToDateKey(iso: string): string {
  return dateKey(new Date(iso))
}

const MONTH_YEAR = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" })
const MONTH_SHORT = new Intl.DateTimeFormat("en", { month: "short" })

/** "October 2026" */
export function monthLabel(key: string): string {
  return MONTH_YEAR.format(parseDateKey(key))
}

/** "Oct" */
export function monthShort(key: string): string {
  return MONTH_SHORT.format(parseDateKey(key))
}

/** "YYYY-MM" */
export function monthKey(key: string): string {
  return key.slice(0, 7)
}
