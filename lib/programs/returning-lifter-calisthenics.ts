/**
 * "Return to strength: muscle + calisthenics (7 weeks)": a fixed, coach-approved block for a
 * trained lifter coming back after a break. Goals: muscle, calisthenics control, endurance, speed.
 * Assumes a full gym (pull-up bar, dip station, wall space), 60-65 minute sessions and no injuries.
 *
 * Every exercise, set, rep, rest, RIR, week rule, gate and note below encodes the approved plan;
 * change the programming only through a new coach review. The week rules are written out per item
 * (byWeek) by the helpers below, so each card shows exactly what that week prescribes:
 * - weeks 1-2 (re-entry): 2 working sets per lift at RIR 3 (the plan's 3-4; trap-bar deadlift
 *   2 × 5 at RIR 4), no overhead press, box pistols from week 2, skill holds 3 easy sets;
 * - week 3: full sets, compounds at RIR 3 (the plan's 2-3), isolation at RIR 2 (the plan's 1-2);
 * - weeks 4-6: the day's listed prescription (compounds at RIR 2);
 * - week 7 (deload): 3-set lifts drop to 2 sets and 2-set lifts to 1, at RIR 4; sprints 3 × 20 m
 *   at 80%, jumps 2 × 3, intervals 4 rounds; skill work stays at the current step.
 * A single RIR is shown per card, so a range in the plan is shown as its upper (more conservative)
 * end where the week rule gives a range, and the range is named in the week's rule line.
 * After week 7 the block repeats from week 3 (no second re-entry).
 *
 * Revision 1 (weekly review of week 2, coach-approved, 26 Oct 2026), first block only unless noted:
 * Upper A and Lower A were not done in weeks 1-2, so their lifts run one week behind (week 3 at
 * the re-entry dose, week 4 at week 3's) with no overhead press until week 4, and sprints restart
 * at the week-1 dose and step up one column a week; Wednesday Zone 2 stays at 30 min in week 3;
 * the first interval session is capped at about 7-8/10. For every block: no trap bar or
 * hip-thrust setup, so conventional deadlift and cable pull-through replace them.
 */
import type { ProgramDefinition, ProgramDose, ProgramItem, ProgramStep, ProgramWeek } from "./types"

export const RETURNING_LIFTER_CALISTHENICS_ID = "returning-lifter-calisthenics-7wk"

const REENTRY_WEEKS: readonly ProgramWeek[] = [1, 2]
const BUILD_WEEKS: readonly ProgramWeek[] = [4, 5, 6]

type WeekDoses = Partial<Record<ProgramWeek, Partial<ProgramDose>>>

function weeks(list: readonly ProgramWeek[], dose: Partial<ProgramDose>): WeekDoses {
  return Object.fromEntries(list.map((w) => [w, dose])) as WeekDoses
}

interface LiftSpec {
  exerciseId: string
  role: ProgramItem["role"]
  /** Compound or isolation, for the week 3 RIR rule. */
  kind: "compound" | "isolation"
  /** The day's listed prescription (weeks 4-6). */
  sets: number
  reps: [number, number]
  rir: number
  restSeconds: number
  note?: string | null
  fromWeek?: ProgramWeek
  /** Overrides for weeks 1-2 instead of the block rule (2 sets at RIR 3). */
  reentry?: Partial<ProgramDose>
  /** RIR for week 3 instead of the block rule. */
  week3Rir?: number
  /** Extra week-specific changes, applied last. */
  byWeek?: WeekDoses
  /**
   * First block only: run one week behind from week 3 (week 3 at week 2's re-entry dose, week 4 at
   * week 3's), for a day that was missed in weeks 1-2.
   */
  holdFirstBlock?: boolean
  /** First block only: the item's first week. */
  firstBlockFromWeek?: ProgramWeek
  steps?: ProgramStep[]
  tempo?: string | null
}

/**
 * A lift with the block's week rules written out: weeks 1-2 at 2 sets and RIR 3, week 3 at full
 * sets with compounds at RIR 3 and isolation at RIR 2 (never easier than the listed RIR), weeks
 * 4-6 as listed, week 7 one set fewer (at least 1) at RIR 4.
 */
function lift(spec: LiftSpec): ProgramItem {
  const week3Rir = spec.week3Rir ?? (spec.kind === "compound" ? Math.max(spec.rir, 3) : Math.max(spec.rir, 2))
  const byWeek: WeekDoses = {
    ...weeks(REENTRY_WEEKS, { sets: 2, rir: 3, ...spec.reentry }),
    3: { rir: week3Rir },
    7: { sets: Math.max(1, spec.sets - 1), rir: 4 },
  }
  for (const [week, dose] of Object.entries(spec.byWeek ?? {})) {
    const w = Number(week) as ProgramWeek
    byWeek[w] = { ...byWeek[w], ...dose }
  }
  return {
    exerciseId: spec.exerciseId,
    phase: "main",
    role: spec.role,
    sets: spec.sets,
    reps: spec.reps,
    durationSeconds: null,
    restSeconds: spec.restSeconds,
    rir: spec.rir,
    note: spec.note ?? null,
    tempo: spec.tempo ?? null,
    ...(spec.fromWeek ? { fromWeek: spec.fromWeek } : {}),
    ...(spec.steps ? { steps: spec.steps } : {}),
    byWeek,
    ...(spec.holdFirstBlock || spec.firstBlockFromWeek
      ? {
          firstBlock: {
            ...(spec.firstBlockFromWeek ? { fromWeek: spec.firstBlockFromWeek } : {}),
            ...(spec.holdFirstBlock ? { byWeek: { 3: { ...byWeek[2] }, 4: { ...byWeek[3] } } } : {}),
          },
        }
      : {}),
  }
}

/** A warm-up drill: one easy set, no rest target, no RIR. */
function warmup(exerciseId: string, dose: { reps?: [number, number]; durationSeconds?: number; sets?: number; note?: string }, extra: Partial<ProgramItem> = {}): ProgramItem {
  return {
    exerciseId,
    phase: "warmup",
    role: "warmup",
    sets: dose.sets ?? 1,
    reps: dose.reps ?? null,
    durationSeconds: dose.durationSeconds ?? null,
    restSeconds: 0,
    rir: null,
    note: dose.note ?? null,
    ...extra,
  }
}

/** The optional slow-breathing cool-down from the plan's focus habits. */
const BREATHING_COOLDOWN: ProgramItem = {
  exerciseId: "box-breathing",
  phase: "cooldown",
  role: "cooldown",
  sets: 1,
  reps: null,
  durationSeconds: 120,
  restSeconds: 0,
  rir: null,
  note: "Optional: 2 min of slow 4-4-4-4 breathing to wind down.",
}

const STRETCH_CUE = "Ease into a mild stretch, about 3–4 out of 10. No pain, no bouncing; breathe slowly."

/**
 * A cool-down stretch (coach-approved block, one relaxed static hold). One-sided stretches are
 * timed per side by the library's isUnilateral flag. Range of motion and winding down only: the
 * plan makes no injury or soreness claims for stretching.
 */
function stretch(exerciseId: string, durationSeconds: number, note: string): ProgramItem {
  return {
    exerciseId,
    phase: "cooldown",
    role: "cooldown",
    sets: 1,
    reps: null,
    durationSeconds,
    restSeconds: 0,
    rir: null,
    note: `${note} ${STRETCH_CUE}`,
  }
}

/** Upper A: chest and front shoulder, lats, triceps and wrists after bench, dips and pull-ups. */
const UPPER_A_STRETCHES: ProgramItem[] = [
  stretch("chest-doorway-stretch", 30, "Forearm on the frame, elbow at shoulder height, step through gently. Ease off if the front of the shoulder pinches."),
  stretch("lat-stretch", 30, "Hand on the bench, thumb up, hips back; let the chest sink without arching the lower back. Overhead range for the handstand."),
  stretch("overhead-triceps-stretch", 30, "Elbow overhead, gentle push from the other hand, ribs down."),
  stretch("wrist-flexor-stretch", 30, "Elbow straight, ease the fingers back."),
  stretch("child-pose", 45, "Arms long overhead, hips back toward the heels."),
]

/** Lower A: hip flexors, hamstrings and calves after sprints; glutes after squats. */
const LOWER_A_STRETCHES: ProgramItem[] = [
  stretch("kneeling-hip-flexor-stretch", 30, "Squeeze the glute of the down leg, tuck the pelvis, shift forward slightly. Pad the knee."),
  stretch("band-hamstring-stretch", 30, "Lying down, band around the foot, knee nearly straight. Mild tension only after sprints and RDLs. No band: standing hamstring stretch."),
  stretch("wall-calf-stretch", 30, "Back knee straight, heel down, lean into the wall."),
  stretch("figure-four-stretch", 30, "On your back, ankle over the opposite knee, pull the thigh in gently."),
]

/** Wednesday Zone 2: a short block for hips, ankles and overhead range. */
const ZONE2_STRETCHES: ProgramItem[] = [
  stretch("kneeling-hip-flexor-stretch", 30, "Glute squeezed, pelvis tucked."),
  stretch("bent-knee-calf-stretch", 30, "Back knee bent, heel down: ankle range for the pistol."),
  stretch("downward-dog-hold", 45, "Push the floor away, hips high, knees soft if the hamstrings are tight. Skip it if your wrists ache."),
]

/** Upper B: wrists and forearms after the skill block, lats and chest, hamstrings for the L-sit. */
const UPPER_B_STRETCHES: ProgramItem[] = [
  stretch("wrist-flexor-stretch", 30, "Elbow straight, ease the fingers back."),
  stretch("wrist-extensor-stretch", 30, "Elbow straight, ease the back of the hand down."),
  stretch("lat-stretch", 30, "Thumb up, hips back, no lower-back arch."),
  stretch("chest-doorway-stretch", 30, "Elbow at shoulder height, step through gently."),
  stretch("forward-fold", 45, "Soft knees, let the head and arms hang, breathe out as you sink. Never bounce."),
]

/** Lower B: quads, glutes, adductors, hamstrings and ankles after the hinge and single-leg work. */
const LOWER_B_STRETCHES: ProgramItem[] = [
  stretch("lying-quad-stretch", 30, "On your side, knees together, hip pushed slightly forward."),
  stretch("pigeon-pose", 30, "Hips square, lower only as far as feels easy. Front knee complains: figure-four stretch instead."),
  stretch("half-kneeling-adductor-stretch", 30, "Leg out to the side, foot flat, shift the hips away gently."),
  stretch("standing-hamstring-stretch", 30, "Heel on a low step, flat back, hinge to mild tension."),
  stretch("bent-knee-calf-stretch", 30, "Back knee bent, heel down: ankle range for the pistol."),
]

/** Saturday: after the bike (and the 5 min easy cool-down from week 3). */
const CONDITIONING_STRETCHES: ProgramItem[] = [
  stretch("kneeling-hip-flexor-stretch", 30, "Glute squeezed, pelvis tucked."),
  stretch("standing-quad-stretch", 30, "Knees together, stand tall, hold a support."),
  stretch("child-pose", 45, "Arms long, hips back, slow breaths."),
]

/** Steady Zone 2 work; a left swipe switches between the bike and the incline walk. */
const ZONE2_STEPS: ProgramStep[] = [{ exerciseId: "stationary-bike" }, { exerciseId: "treadmill-incline-walk" }]
const ZONE2_NOTE = "Zone 2: a conversational pace, you can speak in full sentences. Bike or incline walk."

const PULL_UP_OR_DIP_LOADING = "Add 2.5 kg only after 3 × 10 clean for 2 sessions."

/* ---------------------------------------------------------------------------------------------- */
/* Days                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

const upperA: ProgramItem[] = [
  warmup("warmup-bike", { durationSeconds: 180, note: "Easy pace." }),
  warmup("band-pull-apart", { reps: [12, 15] }),
  warmup("shoulder-pass-through", { reps: [8, 12], note: "Band dislocates." }),
  warmup("wrist-circles", { reps: [10, 15] }),
  lift({ exerciseId: "barbell-bench-press", role: "primary_compound", kind: "compound", sets: 3, reps: [5, 8], rir: 2, restSeconds: 150, holdFirstBlock: true }),
  lift({
    exerciseId: "pull-up",
    role: "secondary_compound",
    kind: "compound",
    sets: 3,
    reps: [6, 10],
    rir: 2,
    restSeconds: 120,
    holdFirstBlock: true,
    note: `Strict, from a full hang. Under 6 reps with 3–4 to spare: swipe left for assisted. ${PULL_UP_OR_DIP_LOADING}`,
    steps: [{ exerciseId: "pull-up" }, { exerciseId: "assisted-pull-up" }, { exerciseId: "band-assisted-pull-up" }],
  }),
  lift({ exerciseId: "chest-supported-dumbbell-row", role: "accessory", kind: "compound", sets: 3, reps: [6, 10], rir: 2, restSeconds: 120, holdFirstBlock: true }),
  lift({
    exerciseId: "triceps-dip",
    role: "accessory",
    kind: "compound",
    sets: 3,
    reps: [6, 10],
    rir: 2,
    restSeconds: 120,
    holdFirstBlock: true,
    note: `Shoulders no lower than elbows, all block. Under 6 reps with 3–4 to spare: swipe left for assisted. Sharp shoulder or elbow pain: stop for the day. ${PULL_UP_OR_DIP_LOADING}`,
    steps: [{ exerciseId: "triceps-dip" }, { exerciseId: "assisted-dip" }],
  }),
  lift({
    exerciseId: "seated-dumbbell-shoulder-press",
    role: "accessory",
    kind: "compound",
    sets: 2,
    reps: [8, 12],
    rir: 2,
    restSeconds: 120,
    holdFirstBlock: true,
    fromWeek: 3,
    firstBlockFromWeek: 4,
    note: "Only if your elbows and shoulders felt fine the day after last Monday; otherwise skip it.",
  }),
  lift({
    exerciseId: "incline-dumbbell-curl",
    role: "isolation",
    kind: "isolation",
    sets: 2,
    reps: [10, 15],
    rir: 1,
    restSeconds: 40,
    holdFirstBlock: true,
    note: "Alternate sets with the lateral raise, 30–45 s between.",
  }),
  lift({
    exerciseId: "dumbbell-lateral-raise",
    role: "isolation",
    kind: "isolation",
    sets: 2,
    reps: [12, 20],
    rir: 1,
    restSeconds: 40,
    holdFirstBlock: true,
    note: "Alternated with the incline curl. Add reps before load.",
  }),
  lift({ exerciseId: "face-pull", role: "isolation", kind: "isolation", sets: 2, reps: [12, 20], rir: 2, restSeconds: 60, holdFirstBlock: true }),
  ...UPPER_A_STRETCHES,
  BREATHING_COOLDOWN,
]

/** Sprint dose by week: 20 m accelerations (one rep per sprint). */
const SPRINTS: Record<ProgramWeek, { sets: number; effort: string }> = {
  1: { sets: 4, effort: "70%" },
  2: { sets: 4, effort: "80%" },
  3: { sets: 5, effort: "85%" },
  4: { sets: 6, effort: "90%" },
  5: { sets: 6, effort: "90–95%" },
  6: { sets: 6, effort: "90–95%" },
  7: { sets: 3, effort: "80%" },
}
/** First block: the sprint column each week uses (no sprints were done in weeks 1-2). */
const FIRST_BLOCK_SPRINTS: Partial<Record<ProgramWeek, ProgramWeek>> = { 3: 1, 4: 2, 5: 3, 6: 4 }
const SPRINT_STEP_RULE =
  "Move up only after a clean session (no tightness, no slowing, at most mild soreness the next day); otherwise repeat last week's dose."
const SPRINT_NOTE = "Track, turf or firm grass, never a treadmill. Stop on any tightness or clear slowing. No lane: swipe left for sled push 5–6 × 15 m."
const SLED_NOTE = "No lane: sled push 5–6 × 15 m, fast, walk back to recover. The distance sets the rep; the timer is a guide."
/** The plan's no-lane option: sled pushes, 3 in the deload week. */
const SLED_STEP: ProgramStep = {
  exerciseId: "sled-push",
  dose: { sets: 6, reps: null, durationSeconds: 15, note: SLED_NOTE },
  byWeek: Object.fromEntries(
    ([1, 2, 3, 4, 5, 6, 7] as ProgramWeek[]).map((w) => [w, { sets: w === 7 ? 3 : 6, note: SLED_NOTE }]),
  ) as WeekDoses,
}

const HANGING_FALLBACK = "Grip fails or lower back complains: tap replace and pick the captain's chair leg raise or the ab-wheel rollout."

const lowerA: ProgramItem[] = [
  warmup("warmup-bike", { durationSeconds: 120, note: "Easy pace." }),
  warmup("leg-swings-front", { reps: [10, 15] }),
  warmup("leg-swings-side", { reps: [10, 15] }),
  warmup("hip-circles", { reps: [8, 12] }),
  warmup("sprint-drills", {
    sets: 4,
    durationSeconds: 15,
    note: "4 runs of 15 m: 2 A-march, then 2 A-skip (the timer is only a guide). Then 3 build-up runs at 50, 65 and 80%.",
  }),
  {
    exerciseId: "acceleration-sprint",
    phase: "main",
    role: "primary_compound",
    sets: 6,
    reps: [1, 1],
    durationSeconds: null,
    restSeconds: 120,
    rir: null,
    note: `20 m at 90%. ${SPRINT_NOTE}`,
    planLoad: false,
    steps: [{ exerciseId: "acceleration-sprint" }, SLED_STEP],
    byWeek: Object.fromEntries(
      (Object.entries(SPRINTS) as [string, { sets: number; effort: string }][]).map(([w, s]) => [w, { sets: s.sets, note: `20 m at ${s.effort}. ${SPRINT_NOTE}` }]),
    ) as WeekDoses,
    // No sprints in weeks 1-2: restart at week 1's dose and move up one column a week.
    firstBlock: {
      byWeek: Object.fromEntries(
        (Object.entries(FIRST_BLOCK_SPRINTS) as [string, ProgramWeek][]).map(([w, from]) => [
          w,
          { sets: SPRINTS[from].sets, note: `20 m at ${SPRINTS[from].effort}. ${SPRINT_STEP_RULE} ${SPRINT_NOTE}` },
        ]),
      ) as WeekDoses,
    },
  },
  {
    exerciseId: "box-jump",
    phase: "main",
    role: "accessory",
    sets: 3,
    reps: [3, 3],
    durationSeconds: null,
    restSeconds: 75,
    rir: null,
    note: "Low-to-moderate box. Step down, never jump down.",
    byWeek: { 7: { sets: 2 } },
    firstBlock: { byWeek: { 3: { note: "First box jumps of the block: low box, well short of your maximum height. Step down, never jump down." } } },
  },
  lift({ exerciseId: "barbell-back-squat", role: "primary_compound", kind: "compound", sets: 3, reps: [5, 8], rir: 2, restSeconds: 180, holdFirstBlock: true }),
  lift({
    exerciseId: "romanian-deadlift",
    role: "secondary_compound",
    kind: "compound",
    sets: 3,
    reps: [8, 10],
    rir: 2,
    restSeconds: 120,
    holdFirstBlock: true,
    note: "Use straps if your grip would limit the hanging raises later.",
  }),
  lift({
    exerciseId: "seated-leg-curl",
    role: "isolation",
    kind: "isolation",
    sets: 3,
    reps: [10, 15],
    rir: 1,
    restSeconds: 40,
    holdFirstBlock: true,
    note: "Alternate sets with the calf raise, 30–45 s between.",
  }),
  lift({
    exerciseId: "standing-calf-raise",
    role: "isolation",
    kind: "isolation",
    sets: 3,
    reps: [10, 15],
    rir: 1,
    restSeconds: 40,
    holdFirstBlock: true,
    note: "Alternated with the leg curl.",
  }),
  {
    exerciseId: "hanging-knee-raise",
    phase: "main",
    role: "accessory",
    sets: 2,
    reps: [8, 10],
    durationSeconds: null,
    restSeconds: 60,
    rir: null,
    note: `No swinging. After 2 sessions of 2 × 10 clean, swipe left for the hanging leg raise. ${HANGING_FALLBACK}`,
    steps: [
      { exerciseId: "hanging-knee-raise" },
      { exerciseId: "hanging-leg-raise", dose: { reps: [6, 10], note: `No swinging. ${HANGING_FALLBACK}` } },
    ],
    alternatives: ["captains-chair-leg-raise", "ab-wheel-rollout"],
    byWeek: { 7: { sets: 1 } },
  },
  ...LOWER_A_STRETCHES,
  BREATHING_COOLDOWN,
]

/** Wednesday Zone 2 minutes by week (plan: 30 / 30 / 35 / 35-45 / 30). */
const ZONE2_MINUTES: Record<ProgramWeek, number> = { 1: 30, 2: 30, 3: 35, 4: 40, 5: 40, 6: 40, 7: 30 }

const zone2: ProgramItem[] = [
  {
    exerciseId: "stationary-bike",
    phase: "main",
    role: "finisher",
    sets: 1,
    reps: null,
    durationSeconds: 40 * 60,
    restSeconds: 0,
    rir: null,
    note: ZONE2_NOTE,
    steps: ZONE2_STEPS,
    byWeek: {
      ...(Object.fromEntries(
        (Object.entries(ZONE2_MINUTES) as [string, number][]).map(([w, minutes]) => [w, { durationSeconds: minutes * 60 }]),
      ) as WeekDoses),
      ...weeks(BUILD_WEEKS, { durationSeconds: 40 * 60, note: `${ZONE2_NOTE} 35–45 min this week.` }),
    },
    // Only 10 min of Zone 2 was done in weeks 1-2: stay at 30 min for week 3.
    firstBlock: { byWeek: { 3: { durationSeconds: 30 * 60 } } },
  },
  ...ZONE2_STRETCHES,
  BREATHING_COOLDOWN,
]

const SKILL_GATE = "Next step only after 2 clean sessions at the target; back off a step if your wrists or elbows ache the next day. Never to failure."

const upperB: ProgramItem[] = [
  warmup("warmup-bike", { durationSeconds: 180, note: "Easy pace." }),
  warmup("shoulder-pass-through", { reps: [8, 12], note: "Band dislocates." }),
  warmup("wrist-circles", { reps: [10, 15] }),
  warmup("wrist-rocks", { reps: [8, 10] }),
  {
    exerciseId: "box-pike-hold",
    phase: "main",
    role: "accessory",
    sets: 3,
    reps: null,
    durationSeconds: 30,
    restSeconds: 60,
    rir: null,
    note: `Skill block: alternate rounds with the L-sit. Then a higher box, 30 s; then swipe left for the wall walk. ${SKILL_GATE}`,
    steps: [
      { exerciseId: "box-pike-hold" },
      {
        exerciseId: "wall-walk-hold",
        dose: { durationSeconds: 20, note: `Skill block: alternate rounds with the L-sit. Walk to 45–60 degrees. Then swipe left for the chest-to-wall handstand. ${SKILL_GATE}` },
      },
      {
        exerciseId: "chest-to-wall-handstand",
        dose: { durationSeconds: 20, note: `Skill block: alternate rounds with the L-sit. Build from 20 to 40 s; walk the hands in and out. ${SKILL_GATE}` },
      },
    ],
    byWeek: {
      ...weeks(REENTRY_WEEKS, { note: `Weeks 1-2: 3 easy sets. Skill block: alternate rounds with the L-sit. ${SKILL_GATE}` }),
      7: { note: "Deload: stay at your current step. Skill block: alternate rounds with the L-sit. Never to failure." },
    },
  },
  {
    exerciseId: "tuck-l-sit",
    phase: "main",
    role: "accessory",
    sets: 3,
    reps: null,
    durationSeconds: 10,
    restSeconds: 60,
    rir: null,
    note: `Hold 10–15 s. Then swipe left for the one-leg L-sit. ${SKILL_GATE}`,
    steps: [
      { exerciseId: "tuck-l-sit" },
      { exerciseId: "one-leg-l-sit", dose: { note: `Hold 10–15 s. Then swipe left for the full L-sit. ${SKILL_GATE}` } },
      { exerciseId: "l-sit", dose: { note: `Hold 10–15 s. ${SKILL_GATE}` } },
    ],
    byWeek: { 7: { note: "Deload: stay at your current step. Hold 10–15 s. Never to failure." } },
  },
  lift({ exerciseId: "incline-dumbbell-press", role: "primary_compound", kind: "compound", sets: 3, reps: [8, 12], rir: 2, restSeconds: 120 }),
  lift({ exerciseId: "lat-pulldown", role: "secondary_compound", kind: "compound", sets: 3, reps: [8, 12], rir: 2, restSeconds: 120 }),
  // Plan: RIR 1-2.
  lift({ exerciseId: "seated-cable-row", role: "accessory", kind: "compound", sets: 3, reps: [10, 12], rir: 2, restSeconds: 90 }),
  lift({ exerciseId: "dumbbell-lateral-raise", role: "isolation", kind: "isolation", sets: 3, reps: [12, 20], rir: 1, restSeconds: 60, note: "Add reps before load." }),
  lift({ exerciseId: "reverse-pec-deck", role: "isolation", kind: "isolation", sets: 2, reps: [15, 20], rir: 1, restSeconds: 60 }),
  lift({
    exerciseId: "ez-bar-curl",
    role: "isolation",
    kind: "isolation",
    sets: 2,
    reps: [8, 12],
    rir: 1,
    restSeconds: 60,
    note: "Superset with the overhead triceps extension; rest 60 s after each pair.",
  }),
  lift({
    exerciseId: "overhead-cable-triceps-extension",
    role: "isolation",
    kind: "isolation",
    sets: 2,
    reps: [10, 15],
    rir: 1,
    restSeconds: 60,
    note: "Supersetted with the EZ-bar curl.",
  }),
  ...UPPER_B_STRETCHES,
  BREATHING_COOLDOWN,
]

const lowerB: ProgramItem[] = [
  warmup("warmup-bike", { durationSeconds: 180, note: "Easy pace." }),
  warmup("hip-circles", { reps: [8, 12] }),
  warmup("worlds-greatest-stretch", { reps: [8, 10] }),
  {
    exerciseId: "medicine-ball-scoop-toss",
    phase: "main",
    role: "accessory",
    sets: 3,
    reps: [3, 3],
    durationSeconds: null,
    restSeconds: 60,
    rir: null,
    note: "3–5 kg ball. Fast throws, full hip drive. No ball: swipe left for jump squats, not bodyweight squats.",
    untilWeek: 3,
    alternatives: ["jump-squat"],
  },
  {
    exerciseId: "broad-jump",
    phase: "main",
    role: "accessory",
    sets: 3,
    reps: [3, 3],
    durationSeconds: null,
    restSeconds: 90,
    rir: null,
    note: "Below your maximum. Hold each landing for 2 s.",
    fromWeek: 4,
    byWeek: { 7: { sets: 2 } },
  },
  // Plan: trap-bar deadlift; no trap bar at the gym, so the conventional deadlift (revision 1).
  lift({
    exerciseId: "conventional-deadlift",
    role: "primary_compound",
    kind: "compound",
    sets: 3,
    reps: [4, 6],
    // Plan: RIR 2-3; weeks 4-6 hold compounds at RIR 2.
    rir: 2,
    restSeconds: 180,
    note: "Keep this variation all block. Ramp up from the empty bar. Log the total load including the bar.",
    reentry: { sets: 2, reps: [5, 5], rir: 4 },
    // Week 2 was a different variation each week: first session of week 3 at 2 × 5, RIR 3-4.
    holdFirstBlock: true,
  }),
  lift({
    exerciseId: "box-pistol-squat",
    role: "accessory",
    kind: "compound",
    sets: 2,
    reps: [3, 5],
    rir: 3,
    restSeconds: 60,
    fromWeek: 2,
    note: "Start on an above-knee box; lower it one step after 2 clean sessions. Rest 60 s between legs. You can hold a counterweight in front. Stop if the front of your knee hurts.",
    // Plan: RIR 3 or easier, every week.
    reentry: { sets: 2, rir: 3 },
    byWeek: { 7: { note: "Deload: keep your current box height. Counterweight in front allowed. Stop if the front of your knee hurts." } },
  }),
  lift({ exerciseId: "leg-press", role: "secondary_compound", kind: "compound", sets: 3, reps: [8, 12], rir: 2, restSeconds: 120 }),
  lift({
    exerciseId: "bulgarian-split-squat",
    role: "accessory",
    kind: "compound",
    sets: 2,
    reps: [8, 10],
    rir: 2,
    restSeconds: 90,
    byWeek: { 1: { note: "Light this week." } },
  }),
  // Plan: barbell hip thrust, RIR 1-2; no hip-thrust setup at the gym, so the plan's cable
  // pull-through fallback at 10-12 reps (revision 1).
  lift({ exerciseId: "cable-pull-through", role: "accessory", kind: "compound", sets: 2, reps: [10, 12], rir: 2, restSeconds: 90 }),
  {
    exerciseId: "pallof-press",
    phase: "main",
    role: "accessory",
    sets: 2,
    reps: [10, 10],
    durationSeconds: null,
    restSeconds: 45,
    rir: null,
    note: "Per side, with a 2 s hold. Use the cable stack; the superman is not a substitute (no anti-rotation).",
    byWeek: { 7: { sets: 1 } },
  },
  ...LOWER_B_STRETCHES,
  BREATHING_COOLDOWN,
]

/** Saturday interval rounds by week (weeks 3-6: 5/6/7/8, week 7: 4). */
const INTERVAL_ROUNDS: Partial<Record<ProgramWeek, number>> = { 3: 5, 4: 6, 5: 7, 6: 8, 7: 4 }

const conditioning: ProgramItem[] = [
  {
    exerciseId: "stationary-bike",
    phase: "main",
    role: "finisher",
    sets: 1,
    reps: null,
    durationSeconds: 30 * 60,
    restSeconds: 0,
    rir: null,
    note: ZONE2_NOTE,
    steps: ZONE2_STEPS,
    untilWeek: 2,
  },
  warmup("warmup-bike", { durationSeconds: 300, note: "5 min easy." }, { fromWeek: 3 }),
  {
    exerciseId: "bike-intervals",
    phase: "main",
    role: "finisher",
    sets: 5,
    reps: null,
    durationSeconds: 60,
    restSeconds: 120,
    rir: null,
    note: "1 min hard (about 8/10), 2 min easy between rounds. Bike or air bike, not the rower the day after deadlifts.",
    fromWeek: 3,
    byWeek: Object.fromEntries(
      (Object.entries(INTERVAL_ROUNDS) as [string, number][]).map(([w, rounds]) => [w, { sets: rounds }]),
    ) as WeekDoses,
    // First interval session after almost no conditioning in weeks 1-2.
    firstBlock: {
      byWeek: {
        3: {
          note: "First interval session: 1 min at about 7–8/10, not harder, 2 min easy between rounds. Bike or air bike. Stop and get medical care for chest pain, fainting, unusual breathlessness or palpitations.",
        },
      },
    },
  },
  {
    exerciseId: "bike-cooldown",
    phase: "cooldown",
    role: "cooldown",
    sets: 1,
    reps: null,
    durationSeconds: 300,
    restSeconds: 0,
    rir: null,
    note: "5 min easy.",
    fromWeek: 3,
  },
  ...CONDITIONING_STRETCHES,
  BREATHING_COOLDOWN,
]

const rest: ProgramItem[] = [
  {
    exerciseId: "outdoor-walk",
    phase: "main",
    role: "finisher",
    sets: 1,
    reps: null,
    durationSeconds: 20 * 60,
    restSeconds: 0,
    rir: null,
    note: "Optional walk. Today is a rest day: nothing to complete. Walk easy at any pace if you feel like it, or skip it. Sleep at least 7 hours.",
  },
]

export const returningLifterCalisthenics: ProgramDefinition = {
  id: RETURNING_LIFTER_CALISTHENICS_ID,
  title: "Return to strength: muscle + calisthenics (7 weeks)",
  goal: "muscle_gain",
  revision: 1,
  weeks: 7,
  repeatFromWeek: 3,
  schedule: { 0: "rest", 1: "upper-a", 2: "lower-a", 3: "zone-2", 4: "upper-b", 5: "lower-b", 6: "conditioning" },
  days: {
    "upper-a": {
      title: "Upper A",
      split: "upper",
      focus: ["chest", "back", "shoulders", "triceps", "biceps"],
      // Plan: about 60-64 min, weeks 1-2 45-48. Week 7 (not given) is sized like re-entry.
      estimatedMinutes: [
        { fromWeek: 1, minutes: 53 },
        { fromWeek: 3, minutes: 68 },
        { fromWeek: 7, minutes: 53 },
      ],
      items: upperA,
    },
    "lower-a": {
      title: "Lower A",
      split: "lower",
      focus: ["quads", "hamstrings", "glutes", "calves", "core"],
      // Plan: about 63-66 min, weeks 1-2 about 50.
      estimatedMinutes: [
        { fromWeek: 1, minutes: 55 },
        { fromWeek: 3, minutes: 70 },
        { fromWeek: 7, minutes: 55 },
      ],
      items: lowerA,
    },
    "zone-2": {
      title: "Zone 2",
      split: "conditioning",
      focus: ["cardio"],
      estimatedMinutes: [
        { fromWeek: 1, minutes: 34 },
        { fromWeek: 3, minutes: 39 },
        { fromWeek: 4, minutes: 44 },
        { fromWeek: 7, minutes: 34 },
      ],
      items: zone2,
    },
    "upper-b": {
      title: "Upper B",
      split: "upper",
      focus: ["shoulders", "back", "chest", "core", "biceps", "triceps"],
      // Plan: about 60-63 min, weeks 1-2 47-50.
      estimatedMinutes: [
        { fromWeek: 1, minutes: 55 },
        { fromWeek: 3, minutes: 68 },
        { fromWeek: 7, minutes: 55 },
      ],
      items: upperB,
    },
    "lower-b": {
      title: "Lower B",
      split: "lower",
      focus: ["glutes", "hamstrings", "quads", "core"],
      // Plan: about 61-64 min, weeks 1-2 46-48.
      estimatedMinutes: [
        { fromWeek: 1, minutes: 53 },
        { fromWeek: 3, minutes: 69 },
        { fromWeek: 7, minutes: 53 },
      ],
      items: lowerB,
    },
    conditioning: {
      title: "Conditioning",
      split: "conditioning",
      focus: ["cardio"],
      // 5 min easy + rounds × 3 min + 5 min easy.
      estimatedMinutes: [
        { fromWeek: 1, minutes: 34 },
        { fromWeek: 3, minutes: 29 },
        { fromWeek: 4, minutes: 32 },
        { fromWeek: 5, minutes: 35 },
        { fromWeek: 6, minutes: 38 },
        { fromWeek: 7, minutes: 26 },
      ],
      items: conditioning,
    },
    rest: {
      title: "Rest day",
      split: "conditioning",
      focus: ["cardio"],
      // A rest day: the walk is optional, so no session time is planned.
      estimatedMinutes: [{ fromWeek: 1, minutes: 0 }],
      items: rest,
      restDay: true,
    },
  },
  blockRules: [
    "Weeks 1-2, re-entry: 2 working sets per lift at RIR 3-4. Choose loads by feel; 70% of your old working weight is a ceiling, not a target. Assisted pull-ups or dips if you can't do 6 strict reps with 3-4 to spare. No overhead press yet. Skill holds are 3 easy sets. Box pistols start in week 2.",
    "Week 3: full sets, compounds at RIR 2-3, isolation at RIR 1-2. Weeks 4-6: compounds at RIR 2.",
    "Progression: when every set reaches the top of the rep range, add the smallest load step. Pull-ups and dips: add 2.5 kg only after 3 × 10 clean, for 2 sessions. Light dumbbell lifts: add reps before adding load.",
    "Skill and trunk steps are gated: move to the next step after 2 clean sessions at the target, never by calendar. Back off one step if your wrists or elbows ache the next day. Never go to failure on skill work.",
    "Week 7, deload: 3-set lifts drop to 2 sets and 2-set lifts to 1, at RIR 4. Sprints 3 × 20 m at 80%, jumps 2 × 3, intervals 4 rounds. Skill work stays at your current step.",
    "Skill work is practised once a week: expect gradual progress.",
    "Stop and get medical care for chest pain, fainting, unusual breathlessness or palpitations. Sharp or lasting joint pain: drop that exercise and get it checked.",
  ],
  habits: [
    "Focus: phone away between sets except to log; rest timer on; log every set and every hold. Cool-down stretches each day (range of motion and winding down), then optional 2 min slow breathing (4-4-4-4) as a relaxation habit, not proven focus training. Sleep at least 7 hours.",
    "Fuel: protein about 1.6 g per kg of body weight a day (Morton et al. 2018), up to about 2.2 g per kg if you prefer. Body weight may rise up to about 1 kg early on from water and glycogen.",
    "Every 2 weeks, check: main-lift weights; strict pull-up and dip reps at body weight; handstand and L-sit hold times; pistol box height; how the sprints feel; Zone 2 pace at the same effort; weekly average body weight (as a check, not a target).",
  ],
  weekRules: {
    1: "Weeks 1-2, re-entry: 2 working sets per lift at RIR 3-4. Choose loads by feel; 70% of your old working weight is a ceiling, not a target. No overhead press yet; skill holds are 3 easy sets.",
    2: "Weeks 1-2, re-entry: 2 working sets per lift at RIR 3-4. Box pistols start this week; still no overhead press.",
    3: "Week 3: full sets. Compounds at RIR 2-3, isolation at RIR 1-2. Overhead press joins Monday if your shoulders and elbows feel fine.",
    4: "Weeks 4-6: compounds at RIR 2. When every set reaches the top of the range, add the smallest load step.",
    5: "Weeks 4-6: compounds at RIR 2. When every set reaches the top of the range, add the smallest load step.",
    6: "Weeks 4-6: compounds at RIR 2. When every set reaches the top of the range, add the smallest load step.",
    7: "Week 7, deload: 3-set lifts drop to 2 sets and 2-set lifts to 1, at RIR 4. Skill work stays at your current step.",
  },
  weekNotes: {
    1: [
      "Before week 1, complete the PAR-Q+. Get medical clearance first if any answer is yes, or if the break followed illness, injury or surgery.",
      "Stop and get medical care for chest pain, fainting, unusual breathlessness or palpitations.",
    ],
    3: [
      "Upper A and Lower A were not done in weeks 1-2, so this week they stay at re-entry: 2 sets at RIR 3-4, no overhead press yet, sprints 4 × 20 m at 70%.",
      "Keep sessions near 65 min: the prescribed sets only, rest timer on. Running over: drop the last set of the last isolation exercise first. Never cut the warm-up, ramp-up sets, sprint prep, main-lift rest or cool-down.",
      "Program days only this block, no app-generated workouts. Log RPE on at least the last set of every compound, and log the total load including the bar.",
      "Handstand: your wrists were fine after the wall walks, so swipe left for the chest-to-wall handstand (20 s) if the position was clean. Tuck L-sit stays until 3 × 15 s.",
    ],
    4: [
      "Upper A and Lower A run one week behind: this week their lifts use week 3's full sets at RIR 3, and sprints are 4 × 20 m at 80% if last week's were clean. Overhead press joins Monday if your shoulders and elbows felt fine after last Monday.",
    ],
  },
}
