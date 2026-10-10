/**
 * Core-training audit (core spec C21): weekly coverage, loading, placement and time of direct trunk
 * work across the whole profile space over two simulated weeks, plus a limitation slice.
 *
 *   CORE_AUDIT=1 pnpm exec vitest run scripts/coach/core-audit.test.ts
 *   CORE_AUDIT=1 CORE_AUDIT_ASSERT=1 ...   also fails the run when an acceptance target is missed
 *
 * Writes .coach/core-audit.json (summary, acceptance checks, per-profile rows) and prints the
 * summary and checks. "No increase" targets are compared with .coach/core-audit.baseline.json, the
 * same metrics measured on the engine before the core spec, when that file exists. The grid is
 * skipped during the normal test run; the aggregation unit test below always runs.
 *
 * Core is counted as main-phase, non-finisher work whose exercise is core category or has core as
 * its primary group, minus conditioning-tagged drills (C13). Families follow selection.ts
 * coreFamily (C07). Bracing primers are dead-bug-primer and bird-dog-primer only (C19).
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { addDays } from "@/lib/dates"
import type { CompletedWorkout, DurationPreference, EquipmentPreset, TrainingDays, UserProfile } from "@/lib/domain/types"
import { EQUIPMENT_PRESETS } from "@/lib/domain/types"
import type { EngineInput, Workout, WorkoutExercise } from "@/lib/engine"
import { FIT_CEILING } from "@/lib/engine/duration"
import { generateWorkout as generateLive } from "@/lib/engine/generate"
import { CORE_WEEKLY_SETS, coreWeeklyCap } from "@/lib/engine/recovery"
import { coreFamily, isTorsoSupported, loadableTrunk, type CoreFamily } from "@/lib/engine/selection"
import { MAX_CORE_DAYS } from "@/lib/engine/splits"
import { completeAtTop, makeInput, makeProfile, progressFromHistory } from "@/lib/engine/test-fixtures"
import { getExercise as liveGetExercise, muscleGroupOf } from "@/lib/exercises"
import type { BodyArea, Difficulty, Exercise, Goal } from "@/lib/exercises/types"

const OUT = path.resolve(import.meta.dirname, "../../.coach/core-audit.json")
const BASELINE = path.resolve(import.meta.dirname, "../../.coach/core-audit.baseline.json")

export const GOALS: Goal[] = ["muscle_gain", "strength", "fat_loss", "general_fitness", "endurance"]
export const LEVELS: Difficulty[] = ["beginner", "intermediate", "advanced"]
export type Preset = Exclude<EquipmentPreset, "custom">
export const PRESETS: Preset[] = ["full_gym", "dumbbells", "home_gym", "bodyweight"]
const DAYS: TrainingDays[] = [2, 3, 4, 5, 6]
const DURATIONS: DurationPreference[] = [30, 45, 60, 75]
const LIMITATIONS: BodyArea[] = ["lower_back", "shoulder", "neck", "hip", "knee", "wrist"]
/** Data change D08: head-lifted flexion drills a neck-flagged lifter must never get. */
const NECK_DRILLS = ["crunch", "bicycle-crunch", "sit-up", "decline-sit-up", "v-up", "hollow-body-hold", "flutter-kick"]
const BRACING_PRIMERS = new Set(["dead-bug-primer", "bird-dog-primer"])
/**
 * Data change D09: hip-flexor-led floor drills (hip_flexor_led without hanging), listed by id so the
 * baseline, measured on data without the tag, counts the same drills.
 */
const HIP_FLEXOR_FLOOR_DRILLS = [
  "flutter-kick", "lying-leg-raise", "seated-knee-tuck", "sit-up", "decline-sit-up", "v-up", "russian-twist", "medicine-ball-russian-twist", "mountain-climber",
]
/** C22: no core-slot note sells trunk work as fat loss, toning or injury prevention. */
export const C22_PATTERN = /fat|burn|belly|waist|ton(e|ing)|injur(y|ies)[- ]proof|prevent/i

/** Training-day offsets within a week for each frequency (Mon = 0). */
export const WEEK: Record<TrainingDays, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] }

export interface ProfileSpec {
  goal: Goal
  experience: Difficulty
  preset: Preset
  days: TrainingDays
  minutes: DurationPreference
  limitations: BodyArea[]
}

/** What the audit needs from an engine: the live one, or a pre-change copy for the baseline. */
export interface AuditEngine {
  generate: (input: EngineInput) => Workout
  getExercise: (id: string) => Exercise | undefined
  /** The same day planned without core protection (C03 compound and time checks), live engine only. */
  unprotected?: (input: EngineInput) => Workout
}

export const LIVE_ENGINE: AuditEngine = {
  generate: (input) => generateLive(input),
  getExercise: liveGetExercise,
  unprotected: (input) => generateLive(input, undefined, { coreProtection: false }),
}

export function isCoreSlot(e: WorkoutExercise, getExercise: AuditEngine["getExercise"] = liveGetExercise): boolean {
  if (e.phase !== "main" || e.role === "finisher") return false
  const ex = getExercise(e.exerciseId)
  if (!ex || ex.tags?.includes("conditioning")) return false
  return ex.category === "core" || muscleGroupOf(ex) === "core"
}

const isCompoundRole = (e: WorkoutExercise) => e.role === "primary_compound" || e.role === "secondary_compound"

/** One generated session, reduced to what the audit measures. */
export interface SessionStats {
  week: number
  minutes: number
  coreSets: number
  coreIds: string[]
  families: CoreFamily[]
  /** Primary and secondary compound sets. */
  compoundSets: number
  overBudget: boolean
  /** A core main exercise before a primary, secondary or loaded compound accessory (C05). */
  orderViolation: boolean
  /** Beginner or lower-back-flagged lifter with a braced lift (C19), and whether a primer was there. */
  bracedTarget: boolean
  primer: boolean
  /** torso-twists in the warm-up before a warmupRequired squat or hinge (C19). */
  twistBeforeHeavy: boolean
  /** Exercise ids in the session whose contraindications intersect the profile's limitations. */
  contraindicated: string[]
  /** Core-slot notes that match the C22 pattern. */
  copyViolations: string[]
  /** mountain-climber in a main-phase, non-finisher slot (C13: it is conditioning, never a core slot). */
  mountainClimberCore: boolean
  /** Compound sets below the unprotected plan of the same day, and over budget only because of core. */
  compoundLoss: boolean
  overBudgetVsUnprotected: boolean
}

export function sessionStats(w: Workout, spec: ProfileSpec, week: number, engine: AuditEngine, unprotected?: Workout | null): SessionStats {
  const getExercise = engine.getExercise
  const main = w.exercises.filter((e) => e.phase === "main")
  const core = main.filter((e) => isCoreSlot(e, getExercise))
  const coreIds = core.map((e) => e.exerciseId)
  const families = [...new Set(coreIds.map((id) => coreFamily(getExercise(id)!)).filter((f): f is CoreFamily => f !== null))]
  const ceiling = Math.round(spec.minutes * FIT_CEILING)
  const firstCore = main.findIndex((e) => isCoreSlot(e, getExercise))
  const orderViolation =
    firstCore >= 0 &&
    main.slice(firstCore + 1).some((e) => {
      const ex = getExercise(e.exerciseId)
      if (!ex || ex.category === "core") return false
      return isCompoundRole(e) || (ex.mechanics === "compound" && e.role === "accessory")
    })
  const braced = main.some((e) => {
    const ex = getExercise(e.exerciseId)
    if (!ex || ex.mechanics !== "compound" || ex.category === "core" || ex.category === "cardio") return false
    if (ex.movementPattern === "vertical_push") return !isTorsoSupported(ex)
    return ex.movementPattern === "squat" || ex.movementPattern === "hinge" || ex.movementPattern === "lunge"
  })
  const heavySquatOrHinge = main.some((e) => {
    const ex = getExercise(e.exerciseId)
    return !!ex && ex.warmupRequired && (ex.movementPattern === "squat" || ex.movementPattern === "hinge")
  })
  const warmup = w.exercises.filter((e) => e.phase === "warmup")
  let compoundLoss = false
  let overBudgetVsUnprotected = false
  if (unprotected) {
    const setsOf = (x: Workout) => new Map(x.exercises.filter((e) => e.phase === "main" && isCompoundRole(e)).map((e) => [e.exerciseId, e.sets]))
    const on = setsOf(w)
    compoundLoss = [...setsOf(unprotected)].some(([id, sets]) => (on.get(id) ?? 0) < sets)
    overBudgetVsUnprotected = w.estimatedMinutes > ceiling && unprotected.estimatedMinutes <= ceiling
  }
  return {
    week,
    minutes: w.estimatedMinutes,
    coreSets: core.reduce((s, e) => s + e.sets, 0),
    coreIds,
    families,
    compoundSets: main.filter(isCompoundRole).reduce((s, e) => s + e.sets, 0),
    overBudget: w.estimatedMinutes > ceiling,
    orderViolation,
    bracedTarget: braced && (spec.experience === "beginner" || spec.limitations.includes("lower_back")),
    primer: warmup.some((e) => BRACING_PRIMERS.has(e.exerciseId)),
    twistBeforeHeavy: heavySquatOrHinge && warmup.some((e) => e.exerciseId === "torso-twists"),
    contraindicated: w.exercises
      .filter((e) => getExercise(e.exerciseId)?.contraindications.some((a) => spec.limitations.includes(a)))
      .map((e) => e.exerciseId),
    copyViolations: core.map((e) => e.note ?? "").filter((n) => C22_PATTERN.test(n)),
    mountainClimberCore: main.some((e) => e.exerciseId === "mountain-climber" && e.role !== "finisher"),
    compoundLoss,
    overBudgetVsUnprotected,
  }
}

export interface WeekStats {
  sessions: number
  coreSessions: number
  coreSets: number
  families: CoreFamily[]
}

export interface ProfileRow extends ProfileSpec {
  weeks: WeekStats[]
  sessions: number
  coreSessions: number
  families: CoreFamily[]
  /** Distinct core exercise ids over two weeks. */
  picks: string[]
  overBudget: number
  /** Sum of the sessions' estimated minutes. */
  minutesTotal: number
  compoundSets: number
  orderViolations: number
  bracedSessions: number
  bracedWithPrimer: number
  twistBeforeHeavy: number
  contraindicated: string[]
  copyViolations: string[]
  mountainClimberCore: number
  compoundLoss: number
  overBudgetVsUnprotected: number
}

/** Per-week and per-profile totals from a profile's sessions (two weeks). */
export function aggregateProfile(spec: ProfileSpec, sessions: readonly SessionStats[]): ProfileRow {
  const weekCount = Math.max(2, ...sessions.map((s) => s.week + 1))
  const weeks: WeekStats[] = Array.from({ length: weekCount }, (_, week) => {
    const inWeek = sessions.filter((s) => s.week === week)
    return {
      sessions: inWeek.length,
      coreSessions: inWeek.filter((s) => s.coreIds.length > 0).length,
      coreSets: inWeek.reduce((n, s) => n + s.coreSets, 0),
      families: [...new Set(inWeek.flatMap((s) => s.families))].sort(),
    }
  })
  const count = (f: (s: SessionStats) => boolean) => sessions.filter(f).length
  return {
    ...spec,
    weeks,
    sessions: sessions.length,
    coreSessions: count((s) => s.coreIds.length > 0),
    families: [...new Set(sessions.flatMap((s) => s.families))].sort(),
    picks: [...new Set(sessions.flatMap((s) => s.coreIds))].sort(),
    overBudget: count((s) => s.overBudget),
    minutesTotal: sessions.reduce((n, s) => n + s.minutes, 0),
    compoundSets: sessions.reduce((n, s) => n + s.compoundSets, 0),
    orderViolations: count((s) => s.orderViolation),
    bracedSessions: count((s) => s.bracedTarget),
    bracedWithPrimer: count((s) => s.bracedTarget && s.primer),
    twistBeforeHeavy: count((s) => s.twistBeforeHeavy),
    contraindicated: [...new Set(sessions.flatMap((s) => s.contraindicated))].sort(),
    copyViolations: [...new Set(sessions.flatMap((s) => s.copyViolations))],
    mountainClimberCore: count((s) => s.mountainClimberCore),
    compoundLoss: count((s) => s.compoundLoss),
    overBudgetVsUnprotected: count((s) => s.overBudgetVsUnprotected),
  }
}

export function auditProfile(spec: ProfileSpec, engine: AuditEngine = LIVE_ENGINE): ProfileRow {
  const profile: UserProfile = makeProfile({
    id: `core-${spec.goal}-${spec.experience}-${spec.preset}-${spec.days}-${spec.minutes}${spec.limitations.map((l) => `-${l}`).join("")}`,
    goal: spec.goal,
    experience: spec.experience,
    equipmentPreset: spec.preset,
    equipment: EQUIPMENT_PRESETS[spec.preset],
    trainingDaysPerWeek: spec.days,
    durationPreferenceMinutes: spec.minutes,
    gender: "unspecified",
    weightKg: 75,
    limitations: spec.limitations,
  })
  const history: CompletedWorkout[] = []
  const sessions: SessionStats[] = []
  for (let week = 0; week < 2; week++) {
    for (const offset of WEEK[spec.days]) {
      const date = addDays("2026-10-05", week * 7 + offset)
      const input = makeInput(profile, date, [...history].reverse(), progressFromHistory(history))
      const w = engine.generate(input)
      sessions.push(sessionStats(w, spec, week, engine, engine.unprotected?.(input) ?? null))
      history.push(completeAtTop(w, engine.getExercise, 40, { loads: "plausible", lifter: { weightKg: 75, experience: spec.experience } }))
    }
  }
  return aggregateProfile(spec, sessions)
}

export function mainGrid(): ProfileSpec[] {
  const out: ProfileSpec[] = []
  for (const goal of GOALS)
    for (const experience of LEVELS)
      for (const preset of PRESETS)
        for (const days of DAYS) for (const minutes of DURATIONS) out.push({ goal, experience, preset, days, minutes, limitations: [] })
  return out
}

/** C21: 6 limitations x 4 presets x {strength, fat_loss} x {beginner, intermediate} x {2, 4} days x {30, 60} min. */
export function limitationGrid(): ProfileSpec[] {
  const out: ProfileSpec[] = []
  for (const limitation of LIMITATIONS)
    for (const preset of PRESETS)
      for (const goal of ["strength", "fat_loss"] as Goal[])
        for (const experience of ["beginner", "intermediate"] as Difficulty[])
          for (const days of [2, 4] as TrainingDays[])
            for (const minutes of [30, 60] as DurationPreference[]) out.push({ goal, experience, preset, days, minutes, limitations: [limitation] })
  return out
}

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0)
const round2 = (n: number) => Math.round(n * 100) / 100
const sum = (rows: readonly ProfileRow[], f: (r: ProfileRow) => number) => rows.reduce((n, r) => n + f(r), 0)

export type CoreAuditSummary = ReturnType<typeof summarize>

export function summarize(rows: readonly ProfileRow[], limits: readonly ProfileRow[], getExercise: AuditEngine["getExercise"] = liveGetExercise) {
  const weeks = rows.flatMap((r) => r.weeks.map((w) => ({ r, w })))
  const weeksAt = (m: number) => weeks.filter(({ r }) => r.minutes === m)
  const at45 = weeks.filter(({ r }) => r.minutes >= 45)
  const ex = (id: string) => getExercise(id)
  const trained = rows.filter((r) => (r.goal === "strength" || r.goal === "muscle_gain") && r.experience !== "beginner" && r.preset !== "bodyweight")
  const mgTrained = trained.filter((r) => r.goal === "muscle_gain")
  const mgWeeks = mgTrained.flatMap((r) => r.weeks)
  const strengthTrained = rows.filter((r) => r.goal === "strength" && r.experience !== "beginner")
  const threePlus = rows.filter((r) => r.weeks.every((w) => w.coreSessions >= 3))
  const coreRows = rows.filter((r) => r.coreSessions > 0)
  const sessionsBy = (m: number) => rows.filter((r) => r.minutes === m)
  const by30Goal = Object.fromEntries(
    GOALS.map((g) => {
      const rs = rows.filter((r) => r.minutes === 30 && r.goal === g)
      return [g, round2(sum(rs, (r) => r.compoundSets) / Math.max(1, sum(rs, (r) => r.sessions)))]
    }),
  )
  const pickProfiles = new Map<string, number>()
  for (const r of rows) for (const id of r.picks) pickProfiles.set(id, (pickProfiles.get(id) ?? 0) + 1)
  const suitcaseBy: Record<string, string[]> = {}
  for (const goal of GOALS)
    suitcaseBy[goal] = (["dumbbells", "home_gym", "full_gym"] as Preset[]).filter((p) =>
      rows.some((r) => r.goal === goal && r.preset === p && r.picks.includes("suitcase-carry")),
    )
  const shoulderLoaded = limits.filter((r) => r.limitations.includes("shoulder") && r.preset !== "bodyweight")
  const neckRows = limits.filter((r) => r.limitations.includes("neck"))
  return {
    profiles: rows.length,
    sessions: sum(rows, (r) => r.sessions),
    zeroCoreProfiles: rows.filter((r) => r.coreSessions === 0).length,
    zeroCoreExamples: rows.filter((r) => r.coreSessions === 0).slice(0, 25).map(label),
    weeksWith2PlusCorePct: pct(weeks.filter(({ w }) => w.coreSessions >= 2).length, weeks.length),
    weeksWith2PlusCoreAt30Pct: pct(weeksAt(30).filter(({ w }) => w.coreSessions >= 2).length, weeksAt(30).length),
    weeksOverMaxCoreDays: weeks.filter(({ r, w }) => w.coreSessions > MAX_CORE_DAYS[r.days]).length,
    coreSessionSharePctByMinutes: Object.fromEntries(
      DURATIONS.map((m) => [m, pct(sum(sessionsBy(m), (r) => r.coreSessions), sum(sessionsBy(m), (r) => r.sessions))]),
    ),
    weeksOverCoreCap: weeks.filter(({ r, w }) => w.coreSets > coreWeeklyCap(r.goal, r.experience)).length,
    maxWeeklyCoreSets: Math.max(0, ...weeks.map(({ w }) => w.coreSets)),
    weeksWith4PlusSetsPct: pct(weeks.filter(({ w }) => w.coreSets >= 4).length, weeks.length),
    goalFloorMetAt45PlusPct: pct(at45.filter(({ r, w }) => w.coreSets >= CORE_WEEKLY_SETS[r.goal][r.experience][0]).length, at45.length),
    meanFamiliesPerTwoWeeks: round2(sum(rows, (r) => r.families.length) / Math.max(1, rows.length)),
    coreProfilesUnder2Families: coreRows.filter((r) => r.families.length < 2).length,
    threePlusCoreProfiles: threePlus.length,
    threePlusWith3FamiliesPct: pct(threePlus.filter((r) => r.families.length >= 3).length, threePlus.length),
    antiRotationOrLateralPct: pct(rows.filter((r) => r.families.some((f) => f === "anti_rotation" || f === "anti_lateral")).length, rows.length),
    muscleGainTrainedFlexionWeeksPct: pct(mgWeeks.filter((w) => w.families.includes("flexion_rotation")).length, mgWeeks.length),
    strengthTrainedExtensionAndLateralPct: pct(
      strengthTrained.filter((r) => r.families.includes("anti_extension") && r.families.includes("anti_lateral")).length,
      strengthTrained.length,
    ),
    loadableTrunkTrainedPct: pct(trained.filter((r) => r.picks.some((id) => !!ex(id) && loadableTrunk(ex(id)!))).length, trained.length),
    hipFlexorLedTrainedPct: pct(
      trained.filter((r) => r.picks.some((id) => HIP_FLEXOR_FLOOR_DRILLS.includes(id))).length,
      trained.length,
    ),
    mountainClimberCoreProfiles: rows.filter((r) => r.mountainClimberCore > 0).length,
    suitcaseCarryProfiles: pickProfiles.get("suitcase-carry") ?? 0,
    suitcaseCarryPresetsByGoal: suitcaseBy,
    orderViolations: sum(rows, (r) => r.orderViolations),
    overBudgetSessions: sum(rows, (r) => r.overBudget),
    overBudgetSessionsAt30: sum(sessionsBy(30), (r) => r.overBudget),
    meanEstimatedMinutesByDuration: Object.fromEntries(
      DURATIONS.map((m) => [m, round2(sum(sessionsBy(m), (r) => r.minutesTotal) / Math.max(1, sum(sessionsBy(m), (r) => r.sessions)))]),
    ),
    compoundSetsPer30MinSessionByGoal: by30Goal,
    compoundLossVsUnprotected: sum(rows, (r) => r.compoundLoss),
    overBudgetVsUnprotected: sum(rows, (r) => r.overBudgetVsUnprotected),
    beginnersFlexionOnlyPct: pct(
      rows.filter((r) => r.experience === "beginner" && r.families.length > 0 && r.families.every((f) => f === "flexion_rotation")).length,
      rows.filter((r) => r.experience === "beginner").length,
    ),
    bracingPrimerPct: pct(sum([...rows, ...limits], (r) => r.bracedWithPrimer), sum([...rows, ...limits], (r) => r.bracedSessions)),
    twistBeforeHeavySquatOrHinge: sum([...rows, ...limits], (r) => r.twistBeforeHeavy),
    copyViolations: [...rows, ...limits].flatMap((r) => r.copyViolations).length,
    limitation: {
      profiles: limits.length,
      contraindicatedProfiles: limits.filter((r) => r.contraindicated.length > 0).length,
      contraindicatedExamples: limits.filter((r) => r.contraindicated.length > 0).slice(0, 10).map((r) => `${label(r)}: ${r.contraindicated.join(",")}`),
      zeroCoreProfiles: limits.filter((r) => r.coreSessions === 0).length,
      zeroCoreExamples: limits.filter((r) => r.coreSessions === 0).slice(0, 25).map(label),
      neckDrillPicks: neckRows.filter((r) => r.picks.some((id) => NECK_DRILLS.includes(id))).length,
      shoulderLoadedProfiles: shoulderLoaded.length,
      shoulderLoadedSuitcasePct: pct(shoulderLoaded.filter((r) => r.picks.includes("suitcase-carry")).length, shoulderLoaded.length),
    },
    picksByProfiles: Object.fromEntries([...pickProfiles].sort((a, b) => b[1] - a[1])),
  }
}

function label(r: ProfileSpec): string {
  return `${r.goal}/${r.experience}/${r.preset}/${r.days}d/${r.minutes}m${r.limitations.length ? `/${r.limitations.join("+")}` : ""}`
}

export interface AcceptanceCheck {
  target: string
  met: boolean
  measured: string
}

/** The core spec's acceptance targets. `base` is the same summary on the pre-change engine, when measured. */
export function acceptanceChecks(s: CoreAuditSummary, base: CoreAuditSummary | null): AcceptanceCheck[] {
  const checks: AcceptanceCheck[] = []
  const add = (target: string, met: boolean, measured: string) => checks.push({ target, met, measured })
  add("Zero-core profiles: 0", s.zeroCoreProfiles === 0, `${s.zeroCoreProfiles}`)
  add("Profile-weeks with >= 2 core sessions: >= 95% overall", s.weeksWith2PlusCorePct >= 95, `${s.weeksWith2PlusCorePct}%`)
  add("Profile-weeks with >= 2 core sessions at 30 minutes: >= 90%", s.weeksWith2PlusCoreAt30Pct >= 90, `${s.weeksWith2PlusCoreAt30Pct}%`)
  add("Profile-weeks over MAX_CORE_DAYS: 0", s.weeksOverMaxCoreDays === 0, `${s.weeksOverMaxCoreDays}`)
  const share = s.coreSessionSharePctByMinutes as Record<string, number>
  add("Core session share at 30 minutes: >= 55%", share["30"]! >= 55, `${share["30"]}%`)
  add(
    "Core session share at 45-75 minutes: 60-90%",
    [45, 60, 75].every((m) => share[m]! >= 60 && share[m]! <= 90),
    `45/60/75 = ${share["45"]}/${share["60"]}/${share["75"]}%`,
  )
  add("Profile-weeks over coreWeeklyCap: 0", s.weeksOverCoreCap === 0, `${s.weeksOverCoreCap} (max ${s.maxWeeklyCoreSets} sets in a week)`)
  add("Profile-weeks with >= 4 core sets: >= 95%", s.weeksWith4PlusSetsPct >= 95, `${s.weeksWith4PlusSetsPct}%`)
  add("Goal floor met at 45+ minutes: >= 80% of profile-weeks", s.goalFloorMetAt45PlusPct >= 80, `${s.goalFloorMetAt45PlusPct}%`)
  add("Mean families per two weeks: >= 2.5", s.meanFamiliesPerTwoWeeks >= 2.5, `${s.meanFamiliesPerTwoWeeks}`)
  add("Every profile with core has >= 2 families", s.coreProfilesUnder2Families === 0, `${s.coreProfilesUnder2Families} profiles under 2`)
  add(
    "Profiles with >= 3 core sessions every week: >= 90% reach 3 families",
    s.threePlusWith3FamiliesPct >= 90,
    `${s.threePlusWith3FamiliesPct}% of ${s.threePlusCoreProfiles}`,
  )
  add("Anti-rotation or anti-lateral in >= 90% of profiles", s.antiRotationOrLateralPct >= 90, `${s.antiRotationOrLateralPct}%`)
  add("Muscle gain I/A, loaded presets: flexion in >= 90% of profile-weeks", s.muscleGainTrainedFlexionWeeksPct >= 90, `${s.muscleGainTrainedFlexionWeeksPct}%`)
  add(
    "Strength I/A: anti_extension and anti_lateral in two weeks in >= 85% of profiles",
    s.strengthTrainedExtensionAndLateralPct >= 85,
    `${s.strengthTrainedExtensionAndLateralPct}%`,
  )
  add("Trained strength/hypertrophy, loaded presets: loadable trunk >= 70%", s.loadableTrunkTrainedPct >= 70, `${s.loadableTrunkTrainedPct}%`)
  add("Trained strength/hypertrophy, loaded presets: hip-flexor-led floor drills <= 10%", s.hipFlexorLedTrainedPct <= 10, `${s.hipFlexorLedTrainedPct}%`)
  add("mountain-climber core-slot picks: 0", s.mountainClimberCoreProfiles === 0, `${s.mountainClimberCoreProfiles}`)
  const suitcaseMissing = Object.entries(s.suitcaseCarryPresetsByGoal).flatMap(([g, ps]) =>
    (["dumbbells", "home_gym", "full_gym"] as const).filter((p) => !ps.includes(p)).map((p) => `${g}/${p}`),
  )
  add(
    "suitcase-carry in >= 1 profile per goal on dumbbells, home_gym and full_gym",
    suitcaseMissing.length === 0,
    `${s.suitcaseCarryProfiles} profiles; missing: ${suitcaseMissing.join(", ") || "none"}`,
  )
  add("Order violations: 0", s.orderViolations === 0, `${s.orderViolations}`)
  if (base) {
    add(
      "Over-budget sessions: no increase vs baseline (overall and at 30 minutes)",
      s.overBudgetSessions <= base.overBudgetSessions && s.overBudgetSessionsAt30 <= base.overBudgetSessionsAt30,
      `${s.overBudgetSessions} (baseline ${base.overBudgetSessions}); at 30 min ${s.overBudgetSessionsAt30} (baseline ${base.overBudgetSessionsAt30})`,
    )
    const lower = GOALS.filter((g) => s.compoundSetsPer30MinSessionByGoal[g]! < base.compoundSetsPer30MinSessionByGoal[g]!)
    add(
      "Mean primary+secondary sets per 30-minute session not lower than baseline for any goal",
      lower.length === 0,
      GOALS.map((g) => `${g} ${s.compoundSetsPer30MinSessionByGoal[g]} (base ${base.compoundSetsPer30MinSessionByGoal[g]})`).join("; "),
    )
  } else {
    add("Time targets vs baseline", false, "no .coach/core-audit.baseline.json to compare with")
  }
  add("Beginners with only flexion/rotation picks: <= 2%", s.beginnersFlexionOnlyPct <= 2, `${s.beginnersFlexionOnlyPct}%`)
  add("Bracing primer in >= 90% of beginner/lower-back braced sessions", s.bracingPrimerPct >= 90, `${s.bracingPrimerPct}%`)
  add("torso-twists before a heavy squat or hinge: 0", s.twistBeforeHeavySquatOrHinge === 0, `${s.twistBeforeHeavySquatOrHinge}`)
  const L = s.limitation
  add("Limitation slice: 0 contraindicated picks", L.contraindicatedProfiles === 0, `${L.contraindicatedProfiles} profiles`)
  add("Limitation slice: 0 zero-core profiles", L.zeroCoreProfiles === 0, `${L.zeroCoreProfiles}`)
  add("Limitation slice: 0 neck-flagged picks of the D08 drills", L.neckDrillPicks === 0, `${L.neckDrillPicks}`)
  add(
    "Limitation slice: suitcase-carry in >= 90% of shoulder-flagged loaded-preset profiles",
    L.shoulderLoadedSuitcasePct >= 90,
    `${L.shoulderLoadedSuitcasePct}% of ${L.shoulderLoadedProfiles}`,
  )
  add("Copy: 0 core-slot notes matching the C22 pattern", s.copyViolations === 0, `${s.copyViolations}`)
  return checks
}

export function runCoreAudit(engine: AuditEngine) {
  const rows = mainGrid().map((p) => auditProfile(p, engine))
  const limits = limitationGrid().map((p) => auditProfile(p, engine))
  return { summary: summarize(rows, limits, engine.getExercise), rows, limits }
}

describe("core audit aggregation", () => {
  const spec: ProfileSpec = { goal: "general_fitness", experience: "intermediate", preset: "full_gym", days: 3, minutes: 30, limitations: [] }
  const slot = (exerciseId: string, role: WorkoutExercise["role"], sets: number, phase: WorkoutExercise["phase"] = "main"): WorkoutExercise => ({
    slotId: `${exerciseId}-${role}`,
    exerciseId,
    phase,
    role,
    sets,
    reps: [8, 10],
    durationSeconds: null,
    restSeconds: 60,
    tempo: null,
    rir: 2,
    recommendedWeightKg: null,
    note: null,
    replacedFromExerciseId: null,
  })
  const day = (exercises: WorkoutExercise[], estimatedMinutes = 30) => ({ exercises, estimatedMinutes }) as Workout

  it("counts core sessions, sets and families per calendar week", () => {
    const weeks = [
      // Week 1: Pallof press (anti-rotation) and a plank (anti-extension); a mountain-climber finisher is not core.
      [
        day([slot("barbell-back-squat", "primary_compound", 3), slot("pallof-press", "accessory", 2)]),
        day([slot("barbell-bench-press", "primary_compound", 3), slot("mountain-climber", "finisher", 3)]),
        day([slot("plank", "accessory", 3), slot("conventional-deadlift", "secondary_compound", 3)], 40),
      ],
      // Week 2: one session with a crunch (flexion); a bracing primer in a warm-up never counts.
      [
        day([slot("dead-bug-primer", "warmup", 1, "warmup"), slot("barbell-back-squat", "primary_compound", 3)]),
        day([slot("crunch", "isolation", 2)]),
        day([slot("bent-over-barbell-row", "primary_compound", 3)]),
      ],
    ]
    const sessions = weeks.flatMap((ws, week) => ws.map((w) => sessionStats(w, spec, week, LIVE_ENGINE)))
    const row = aggregateProfile(spec, sessions)
    expect(row.weeks.map((w) => [w.sessions, w.coreSessions, w.coreSets])).toEqual([
      [3, 2, 5],
      [3, 1, 2],
    ])
    expect(row.weeks[0]!.families).toEqual(["anti_extension", "anti_rotation"])
    expect(row.families).toEqual(["anti_extension", "anti_rotation", "flexion_rotation"])
    expect(row.picks).toEqual(["crunch", "pallof-press", "plank"])
    // The plank comes before the deadlift: one order violation. 40 minutes is over round(30 x FIT_CEILING).
    expect(row.orderViolations).toBe(1)
    expect(row.overBudget).toBe(1)
    expect(row.compoundSets).toBe(15)
  })
})

describe.skipIf(!process.env.CORE_AUDIT)("core audit", () => {
  it("measures core coverage, loading, placement and time", () => {
    const { summary, rows, limits } = runCoreAudit(LIVE_ENGINE)
    const base = fs.existsSync(BASELINE) ? (JSON.parse(fs.readFileSync(BASELINE, "utf8")).summary as CoreAuditSummary) : null
    const acceptance = acceptanceChecks(summary, base)
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, JSON.stringify({ summary, acceptance, rows, limitationRows: limits }, null, 1))
    console.log(JSON.stringify({ summary, acceptance }, null, 1))
    if (process.env.CORE_AUDIT_ASSERT) expect(acceptance.filter((c) => !c.met).map((c) => `${c.target}: ${c.measured}`)).toEqual([])
  }, 3_600_000)
})
