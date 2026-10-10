/**
 * Engine notes as codes. The coach request carries only ids, numbers and enums (see schema.ts), so
 * the card notes the engine wrote travel as a code: the client classifies the note text it already
 * has, and the server renders a fixed description from this file. A note the classifier does not
 * know is simply not sent; an unknown code from a newer client is not rendered.
 *
 * The same classification tells apply.ts which engine notes must survive a coach correction
 * (ramp-up and feeder sets, starting-load calibration, capped volume).
 */
import { BUILD_UP_NOTE, FEEDER_SET_NOTE, RAMP_UP_NOTE } from "@/lib/engine/duration"
import { FIRST_EXPOSURE_NOTE_PREFIX, FIRST_HOLD_NOTE_PREFIX } from "@/lib/engine/prescriptions"
import { FIND_BAND_PREFIX, FIND_WORKING_WEIGHT_PREFIX, STARTING_GUESS_NOTE } from "@/lib/engine/progression"
import { POSITION_STOP_PREFIX } from "@/lib/engine/slot-notes"

export const ENGINE_NOTE_CODES = [
  "ramp_up",
  "feeder_set",
  "starting_guess",
  "find_working_weight",
  // Coach round 2 (R04): the band-only version of "find your working weight".
  "find_working_band",
  "load_check",
  "maintenance",
  "capped_week",
  "stand_in_cap",
  "stand_in_limitation",
  "stand_in_unavailable",
  "rep_range_changed",
  "load_up",
  "load_hold",
  "load_from_history",
  "set_added",
  "at_ceiling",
  "reps_up",
  "repeat_target",
  // Coach round 2 (R06): first exposure to a bodyweight press or pull names the easier variation.
  "regress_if_short",
  // Coach round 2 (R12): a conditioning finisher's dose moved because every round was completed.
  "finisher_up",
  // Core spec C15: trunk work's "find your working weight": no build-up, the first set sets the load.
  "find_trunk_load",
  // Core spec C18: a core hold's first exposure or missed hold names the easier hold.
  "regress_hold",
  // Core spec C14: anti-movement trunk work has no RIR; each set stops before position slips.
  "position_stop",
] as const
export type EngineNoteCode = (typeof ENGINE_NOTE_CODES)[number]

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const FIND_BAND = escapeRegExp(FIND_BAND_PREFIX)
const REGRESS = `${escapeRegExp(FIRST_EXPOSURE_NOTE_PREFIX)} \\d+ reps, switch to `
const REGRESS_HOLD = `${escapeRegExp(FIRST_HOLD_NOTE_PREFIX)} \\d+ s with your hips level, switch to `
const FIND_TRUNK = `${escapeRegExp(FIND_WORKING_WEIGHT_PREFIX)}the first set sets the weight`
const POSITION_STOP = escapeRegExp(POSITION_STOP_PREFIX)
/**
 * The position-stop cue (core spec C14) is appended last to the card note (slot-notes.ts
 * composeSlotNote): it starts at a sentence boundary and runs to the end of the note.
 */
const POSITION_STOP_TAIL = new RegExp(`(^|\\s)${POSITION_STOP} .*$`)

/** A slot note without the position-stop cue appended to it, and the cue (null when absent). */
export function splitPositionStop(note: string): { lead: string; cue: string | null } {
  const match = POSITION_STOP_TAIL.exec(note)
  if (!match) return { lead: note, cue: null }
  return { lead: note.slice(0, match.index).trim(), cue: match[0].trim() }
}

/** Checked in order: the first match wins (a maintenance note is also a "Capped at" note). */
const SLOT_PATTERNS: readonly (readonly [EngineNoteCode, RegExp])[] = [
  ["find_working_band", new RegExp(`^${FIND_BAND}`)],
  ["find_trunk_load", new RegExp(`^${FIND_TRUNK}`)],
  ["find_working_weight", /^Find your working weight/],
  // progression.ts planLoad, for a logged load far above the starting estimate (F21).
  ["load_check", /^Check your logged weight/],
  ["maintenance", /^Capped at \d+ sets?: .* at this week's volume target/],
  ["capped_week", /^Capped at \d+ sets?:/],
  ["stand_in_cap", /is at this week's volume target; .* stands in\.$/],
  ["stand_in_limitation", /^Stand-in for .* flag rules out/],
  ["stand_in_unavailable", /^Stand-in for /],
  ["rep_range_changed", /^Rep range changed/],
  ["load_up", /^Up from /],
  ["load_hold", /^(Stay at |Same [\d.]+ (kg|lb);)/],
  ["load_from_history", /^Last time: .* added\.$/],
  // progression.ts progressFinisher (R12): checked before the generic set and reps codes.
  ["finisher_up", /^(Held the full \d+ s every round last time|Every round done last time)/],
  ["set_added", /one more set today\.$/],
  ["at_ceiling", /(ready for|lower each rep|slow the lowering|s rest between sets today)/],
  ["reps_up", /^(Top of the range|Full hold on every set|Held the full)/],
  ["repeat_target", /^(Same target as last time|Same \d+(–\d+)? (reps|s)\b|Aim for \d+ reps)/],
  ["regress_if_short", new RegExp(`^${REGRESS}`)],
  ["regress_hold", new RegExp(`^${REGRESS_HOLD}`)],
]

/** Fixed sentences the engine may join after a lead note (lib/engine/slot-notes.ts composeSlotNote). */
const FIXED_NOTES: readonly (readonly [EngineNoteCode, string])[] = [
  ["ramp_up", RAMP_UP_NOTE],
  // The ramp-up sentence on a starting estimate (R10): the same instruction.
  ["ramp_up", BUILD_UP_NOTE],
  ["feeder_set", FEEDER_SET_NOTE],
  ["starting_guess", STARTING_GUESS_NOTE],
]

/** Calibration notes that can follow a lead note or a ramp-up sentence. */
const TRAILING_PATTERNS: readonly (readonly [EngineNoteCode, RegExp])[] = [
  ["find_working_band", new RegExp(`(^|\\. )${FIND_BAND}`)],
  ["find_trunk_load", new RegExp(`(^|\\. )${FIND_TRUNK}`)],
  ["find_working_weight", /(^|\. )Find your working weight/],
  ["load_check", /(^|\. )Check your logged weight/],
  // A load held because its next step is a big jump (a kettlebell's next bell, a light dumbbell's
  // next step: progression.ts bigJumpHoldNote), kept after a cap, stand-in or ramp-up sentence.
  ["load_hold", /\. Stay at .*: the next (bell|step) /],
  ["regress_if_short", new RegExp(`(^|\\. )${REGRESS}`)],
  ["regress_hold", new RegExp(`(^|\\. )${REGRESS_HOLD}`)],
]

/**
 * A band note is also a "Find your working weight" note: the band code alone describes it. So is a
 * trunk note (core spec C15), which has no build-up sets.
 */
const IMPLIED: Partial<Record<EngineNoteCode, EngineNoteCode>> = { find_working_band: "find_working_weight", find_trunk_load: "find_working_weight" }

/**
 * The code for a slot note the engine wrote, or null for no note or one this file does not know.
 * A note made of several sentences (a cap or stand-in note, then the ramp-up instruction, then a
 * calibration note) is classified by its first one.
 */
export function engineNoteCode(note: string | null | undefined): EngineNoteCode | null {
  if (!note) return null
  // The position-stop cue is appended last (core spec C14): the note before it is classified as if
  // the cue were not there (several patterns are anchored at the end), and alone it is the lead.
  const { lead, cue } = splitPositionStop(note)
  if (!lead) return cue ? "position_stop" : null
  for (const [code, text] of FIXED_NOTES) if (lead.startsWith(text)) return code
  for (const [code, pattern] of SLOT_PATTERNS) if (pattern.test(lead)) return code
  return null
}

/** Every code in a slot note: the leading one first, then any fixed or calibration sentence joined after it. */
export function engineNoteCodes(note: string | null | undefined): EngineNoteCode[] {
  const lead = engineNoteCode(note)
  if (!note || !lead) return []
  const codes: EngineNoteCode[] = [lead]
  const add = (code: EngineNoteCode) => {
    if (codes.includes(code) || codes.some((c) => IMPLIED[c] === code)) return
    codes.push(code)
  }
  const { lead: rest, cue } = splitPositionStop(note)
  for (const [code, text] of FIXED_NOTES) if (rest.includes(text)) add(code)
  for (const [code, pattern] of TRAILING_PATTERNS) if (pattern.test(rest)) add(code)
  if (cue) add("position_stop")
  return codes
}

/** Whether a slot note asks the lifter to find the working load (any implement, bands included). */
export function findsWorkingWeight(note: string | null | undefined): boolean {
  const codes = engineNoteCodes(note)
  return codes.includes("find_working_weight") || codes.includes("find_working_band") || codes.includes("find_trunk_load")
}

/** Whether a coach cue is appended to this engine note rather than replacing it. */
export function keepsEngineNote(note: string | null | undefined): boolean {
  return engineNoteCodes(note).some((code) => KEPT_ENGINE_NOTES.has(code))
}

/** What each slot note tells the lifter, as the coach reads it. Server side only renders these. */
export const ENGINE_NOTE_TEXT: Record<EngineNoteCode, string> = {
  ramp_up: RAMP_UP_NOTE,
  feeder_set: FEEDER_SET_NOTE,
  starting_guess: STARTING_GUESS_NOTE,
  find_working_weight:
    "No load shown: the lifter finds the load in extra build-up sets (from light, or the empty bar) until the prescribed reps leave the target reps in reserve, then does every working set at that load and logs it.",
  find_working_band:
    "No load shown (band-only lift): the lifter starts with a light band and moves to a stronger one until the prescribed reps leave the target reps in reserve, then does the working sets with it; a heavier band or a step farther from the anchor progresses it.",
  load_check:
    "The last logged load is far above the starting estimate (possibly both dumbbells logged as one number): the card asks the lifter to check it, and the load is not progressed until confirmed.",
  maintenance:
    "Maintenance dose: this muscle group is at this week's set cap, so the lifter holds the load and keeps an extra rep in reserve.",
  capped_week: "Sets capped: this muscle group is near its weekly set cap.",
  stand_in_cap: "Stand-in: the slot's intended muscle group is at this week's set cap, so this exercise stands in.",
  stand_in_limitation: "Stand-in: an area the user protects rules out the slot's usual exercises.",
  stand_in_unavailable: "Stand-in: the slot's usual exercises are excluded or need equipment the user does not have.",
  rep_range_changed: "The rep range changed since the last session, so the load was translated through estimated 1RM.",
  load_up: "Load increased from the last session: every set reached the top of the range.",
  load_hold:
    "Load held from the last session: not every set reached the top of the range yet, or the next load step is a big jump (more than about 10%, such as the next dumbbell or bell), so the lifter owns the top of the range once more before moving up.",
  load_from_history: "Load carried over from the last logged session.",
  set_added: "Progression: one set added because reps or hold time are at the exercise's ceiling.",
  at_ceiling:
    "Reps, hold time and sets are at their ceiling: the card suggests a harder variation; without one, conditioning goals first shorten the rest, then the lowering slows by a second per session (the new tempo is on the card).",
  reps_up: "Progression: reps or hold time moved up because every set reached the top last session.",
  repeat_target: "Same target as the last session: a set fell short, so the prescription repeats.",
  finisher_up:
    "Conditioning progression: every round was completed last session, so one lever moved today: 5 s more work per round, else one more round, else 5 s less rest between rounds.",
  regress_if_short:
    "First session on this bodyweight variation: if the lifter cannot reach the bottom of the rep range, the card says to switch to an easier variation (named when one fits the user's equipment and limitations).",
  find_trunk_load:
    "No load shown (trunk work): there are no build-up sets; the first working set sets the load, one the lifter controls for every rep with a 2 s pause (to the target reps in reserve when the slot has an RIR, otherwise without losing position), kept for the remaining sets and logged.",
  regress_hold:
    "Core hold, first session on it or a missed hold last time: if the lifter cannot hold the prescribed time with the hips level, the card names an easier hold to switch to.",
  position_stop:
    "Anti-movement trunk work (anti-extension, anti-rotation, anti-lateral flexion, carries) has no RIR target: each set stops before the position slips (ribs flare, hips sag or twist, or a lean), 2-3 reps (about 10 s) early for beginners and 1-2 reps (about 5 s) for others; a rollout is never taken to failure.",
}

/**
 * Engine notes a coach_note is appended to rather than replacing: they set up the working sets
 * (ramp-up, feeder set, calibrating or checking a load), explain a volume cap or name an easier
 * variation. Progression and stand-in notes describe the engine's prescription, so the coach's
 * correction supersedes them.
 */
export const KEPT_ENGINE_NOTES: ReadonlySet<EngineNoteCode> = new Set<EngineNoteCode>([
  "ramp_up",
  "feeder_set",
  "starting_guess",
  "find_working_weight",
  "find_working_band",
  "load_check",
  "maintenance",
  "capped_week",
  // A way out when the reps are out of reach: a coach cue must not delete it (apply.ts keeps its
  // rep number in line with the coach's range).
  "regress_if_short",
  "find_trunk_load",
  // The core-hold version of the way out (core spec C18); apply.ts keeps its seconds in line.
  "regress_hold",
  // The effort instruction on null-RIR trunk work (core spec C14): never dropped for a coach cue.
  "position_stop",
])

export const WORKOUT_NOTE_CODES = [
  "rest_day",
  "light_day_cap",
  "light_day_unavailable",
  "limitation_no_direct",
  "limitation_stand_in",
  "few_matches",
  // Coach round 2 (R17): finishers are the week's only conditioning.
  "aerobic_gap",
  // Coach round 2 (R27): a flagged area emptied a support slot.
  "limitation_left_out",
] as const
export type WorkoutNoteCode = (typeof WORKOUT_NOTE_CODES)[number]

const WORKOUT_PATTERNS: readonly (readonly [WorkoutNoteCode, RegExp])[] = [
  ["rest_day", /^Rest day recommended/],
  ["light_day_cap", /^Light day: /],
  ["light_day_unavailable", /^Light day for /],
  ["limitation_no_direct", /^No direct .* flagged/],
  ["limitation_stand_in", /^Only stand-in .* flagged/],
  ["few_matches", /match your equipment, limitations and exclusions/],
  ["aerobic_gap", /^Aerobic activity: about \d+ min of conditioning this week/],
  ["limitation_left_out", /^Some .* work is left out while your .* flagged/],
]

export function workoutNoteCode(note: string): WorkoutNoteCode | null {
  for (const [code, pattern] of WORKOUT_PATTERNS) if (pattern.test(note)) return code
  return null
}

export const WORKOUT_NOTE_TEXT: Record<WorkoutNoteCode, string> = {
  rest_day:
    "Rest day recommended (the planned weekly sessions are done, or a long run of consecutive days). If the user trains, the session is reduced: minimum sets, one extra rep in reserve, no conditioning finisher.",
  light_day_cap: "Light day: some focus groups already reached this week's set cap, so the session trains groups that still have room.",
  light_day_unavailable: "Light day: some focus groups' usual lifts are excluded or need equipment the user does not have.",
  limitation_no_direct: "A focus group gets no direct work because of an area the user protects; the app suggests a professional assessment.",
  limitation_stand_in: "A focus group only gets stand-in work because of an area the user protects; the app suggests a professional assessment.",
  few_matches: "Few exercises match the user's equipment, limitations and exclusions, so the session is shorter than planned.",
  limitation_left_out:
    "Some support work (an accessory or isolation slot) is left out because of an area the user protects; the app suggests a professional assessment.",
  aerobic_gap:
    "Low aerobic work: the plan's finishers are its only conditioning this week, so the app tells the user the finisher is not their aerobic dose and suggests easy aerobic activity on off days, citing the WHO 2020 adult guidance of 150–300 minutes of moderate activity a week.",
}

export function isEngineNoteCode(code: string): code is EngineNoteCode {
  return (ENGINE_NOTE_CODES as readonly string[]).includes(code)
}

export function isWorkoutNoteCode(code: string): code is WorkoutNoteCode {
  return (WORKOUT_NOTE_CODES as readonly string[]).includes(code)
}
