/**
 * Cool-down selection: static stretches for the muscles trained, plus a breathing finisher.
 */
import { muscleGroupOf } from "@/lib/exercises"
import type { Exercise, Muscle, MuscleGroup } from "@/lib/exercises/types"
import type { UserProfile } from "@/lib/domain/types"
import type { Rng } from "./random"
import { passesProfileFilter } from "./selection"
import { prescribeLight, type Prescription } from "./prescriptions"
import { focusAffinity, isCorrective, isMainLift, META_GROUPS, ownGroup, serves, unique, type PlannedItem } from "./warmup"

export function isBreathing(exercise: Exercise): boolean {
  const tags = exercise.tags ?? []
  return exercise.id.includes("breath") || tags.includes("breathing") || tags.includes("breathwork")
}

export function isStretch(exercise: Exercise): boolean {
  if (exercise.category !== "stretching" && exercise.category !== "cooldown") return false
  if (exercise.movementPattern === "locomotion" || exercise.movementPattern === "conditioning") return false
  return !isBreathing(exercise)
}

/**
 * Sessions this long or shorter keep the cool-down to about five minutes: three stretches held at
 * the bottom of their range and SHORT_BREATHING_SECONDS of breathing (none at 30 minutes). The
 * cool-down is fixed time the fitter never trims, so a longer one cuts working sets instead.
 */
export const SHORT_COOLDOWN_MAX_MINUTES = 60
export const SHORT_BREATHING_SECONDS = 90

/**
 * Stretches in the cool-down: four only when the session is longer than
 * SHORT_COOLDOWN_MAX_MINUTES, or at 60 minutes when the cool-down is extended.
 */
export function cooldownStretchCount(durationMinutes: number, extended = false): number {
  return durationMinutes > SHORT_COOLDOWN_MAX_MINUTES || (extended && durationMinutes >= 60) ? 4 : 3
}

/**
 * The light prescription a cool-down item gets, from the builder or a swap. Up to
 * SHORT_COOLDOWN_MAX_MINUTES a stretch is held for the bottom of its range (30 s, per side when
 * unilateral) and breathing runs SHORT_BREATHING_SECONDS; longer sessions, and an extended
 * cool-down, keep prescribeLight's longer holds.
 */
export function prescribeCooldownItem(exercise: Exercise, durationMinutes: number, extended = false): Prescription {
  const rx = prescribeLight(exercise, durationMinutes)
  if (extended || durationMinutes > SHORT_COOLDOWN_MAX_MINUTES || rx.durationSeconds === null) return rx
  if (isBreathing(exercise)) return { ...rx, durationSeconds: Math.min(rx.durationSeconds, SHORT_BREATHING_SECONDS) }
  if (exercise.durationRange) return { ...rx, durationSeconds: exercise.durationRange[0] }
  return rx
}

/**
 * Longest the shortest hold of a stretch may take (both sides counted) to be one of a short
 * cool-down's three stretches. A position held for two minutes or more (legs up the wall) is a
 * down-regulation block like the breathing, so it scores LONG_HOLD_PENALTY lower there and is
 * picked only when nothing shorter serves the day.
 */
export const SHORT_STRETCH_MAX_SECONDS = 60
const LONG_HOLD_PENALTY = 6

function minimumHoldSeconds(exercise: Exercise): number {
  return (exercise.durationRange?.[0] ?? 30) * (exercise.isUnilateral ? 2 : 1)
}

/**
 * Neck and upper-trap stretches count as one family: at most one per cool-down, so a
 * shoulder-protected upper day closes with a back stretch rather than two neck stretches.
 */
const NECK_FAMILY: ReadonlySet<Muscle> = new Set<Muscle>(["neck", "traps"])

function isNeckStretch(exercise: Exercise): boolean {
  return NECK_FAMILY.has(exercise.primaryMuscle)
}

/** Score added to a stretch tagged "<area>_friendly" for each flagged area it is built to spare. */
export const FRIENDLY_STRETCH_BONUS = 2

function friendlyBonus(exercise: Exercise, profile: UserProfile): number {
  const tags = exercise.tags ?? []
  return profile.limitations.filter((area) => tags.includes(`${area}_friendly`)).length * FRIENDLY_STRETCH_BONUS
}

export interface CooldownOptions {
  pool: readonly Exercise[]
  profile: UserProfile
  focus: readonly MuscleGroup[]
  /**
   * Groups the main phase actually loaded (primary groups), most important first. Each gets a
   * stretch in that order; a trained group scores as focus, and a focus group with no sets
   * today earns nothing.
   */
  trained?: readonly MuscleGroup[]
  /** Groups today's main lifts load (compounds of any role), most important first: stretched first. */
  heavy?: readonly MuscleGroup[]
  /** The kept main-phase exercises (finisher excluded), most important first. Supplies both lists above. */
  main?: readonly Exercise[]
  /**
   * Longer holds (and a fourth stretch at 60 minutes) for a session whose main work cannot fill
   * the time (weekly caps, few movements for the equipment). By default a session of
   * SHORT_COOLDOWN_MAX_MINUTES or less gets the short cool-down, so the time goes to working sets.
   */
  extended?: boolean
  rng: Rng
}

/**
 * 3–4 stretches for the muscles trained, one per group, then a breathing finisher when there is
 * time. The groups the main lifts loaded come first, then the rest of what was trained in order,
 * so a squat day always closes with a quad stretch instead of whichever stretch won a tie.
 */
export function buildCooldown({ pool, profile, focus, trained = [], heavy = [], main = [], extended = false, rng }: CooldownOptions): PlannedItem[] {
  const short = profile.durationPreferenceMinutes <= 30
  const stretchCount = cooldownStretchCount(profile.durationPreferenceMinutes, extended)
  const allowed = pool.filter((ex) => passesProfileFilter(ex, profile) && !isCorrective(ex))
  const items: PlannedItem[] = []

  const worked = unique([...trained, ...main.map(muscleGroupOf)])
  const lifts = unique([...heavy, ...main.filter(isMainLift).map(muscleGroupOf)])
  const relevant = worked.length > 0 ? worked : focus

  const shortHolds = !extended && profile.durationPreferenceMinutes <= SHORT_COOLDOWN_MAX_MINUTES
  const stretches = allowed
    .filter(isStretch)
    .map((exercise) => ({
      exercise,
      score:
        focusAffinity(exercise, focus, worked) +
        rng.next() * 1.5 +
        friendlyBonus(exercise, profile) -
        (shortHolds && minimumHoldSeconds(exercise) > SHORT_STRETCH_MAX_SECONDS ? LONG_HOLD_PENALTY : 0),
    }))
    .sort((a, b) => b.score - a.score || a.exercise.id.localeCompare(b.exercise.id))

  // One stretch per group (two back stretches leave no room for the quads after a squat day), and
  // at most one from the neck family.
  const usedGroups = new Set<MuscleGroup>()
  const add = (exercise: Exercise) => {
    usedGroups.add(muscleGroupOf(exercise))
    items.push({ exercise, prescription: prescribeCooldownItem(exercise, profile.durationPreferenceMinutes, extended) })
  }
  const taken = (exercise: Exercise) =>
    items.some((i) => i.exercise.id === exercise.id) || (isNeckStretch(exercise) && items.some((i) => isNeckStretch(i.exercise)))
  const open = (exercise: Exercise) => !taken(exercise) && !usedGroups.has(muscleGroupOf(exercise))

  // One stretch per group the session loaded: main lifts first, then the other trained groups.
  // A stretch for the muscle the main work loaded wins (a lat stretch after pulldowns, a glute
  // stretch rather than an adductor one after hip thrusts), then any stretch of that group. A
  // group whose own stretches a limitation rules out is skipped, not filled by another region's
  // stretch that only shares a tag (no cobra as the chest stretch, no neck stretch for the
  // delts); the passes below cover what is left. Every pick here is the group's own stretch, so
  // it is recorded under the group it was chosen for.
  for (const group of unique([...lifts, ...worked])) {
    if (items.length >= stretchCount) break
    if (META_GROUPS.has(group) || usedGroups.has(group)) continue
    const loaded = main.filter((ex) => muscleGroupOf(ex) === group).map((ex) => ex.primaryMuscle)
    const own = stretches.filter(({ exercise }) => open(exercise) && ownGroup(exercise) === group && serves(exercise, relevant))
    const pick = own.find(({ exercise }) => loaded.includes(exercise.primaryMuscle)) ?? own[0]
    if (pick) add(pick.exercise)
  }
  // Then the best remaining stretches for other groups: first those that also reach a main lift's
  // group (a glute stretch tagged for the quads after squats, not a lat stretch tagged for the
  // trunk), then any the day touched. Only when fewer than two stretches exist (limitations leave
  // one relevant group) does a second stretch for a trained group fill in, and only after that an
  // unrelated one (a quad stretch never closes a pull day).
  for (const pass of ["lifts", "relevant", "repeat", "any"] as const) {
    if (pass === "lifts" && lifts.length === 0) continue
    for (const { exercise } of stretches) {
      if (items.length >= stretchCount) break
      if ((pass === "repeat" || pass === "any") && items.length >= 2) break
      if (taken(exercise)) continue
      if (pass !== "repeat" && usedGroups.has(muscleGroupOf(exercise))) continue
      if (pass === "lifts" && !serves(exercise, lifts)) continue
      if (pass !== "any" && focusAffinity(exercise, focus, worked) === 0) continue
      add(exercise)
    }
  }

  if (!short) {
    const breathing = allowed.filter(isBreathing).sort((a, b) => a.id.localeCompare(b.id))[0]
    if (breathing) items.push({ exercise: breathing, prescription: prescribeCooldownItem(breathing, profile.durationPreferenceMinutes, extended) })
  }
  return items
}
