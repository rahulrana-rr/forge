/**
 * Client side: apply a validated coach review to today's workout. Replacements go through the
 * engine (replaceExercise with withExerciseId) so loads, notes and rests are rebuilt the same way
 * a manual swap would; the coach's prescription then overrides sets, reps, rest, RIR and tempo.
 * The coach's cue is appended to the engine's ramp-up, calibration and capped-volume notes, never
 * swapped for them (see mergedNote).
 */
import { estimateDurationMinutes, replaceExercise, type EngineInput, type Workout, type WorkoutExercise } from "@/lib/engine"
import { getExercise } from "@/lib/exercises"
import { newId } from "@/lib/ids"
import { engineNoteCode, engineNoteCodes, findsWorkingWeight, keepsEngineNote, splitPositionStop } from "./notes"
import type { CoachApprovedItem, CoachReview } from "./schema"

export type CoachChangeKind = "replaced" | "adjusted" | "removed" | "added"

export interface CoachChange {
  kind: CoachChangeKind
  slotId: string
  /** Exercise name before the change (replaced, adjusted, removed). */
  from?: string
  /** Exercise name after the change (replaced, added). */
  to?: string
  detail: string
}

/** "8–12", or one number for a single rep target ("6", never "6–6"). */
function repWords(reps: [number, number]): string {
  return reps[0] === reps[1] ? `${reps[0]}` : `${reps[0]}–${reps[1]}`
}

function fmtPrescription(e: Pick<WorkoutExercise, "sets" | "reps" | "durationSeconds" | "restSeconds">): string {
  const work = e.reps ? repWords(e.reps) : `${e.durationSeconds ?? 0}s`
  return `${e.sets} × ${work}, rest ${e.restSeconds}s`
}

function prescriptionFrom(item: CoachApprovedItem): Pick<WorkoutExercise, "sets" | "reps" | "durationSeconds" | "restSeconds" | "rir" | "tempo"> {
  return {
    sets: item.sets,
    reps: item.reps_min != null && item.reps_max != null ? [item.reps_min, item.reps_max] : null,
    durationSeconds: item.duration_seconds,
    restSeconds: item.rest_seconds,
    rir: item.rir,
    tempo: item.tempo,
  }
}

type FinalPrescription = Pick<WorkoutExercise, "sets" | "reps" | "durationSeconds" | "rir">

function sameReps(a: [number, number] | null, b: [number, number] | null): boolean {
  return (a?.join("-") ?? "") === (b?.join("-") ?? "")
}

/** The first-exposure regression sentence (prescriptions.ts firstExposureNote), and its rep count. */
const REGRESS_SENTENCE = /(^|\s)If you cannot reach \d+ reps, switch to [^.]*\./
const REGRESS_REPS = /(If you cannot reach )\d+ reps/
/** The core-hold regression sentence (prescriptions.ts firstHoldNote, core spec C18), and its seconds. */
const REGRESS_HOLD_SENTENCE = /(^|\s)If you cannot hold \d+ s with your hips level, switch to [^.]*\./
const REGRESS_HOLD_SECONDS = /(If you cannot hold )\d+ s/

/** The "until 8–12 reps leave about 2 in reserve" clause of a find-your-working-weight note. */
const RESERVE_CLAUSE = /until .* reps leave about \d+ in reserve/

function joinNotes(...parts: (string | null | undefined)[]): string | null {
  return parts.filter((p): p is string => !!p).join(" ") || null
}

/**
 * The engine's note for a slot, brought in line with the prescription the coach approved, or null
 * when it no longer applies. Notes never contradict the card: a "Capped at 2 sets" note follows
 * the coach's set count, the find-your-working-weight note its reps and RIR, the first-exposure
 * regression note its bottom rep count, and a progression note about reps or hold time is dropped
 * once the coach changed them.
 */
function engineNoteFor(base: WorkoutExercise, final: FinalPrescription): string | null {
  if (!base.note) return null
  // The position-stop cue (core spec C14) is the effort instruction on null-RIR trunk work: it holds
  // whatever the coach changed, so only the note before it is brought in line.
  const { lead, cue } = splitPositionStop(base.note)
  return joinNotes(leadNoteFor(lead || null, base, final), cue)
}

function leadNoteFor(note: string | null, base: WorkoutExercise, final: FinalPrescription): string | null {
  if (!note) return null
  const code = engineNoteCode(note)
  if (code === "capped_week" || code === "maintenance") {
    return final.sets === base.sets ? note : note.replace(/^Capped at \d+ sets?/, `Capped at ${final.sets} set${final.sets === 1 ? "" : "s"}`)
  }
  // A band-only lift's note (find_working_band) carries the same "until … in reserve" clause.
  if (findsWorkingWeight(note)) {
    if (!final.reps) {
      const lead = code === "find_working_weight" || code === "find_working_band" || code === "find_trunk_load"
      return lead ? null : note.replace(/ ?Find your working weight: .*$/, "") || null
    }
    if (sameReps(base.reps, final.reps) && base.rir === final.rir) return note
    // Anti-movement trunk work is held to position, not to reps in reserve (core spec C14): its note
    // ("… without losing position") names no rep window or reserve, so it fits any approved one.
    if (!RESERVE_CLAUSE.test(note)) return note
    // Same reserve rule as progression.ts planLoad: never less than 2 for a load being found.
    const rir = Math.max(2, final.rir ?? 3)
    return note.replace(RESERVE_CLAUSE, `until ${repWords(final.reps)} reps leave about ${rir} in reserve`)
  }
  // "If you cannot reach 8 reps, switch to …" names the bottom of the range: it follows the coach's.
  if (engineNoteCodes(note).includes("regress_if_short")) {
    if (!final.reps) return note.replace(REGRESS_SENTENCE, "").trim() || null
    return sameReps(base.reps, final.reps) ? note : note.replace(REGRESS_REPS, `$1${final.reps[0]} reps`)
  }
  // "If you cannot hold 30 s with your hips level, switch to …" names today's hold: it follows the coach's.
  if (engineNoteCodes(note).includes("regress_hold")) {
    if (final.durationSeconds == null) return note.replace(REGRESS_HOLD_SENTENCE, "").trim() || null
    return note.replace(REGRESS_HOLD_SECONDS, `$1${final.durationSeconds} s`)
  }
  const workChanged = !sameReps(base.reps, final.reps) || (base.durationSeconds ?? null) !== (final.durationSeconds ?? null)
  if ((code === "reps_up" || code === "repeat_target" || code === "set_added" || code === "at_ceiling") && workChanged) return null
  return note
}

/**
 * The card note after a coach review. Without a coach cue the engine's note stays (adjusted to the
 * approved prescription). With one, notes that set up the working sets or explain a cap (ramp-up,
 * feeder set, starting-load calibration, capped volume) or give a way out (the first-exposure
 * regression) stay first and the cue follows: a coach cue must never silently delete a ramp-up
 * instruction. The position-stop cue on anti-movement trunk work (core spec C14) always stays.
 * Other engine notes give way to the cue.
 */
function mergedNote(base: WorkoutExercise, final: FinalPrescription, coachNote: string | null): string | null {
  const engineNote = engineNoteFor(base, final)
  if (!coachNote) return engineNote
  if (!engineNote) return coachNote
  // The position-stop cue on null-RIR trunk work always stays (core spec C14); the sentences before
  // it stay when they are kept notes.
  const { lead, cue } = splitPositionStop(engineNote)
  const keptLead = lead && keepsEngineNote(splitPositionStop(base.note ?? "").lead) && !engineNote.includes(coachNote) ? lead : null
  return joinNotes(keptLead, cue, coachNote)
}

function samePrescription(a: WorkoutExercise, b: ReturnType<typeof prescriptionFrom>): boolean {
  return (
    a.sets === b.sets &&
    (a.reps?.join("-") ?? "") === (b.reps?.join("-") ?? "") &&
    (a.durationSeconds ?? null) === (b.durationSeconds ?? null) &&
    a.restSeconds === b.restSeconds &&
    (a.rir ?? null) === (b.rir ?? null)
  )
}

export function applyCoachReview(
  workout: Workout,
  review: CoachReview,
  input: EngineInput,
): { workout: Workout; changes: CoachChange[] } {
  const changes: CoachChange[] = []
  const bySlot = new Map(workout.exercises.map((e) => [e.slotId, e]))
  const kept = new Set<string>()
  const next: WorkoutExercise[] = []
  let working = workout

  for (const item of review.approved_workout) {
    const original = item.slot_id ? bySlot.get(item.slot_id) : undefined
    const rx = prescriptionFrom(item)

    if (!original) {
      const ex = getExercise(item.exercise_id)
      if (!ex) continue
      const slot: WorkoutExercise = {
        slotId: newId(),
        exerciseId: ex.id,
        phase: item.phase,
        role: item.role,
        ...rx,
        recommendedWeightKg: null,
        weightSource: null,
        note: item.coach_note,
        replacedFromExerciseId: null,
      }
      next.push(slot)
      changes.push({ kind: "added", slotId: slot.slotId, to: ex.name, detail: fmtPrescription(slot) })
      continue
    }

    kept.add(original.slotId)
    let base = original
    if (item.exercise_id !== original.exerciseId) {
      const swapped = replaceExercise(working, original.slotId, input, { withExerciseId: item.exercise_id })
      const slot = swapped?.exercises.find((e) => e.slotId === original.slotId)
      if (swapped && slot && slot.exerciseId === item.exercise_id) {
        working = swapped
        base = slot
        changes.push({
          kind: "replaced",
          slotId: original.slotId,
          from: getExercise(original.exerciseId)?.name,
          to: getExercise(item.exercise_id)?.name,
          detail: fmtPrescription({ ...slot, ...rx }),
        })
      }
    } else if (!samePrescription(original, rx)) {
      changes.push({
        kind: "adjusted",
        slotId: original.slotId,
        from: getExercise(original.exerciseId)?.name,
        detail: `${fmtPrescription(original)} → ${fmtPrescription({ ...original, ...rx })}`,
      })
    }

    next.push({
      ...base,
      phase: original.phase,
      role: item.role,
      ...rx,
      // Keep the engine's tempo when the coach has no opinion on it.
      tempo: rx.tempo ?? base.tempo,
      note: mergedNote(base, rx, item.coach_note),
    })
  }

  for (const e of workout.exercises) {
    if (!kept.has(e.slotId)) {
      changes.push({ kind: "removed", slotId: e.slotId, from: getExercise(e.exerciseId)?.name, detail: "Removed by the coach" })
    }
  }

  const updated: Workout = { ...workout, exercises: next }
  updated.estimatedMinutes = estimateDurationMinutes(updated)
  return { workout: updated, changes }
}
