/**
 * Server side: never trust the model's corrections blindly. Every approved item must reference a
 * library exercise that was offered to the coach and that passes the user's equipment, level and
 * limitation filters; numbers are clamped to plausible ranges. Anything dropped is reported so the
 * UI can say so instead of silently changing the plan.
 */
import { isAntiMovementTrunk } from "@/lib/engine/prescriptions"
import { getExercise } from "@/lib/exercises"
import { DIFFICULTY_RANK, type Difficulty, type Exercise } from "@/lib/exercises/types"
import type { CoachApprovedItem, CoachRequest, CoachReview } from "./schema"

const PHASE_ORDER = { warmup: 0, main: 1, cooldown: 2 } as const

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

function passesProfile(ex: Exercise, profile: CoachRequest["profile"]): boolean {
  const equipmentOk = ex.equipment.every((e) => profile.equipment.includes(e))
  const levelOk = DIFFICULTY_RANK[ex.difficulty] <= DIFFICULTY_RANK[profile.experience as Difficulty]
  const limitsOk = !ex.contraindications.some((a) => profile.limitations.includes(a))
  return equipmentOk && levelOk && limitsOk
}

function isTimed(ex: Exercise): boolean {
  return ex.loadType === "timed" || ex.loadType === "distance"
}

export interface SanitizedReview {
  review: CoachReview
  rejectedChanges: string[]
}

export function sanitizeReview(req: CoachRequest, review: CoachReview): SanitizedReview {
  const rejected: string[] = []
  const slots = new Map(req.workout.exercises.map((s) => [s.slotId, s]))
  const allowed = new Set<string>()
  for (const s of req.workout.exercises) {
    allowed.add(s.exerciseId)
    s.alternatives.forEach((a) => allowed.add(a))
  }

  const seenSlots = new Set<string>()
  const items: CoachApprovedItem[] = []
  for (const raw of review.approved_workout) {
    let item = { ...raw }
    const original = item.slot_id ? slots.get(item.slot_id) : undefined
    if (item.slot_id && !original) item = { ...item, slot_id: null }
    if (item.slot_id) {
      if (seenSlots.has(item.slot_id)) {
        rejected.push(`Ignored a second entry for ${item.exercise_name}.`)
        continue
      }
      seenSlots.add(item.slot_id)
    }

    let ex = getExercise(item.exercise_id)
    const swapRejected = !ex || !allowed.has(item.exercise_id) || (ex && original?.exerciseId !== item.exercise_id && !passesProfile(ex, req.profile))
    if (swapRejected) {
      if (original) {
        const kept = getExercise(original.exerciseId)
        rejected.push(`Kept ${kept?.name ?? original.exerciseId}: the suggested ${item.exercise_name} is not an exercise the app can offer you.`)
        ex = kept
        item = { ...item, exercise_id: original.exerciseId, exercise_name: kept?.name ?? item.exercise_name }
      } else {
        rejected.push(`Skipped the suggested addition ${item.exercise_name}: it is not an exercise the app can offer you.`)
        continue
      }
    }
    if (!ex) continue

    const phase = original?.phase ?? item.phase
    const maxSets = phase === "main" ? 6 : 3
    const sets = clamp(item.sets, 1, maxSets)
    let repsMin: number | null = null
    let repsMax: number | null = null
    let duration: number | null = null
    if (isTimed(ex)) {
      duration = clamp(item.duration_seconds ?? original?.durationSeconds ?? ex.durationRange?.[0] ?? 30, 5, 3600)
    } else {
      const fallback = original?.reps ?? ex.repRange ?? [8, 12]
      repsMin = clamp(item.reps_min ?? fallback[0], 1, 50)
      repsMax = clamp(item.reps_max ?? fallback[1], 1, 50)
      if (repsMin > repsMax) [repsMin, repsMax] = [repsMax, repsMin]
    }
    items.push({
      ...item,
      phase,
      sets,
      reps_min: repsMin,
      reps_max: repsMax,
      duration_seconds: duration,
      rest_seconds: clamp(item.rest_seconds, 0, 300),
      // Anti-movement trunk work is stopped on position, never on reps in reserve (core spec C14): a
      // failed rollout ends in loaded lumbar extension. The card's position-stop cue stays (apply.ts).
      rir: item.rir == null || isAntiMovementTrunk(ex) ? null : clamp(item.rir, 0, 4),
      tempo: item.tempo && /^[0-9X]-[0-9X]-[0-9X]-[0-9X]$/i.test(item.tempo) ? item.tempo : (original?.tempo ?? null),
      coach_note: item.coach_note ? item.coach_note.slice(0, 160) : null,
    })
  }

  items.sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase])

  // A correction that leaves no main work is not a usable workout: keep the original plan.
  if (!items.some((i) => i.phase === "main")) {
    rejected.push("The coach's corrected plan had no main exercises, so the original plan was kept.")
    return { review: { ...review, approved_workout: originalAsApproved(req) }, rejectedChanges: rejected }
  }

  return {
    review: { ...review, overall_score: clamp(review.overall_score, 0, 100), approved_workout: items },
    rejectedChanges: rejected,
  }
}

function originalAsApproved(req: CoachRequest): CoachApprovedItem[] {
  return req.workout.exercises.map((s) => ({
    slot_id: s.slotId,
    exercise_id: s.exerciseId,
    exercise_name: getExercise(s.exerciseId)?.name ?? s.exerciseId,
    phase: s.phase,
    role: s.role as CoachApprovedItem["role"],
    sets: s.sets,
    reps_min: s.reps?.[0] ?? null,
    reps_max: s.reps?.[1] ?? null,
    duration_seconds: s.durationSeconds,
    rest_seconds: s.restSeconds,
    rir: s.rir,
    tempo: s.tempo,
    coach_note: null,
  }))
}
