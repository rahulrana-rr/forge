/**
 * Warm-up selection: one light-cardio block, then dynamic drills for the work the session
 * actually does: a same-pattern primer for each main lift (unless the lift is its own rehearsal),
 * cuff work for a protected shoulder, wrist prep when the main phase loads the wrists, then the
 * day's trained focus.
 */
import { muscleGroupOf } from "@/lib/exercises"
import { ALL_MUSCLE_GROUPS, type Exercise, type MovementPattern, type MuscleGroup } from "@/lib/exercises/types"
import type { UserProfile } from "@/lib/domain/types"
import type { Rng } from "./random"
import { isTorsoSupported, passesProfileFilter } from "./selection"
import { prescribeLight, type Prescription } from "./prescriptions"

export interface PlannedItem {
  exercise: Exercise
  prescription: Prescription
}

/** MuscleGroups an exercise is tagged for, from tags like "for:chest". */
export function forGroups(exercise: Exercise): MuscleGroup[] {
  const out: MuscleGroup[] = []
  for (const tag of exercise.tags ?? []) {
    if (!tag.startsWith("for:")) continue
    const group = tag.slice(4) as MuscleGroup
    if ((ALL_MUSCLE_GROUPS as readonly string[]).includes(group) && !out.includes(group)) out.push(group)
  }
  return out
}

/**
 * Targeted correctives (the sleeper stretch, for example) are for users who need them. They stay
 * available through replace but are never picked automatically.
 */
export const CORRECTIVE_TAG = "corrective"

export function isCorrective(exercise: Exercise): boolean {
  return (exercise.tags ?? []).includes(CORRECTIVE_TAG)
}

/**
 * The group a warm-up or cool-down item works on directly. Neck drills and stretches map to
 * "shoulders" but neither prepare nor stretch the delts, so they have none.
 */
export function ownGroup(exercise: Exercise): MuscleGroup | null {
  return exercise.primaryMuscle === "neck" ? null : muscleGroupOf(exercise)
}

/** Whether an item is tagged for any of the groups ("for:full_body" counts only on a full-body day). */
export function serves(exercise: Exercise, groups: readonly MuscleGroup[]): boolean {
  return forGroups(exercise).some((g) => groups.includes(g))
}

/**
 * How well a warm-up or cool-down item fits the day. The item's own primary muscle being in
 * the focus counts most (a lat stretch after pulling, not a wrist stretch tagged "for:back");
 * matching "for:" tags count next, capped so broadly tagged items cannot outscore specific
 * ones. Untagged items score a small baseline.
 *
 * When `trained` (the groups the main phase actually loaded) is known, it replaces the focus:
 * a trained group scores as a focus group, and a focus group that got no sets today earns
 * nothing (no chest stretch after a squat-only day whose template listed chest).
 */
export function focusAffinity(exercise: Exercise, focus: readonly MuscleGroup[], trained: readonly MuscleGroup[] = []): number {
  const groups = forGroups(exercise)
  if (groups.length === 0) return 0.5
  const target = trained.length > 0 ? trained : focus
  let score = 0
  const own = ownGroup(exercise)
  if (own && target.includes(own)) score += 4
  const tagHits = groups.filter((g) => target.includes(g)).length
  score += Math.min(2, tagHits) * 2
  return score
}

/** Data tag for a warm-up's light-cardio block (a pulse raiser: easy bike, march, jumping jacks). */
export const LIGHT_CARDIO_TAG = "light_cardio"

/**
 * The warm-up's light-cardio block: a locomotion or conditioning entry tagged "light_cardio". The
 * older "warmup-" id prefix still counts, so entries the library has not tagged yet keep working;
 * new entries (a low-impact march) only need the tag.
 */
export function isLightCardio(exercise: Exercise): boolean {
  if (exercise.movementPattern !== "locomotion" && exercise.movementPattern !== "conditioning") return false
  return (exercise.tags ?? []).includes(LIGHT_CARDIO_TAG) || exercise.id.startsWith("warmup-")
}

export function isLowImpact(exercise: Exercise): boolean {
  return (exercise.tags ?? []).includes("low_impact")
}

/**
 * Seconds an impact pulse raiser (jumping jacks, easy jump rope) runs at most: one to two minutes
 * raises the pulse; three to five minutes of jumping is a conditioning bout before the first lift.
 * Machine and other low-impact light cardio keeps its own 3–5 minute range.
 */
export const IMPACT_PULSE_SECONDS: readonly [number, number] = [60, 120]

/**
 * The light prescription a warm-up item gets, from the builder or a swap: prescribeLight, with an
 * impact pulse raiser held to IMPACT_PULSE_SECONDS, and the per-side rep cap kept for primers of a
 * loaded pattern (8 lunges per leg is a primer, 16 is a working set). Mobility and cuff drills keep
 * the bottom of their own range: 12 band external rotations per side, not 8.
 */
export function prescribeWarmupItem(exercise: Exercise, durationMinutes: number): Prescription {
  if (isLightCardio(exercise) && !isLowImpact(exercise) && exercise.durationRange) {
    const [lo, hi] = exercise.durationRange
    const range: [number, number] = [Math.min(lo, IMPACT_PULSE_SECONDS[0]), Math.min(hi, IMPACT_PULSE_SECONDS[1])]
    return prescribeLight({ ...exercise, durationRange: range }, durationMinutes)
  }
  const rx = prescribeLight(exercise, durationMinutes)
  if (rx.reps && exercise.repRange && exercise.isUnilateral && !PRIMER_PATTERNS.has(exercise.movementPattern)) {
    const n = exercise.repRange[0]
    return { ...rx, reps: [n, n] }
  }
  return rx
}

/** Score added to low-impact light cardio for a beginner, above the random jitter: the bike or a march, not jumping. */
export const LOW_IMPACT_BEGINNER_BONUS = 4
/** Score added to light cardio on the finisher's own machine or movement (the rower before rowing intervals). */
export const FINISHER_MODALITY_BONUS = 4

/** Conditioning modalities a warm-up block and a finisher can share, read from the id or the variation parent. */
const MODALITIES: readonly (readonly [RegExp, string])[] = [
  [/(^|-)(bike|cycle|cycling)(-|$)/, "bike"],
  [/(^|-)(row|rower|rowing)(-|$)/, "row"],
  [/(^|-)treadmill(-|$)/, "treadmill"],
  [/(^|-)elliptical(-|$)/, "elliptical"],
  [/(^|-)ski(-|$)/, "ski"],
  [/(^|-)jump-rope(-|$)/, "jump_rope"],
  [/(^|-)jumping-jacks(-|$)/, "jumping_jacks"],
]

function modalityOf(exercise: Exercise): string | null {
  for (const [pattern, modality] of MODALITIES) {
    if (pattern.test(exercise.id) || (exercise.variationOf !== undefined && pattern.test(exercise.variationOf))) return modality
  }
  return null
}

/** Whether a light-cardio block uses the finisher's machine or movement (warm-up row before rowing intervals). */
export function sharesModality(cardio: Exercise, finisher: Exercise): boolean {
  const modality = modalityOf(cardio)
  return modality !== null && modality === modalityOf(finisher)
}

/**
 * Data tag for drills driven by momentum (arm swings, leg swings). With a shoulder flag, one that
 * moves the shoulder scores SHOULDER_BALLISTIC_PENALTY lower (more than the largest focus
 * affinity, so it is picked only when nothing else serves the day), and a controlled cuff drill
 * is reserved instead.
 */
export const BALLISTIC_TAG = "ballistic"
export const SHOULDER_BALLISTIC_PENALTY = 10

function isBallistic(exercise: Exercise): boolean {
  return (exercise.tags ?? []).includes(BALLISTIC_TAG)
}

/** A drill that moves the shoulder joint: its own group or a "for:" tag is the shoulders, chest or back. */
function movesShoulder(exercise: Exercise): boolean {
  const upper: readonly MuscleGroup[] = ["shoulders", "chest", "back"]
  const own = ownGroup(exercise)
  return (own !== null && upper.includes(own)) || forGroups(exercise).includes("shoulders")
}

/**
 * Controlled rotator-cuff and scapular work (band external rotation, band pull-aparts): a warm-up
 * drill for the rear delts and external rotators that is not momentum-driven.
 */
export function isCuffDrill(exercise: Exercise): boolean {
  return exercise.category === "warmup" && exercise.primaryMuscle === "rear_delts" && !isBallistic(exercise) && !isCorrective(exercise)
}

const UPPER_LIFT_GROUPS: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(["chest", "back", "shoulders"])

export function isDynamicDrill(exercise: Exercise): boolean {
  if (exercise.category !== "warmup" && exercise.category !== "mobility") return false
  if (isLightCardio(exercise)) return false
  return exercise.movementPattern !== "stretch"
}

/** Loaded patterns that have a same-pattern primer (a hip-hinge drill before an RDL). */
const PRIMER_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>([
  "squat",
  "hinge",
  "lunge",
  "hip_extension",
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
])

/**
 * A main lift the warm-up primes and the cool-down stretches first: any compound in the main
 * phase, whatever slot role it fills (a stand-in RDL counts). Trunk and conditioning work do not.
 */
export function isMainLift(exercise: Exercise): boolean {
  if (exercise.mechanics !== "compound") return false
  if (exercise.category === "core" || exercise.category === "cardio") return false
  return exercise.movementPattern !== "conditioning" && exercise.movementPattern !== "locomotion"
}

/**
 * A rehearsal primer: a warm-up drill that runs a lift's own movement unloaded (push-up primer,
 * squat primer, band row), not a joint or shoulder-blade drill such as the scapular push-up.
 */
function isRehearsal(drill: Exercise): boolean {
  return drill.category === "warmup" && drill.mechanics === "compound" && PRIMER_PATTERNS.has(drill.movementPattern)
}

/**
 * Whether a lift is its own rehearsal: an unloaded bodyweight movement of beginner difficulty
 * (bodyweight squat, knee push-up, glute bridge). Its first working set prepares the pattern.
 */
export function rehearsesItself(lift: Exercise): boolean {
  return lift.loadType === "bodyweight" && lift.difficulty === "beginner"
}

/**
 * A same-pattern primer that only repeats a lift at the same load: the lift rehearses itself and
 * the primer has its shape (both legs or one). A squat primer before bodyweight squats, or a full
 * push-up primer before knee push-ups, adds nothing; a two-legged hinge drill before a single-leg
 * RDL still teaches the hinge before the balance demand.
 */
export function duplicatesLift(drill: Exercise, lift: Exercise): boolean {
  return (
    isRehearsal(drill) &&
    drill.movementPattern === lift.movementPattern &&
    rehearsesItself(lift) &&
    !!drill.isUnilateral === !!lift.isUnilateral
  )
}

/** Main-phase work that stresses the wrists (push-ups, handstands, straight-bar curls). */
export function loadsWrist(exercise: Exercise): boolean {
  return exercise.contraindications.includes("wrist")
}

function preparesWrist(exercise: Exercise): boolean {
  return exercise.primaryMuscle === "forearms"
}

/** Groups that have no direct drill or stretch: they are reached through tags only. */
export const META_GROUPS: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(["full_body", "cardio"])

export function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)]
}

export interface WarmupOptions {
  pool: readonly Exercise[]
  profile: UserProfile
  focus: readonly MuscleGroup[]
  /** Groups loaded by today's compounds, most important first: each gets a specific drill. */
  heavy?: readonly MuscleGroup[]
  /**
   * The kept main-phase exercises (finisher excluded), most important first. Each main lift gets
   * a same-pattern primer, wrist-loaded work gets one wrist drill, and focus groups that got no
   * sets today stop counting.
   */
  main?: readonly Exercise[]
  /** Today's conditioning finisher, when planned: the light cardio prefers its machine or movement. */
  finisher?: Exercise | null
  rng: Rng
}

/** Whether a drill prepares a specific group (its own muscle or an explicit "for:" tag). */
function prepares(exercise: Exercise, group: MuscleGroup): boolean {
  return ownGroup(exercise) === group || forGroups(exercise).includes(group)
}

interface LiftTarget {
  group: MuscleGroup
  /** The lift's pattern when a same-pattern primer can prepare it. */
  pattern: MovementPattern | null
}

/** One target per distinct main lift (group and pattern), then any listed heavy group not yet covered. */
function liftTargets(main: readonly Exercise[], heavy: readonly MuscleGroup[]): LiftTarget[] {
  const out: LiftTarget[] = []
  for (const exercise of main) {
    if (!isMainLift(exercise)) continue
    const group = muscleGroupOf(exercise)
    const pattern = PRIMER_PATTERNS.has(exercise.movementPattern) ? exercise.movementPattern : null
    if (!out.some((t) => t.group === group && t.pattern === pattern)) out.push({ group, pattern })
  }
  for (const group of heavy) if (!out.some((t) => t.group === group)) out.push({ group, pattern: null })
  return out
}

/** Light cardio that bends the knee deeply under load each stroke: the rower and stair or step machines. */
const KNEE_FLEXION_CARDIO = /(^|-)(row|rower|rowing|stair|stairs|stepper)(-|$)/

/** Score taken off knee-heavy light cardio for a knee-protecting profile, so the bike, elliptical or walk wins. */
export const KNEE_CARDIO_PENALTY = 6

export function kneeHeavyCardio(exercise: Exercise): boolean {
  return isLightCardio(exercise) && KNEE_FLEXION_CARDIO.test(exercise.id)
}

/** A warm-up drill that rehearses bracing: the dead bug and bird dog primers (core spec C19). */
export function isBracingPrimer(exercise: Exercise): boolean {
  return exercise.category === "warmup" && (exercise.movementPattern === "anti_extension" || exercise.movementPattern === "anti_rotation")
}

/** Patterns whose loaded compounds are braced through the trunk. */
const BRACED_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>(["squat", "hinge", "lunge", "vertical_push"])

/** A compound squat, hinge or lunge, or a standing (not seat- or bench-supported) vertical press. */
function bracedLift(exercise: Exercise): boolean {
  if (!isMainLift(exercise) || !BRACED_PATTERNS.has(exercise.movementPattern)) return false
  return exercise.movementPattern !== "vertical_push" || !isTorsoSupported(exercise)
}

/** Sessions of this length or more give trained lifters a bracing primer before a heavy axial primary. */
export const TRAINED_BRACE_MINUTES = 45

/**
 * Core spec C19: who gets a bracing primer. Beginners and lower-back-flagged users rehearse bracing
 * before any braced lift; trained lifters only when the primary lift is a heavy (ramp-up) squat,
 * hinge or vertical press and the session is 45 minutes or more (their ramp-up sets are the specific
 * practice). `main` is most important first.
 */
export function wantsBracingPrimer(profile: Pick<UserProfile, "experience" | "limitations" | "durationPreferenceMinutes">, main: readonly Exercise[]): boolean {
  if (profile.experience === "beginner" || profile.limitations.includes("lower_back")) return main.some(bracedLift)
  if (profile.durationPreferenceMinutes < TRAINED_BRACE_MINUTES) return false
  const primary = main.find(isMainLift)
  return !!primary && primary.warmupRequired && (primary.movementPattern === "squat" || primary.movementPattern === "hinge" || primary.movementPattern === "vertical_push")
}

/** 3–6 items: cardio first (when equipment allows), then 2–4 drills for the work ahead. */
export function buildWarmup({ pool, profile, focus, heavy = [], main = [], finisher = null, rng }: WarmupOptions): PlannedItem[] {
  const short = profile.durationPreferenceMinutes <= 30
  const drillCount = short ? 2 : profile.durationPreferenceMinutes >= 60 && profile.experience !== "beginner" ? 4 : 3
  const allowed = pool.filter((ex) => passesProfileFilter(ex, profile) && !isCorrective(ex))
  const items: PlannedItem[] = []
  const shoulderFlagged = profile.limitations.includes("shoulder")

  // Focus groups that got no sets today earn nothing; full_body is the day's meta focus and stays.
  const trained = unique(main.map(muscleGroupOf))
  const trainedFocus = trained.length > 0 ? focus.filter((g) => g === "full_body" || trained.includes(g)) : focus
  const relevant = trainedFocus.some((g) => !META_GROUPS.has(g)) ? trainedFocus : focus

  // Light cardio: a beginner starts on low-impact work (bike, walk, march) rather than jumping, and
  // the finisher's own machine wins when there is one (the rower before rowing intervals).
  const cardio = allowed
    .filter(isLightCardio)
    .map((exercise) => ({
      exercise,
      score:
        focusAffinity(exercise, relevant) +
        rng.next() * 2 -
        (profile.limitations.includes("knee") && kneeHeavyCardio(exercise) ? KNEE_CARDIO_PENALTY : 0) +
        (profile.experience === "beginner" && isLowImpact(exercise) ? LOW_IMPACT_BEGINNER_BONUS : 0) +
        (finisher && sharesModality(exercise, finisher) ? FINISHER_MODALITY_BONUS : 0),
    }))
    .sort((a, b) => b.score - a.score || a.exercise.id.localeCompare(b.exercise.id))[0]
  if (cardio) items.push({ exercise: cardio.exercise, prescription: prescribeWarmupItem(cardio.exercise, profile.durationPreferenceMinutes) })

  const scored = allowed
    .filter(isDynamicDrill)
    .map((exercise) => ({
      exercise,
      score:
        focusAffinity(exercise, relevant) +
        rng.next() * 1.5 -
        (shoulderFlagged && isBallistic(exercise) && movesShoulder(exercise) ? SHOULDER_BALLISTIC_PENALTY : 0),
    }))
    .sort((a, b) => b.score - a.score || a.exercise.id.localeCompare(b.exercise.id))
  // A rehearsal primer whose pattern today is trained only by lifts that rehearse themselves (a
  // squat primer on a bodyweight-squat day) only repeats them: its place goes to other work.
  const mainLifts = main.filter(isMainLift)
  const redundant = (drill: Exercise) => {
    const lifts = mainLifts.filter((lift) => lift.movementPattern === drill.movementPattern)
    return lifts.length > 0 && lifts.every((lift) => duplicatesLift(drill, lift))
  }
  // Core spec C19: no ballistic trunk twisting before a heavy squat or hinge.
  const heavyAxial = mainLifts.some((l) => l.warmupRequired && (l.movementPattern === "squat" || l.movementPattern === "hinge"))
  const usable = heavyAxial ? scored.filter(({ exercise }) => !(isBallistic(exercise) && exercise.movementPattern === "rotation")) : scored
  const drills = usable.filter(({ exercise }) => !redundant(exercise))
  const selfPrimed = usable.filter(({ exercise }) => redundant(exercise)).map(({ exercise }) => exercise)

  const wanted = cardio ? drillCount : Math.min(drillCount + 1, 4)
  const limit = wanted + (cardio ? 1 : 0)
  const usedMuscles = new Set<string>()
  const picked: Exercise[] = []
  const add = (exercise: Exercise) => {
    usedMuscles.add(exercise.primaryMuscle)
    picked.push(exercise)
    items.push({ exercise, prescription: prescribeWarmupItem(exercise, profile.durationPreferenceMinutes) })
  }
  // Every drill serves what the session works: the day's focus (generate passes the focus groups
  // that got sets) or a group a main lift loads, so a lift outside the focus, such as a shoulder
  // press standing in on a full-body B day, gets its own primer, and a drill never serves nothing.
  const served = unique([...focus, ...trained])
  const fresh = (exercise: Exercise) => !picked.some((e) => e.id === exercise.id) && serves(exercise, served)

  // First a drill for each lift today: a same-pattern primer when one exists (a hinge drill
  // before an RDL, a squat pattern before squats), else a drill for the lift's group. A squat
  // day gets a hip/knee drill even on a full-body day whose focus also lists chest and back.
  const reservedGroups = new Set<MuscleGroup>()
  const reserve = (target: LiftTarget) => {
    if (items.length >= limit) return
    if (target.pattern) {
      if (picked.some((e) => e.movementPattern === target.pattern)) {
        reservedGroups.add(target.group)
        return
      }
      // The lift is its own rehearsal (bodyweight squats after a squat primer would repeat it):
      // its drill goes to the next lift, not to a mobility drill or stand-in for the same pattern.
      if (selfPrimed.some((e) => e.movementPattern === target.pattern && prepares(e, target.group))) return
      // A rehearsal of the lift (a "warmup" primer) beats a mobility drill that shares its pattern
      // (hip-hinge primer, not a hip airplane, before a deadlift); then the lift's own group.
      const primers = drills
        .filter(({ exercise }) => exercise.movementPattern === target.pattern && prepares(exercise, target.group) && fresh(exercise))
        .map((entry, order) => ({ entry, order, rank: (entry.exercise.category === "warmup" ? 2 : 0) + (ownGroup(entry.exercise) === target.group ? 1 : 0) }))
        .sort((a, b) => b.rank - a.rank || a.order - b.order)
      const primer = primers[0]?.entry
      if (primer) {
        add(primer.exercise)
        reservedGroups.add(target.group)
        return
      }
    }
    if (META_GROUPS.has(target.group) || reservedGroups.has(target.group)) return
    const pick = drills.find(({ exercise }) => prepares(exercise, target.group) && fresh(exercise))
    if (pick) {
      add(pick.exercise)
      reservedGroups.add(target.group)
    }
  }
  const targets = liftTargets(main, heavy)
  if (targets[0]) reserve(targets[0])
  // A protected shoulder gets one controlled cuff drill (band external rotation, pull-aparts)
  // before upper-body lifts, ahead of everything but the primary lift's primer; momentum drills
  // that swing the shoulder were scored down above.
  if (shoulderFlagged && mainLifts.some((lift) => UPPER_LIFT_GROUPS.has(muscleGroupOf(lift))) && items.length < limit && !picked.some(isCuffDrill)) {
    const cuff = drills.find(({ exercise }) => isCuffDrill(exercise) && fresh(exercise))
    if (cuff) add(cuff.exercise)
  }
  // Joint prep before wrist-loaded work (push-ups, handstands, straight-bar curls) comes right
  // after the primary lift's primer, so a short session keeps it.
  if (main.some(loadsWrist) && items.length < limit && !picked.some(preparesWrist)) {
    const wrist = drills.find(({ exercise }) => preparesWrist(exercise) && fresh(exercise))
    if (wrist) add(wrist.exercise)
  }
  // Core spec C19: a bracing primer (dead bug or bird dog primer) before the braced lifts, in a free
  // drill place after the primary lift's primer, the cuff drill and the wrist drill, so it adds no
  // time. Like every drill it serves the session's work (the trunk, the legs, the back). It is a
  // primer, never trunk volume.
  if (wantsBracingPrimer(profile, main) && items.length < limit && !picked.some(isBracingPrimer)) {
    const brace = drills.find(({ exercise }) => isBracingPrimer(exercise) && fresh(exercise))
    if (brace) add(brace.exercise)
  }
  for (const target of targets.slice(1)) reserve(target)

  // Then the best remaining matches: distinct muscles first, then repeats. A drill that does not
  // touch the day's muscles only fills in when fewer than two relevant drills exist.
  for (const pass of ["distinct", "relevant", "any"] as const) {
    for (const { exercise } of drills) {
      if (items.length >= limit) break
      if (pass === "any" && items.length >= (cardio ? 3 : 2)) break
      if (picked.some((e) => e.id === exercise.id)) continue
      if (pass === "distinct" && usedMuscles.has(exercise.primaryMuscle)) continue
      if (pass !== "any" && focusAffinity(exercise, relevant) === 0) continue
      add(exercise)
    }
  }
  return items.slice(0, 6)
}
