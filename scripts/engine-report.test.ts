/**
 * Engine report: generates workouts across the whole profile space, prints a
 * representative sample and asserts the invariants a coach would insist on.
 *
 * Run with `pnpm exec vitest run scripts`. Set FORGE_REPORT=full to print every
 * generated workout instead of the sample, or FORGE_REPORT=quiet to print only
 * the audit summary.
 */
import { describe, expect, it } from "vitest"
import { EXERCISES, getExercise, muscleGroupOf } from "@/lib/exercises"
import { ALL_MUSCLE_GROUPS, type Goal, type MuscleGroup } from "@/lib/exercises/types"
import type {
  CompletedWorkout,
  DurationPreference,
  EquipmentPreset,
  Experience,
  TrainingDays,
  UserProfile,
} from "@/lib/domain/types"
import { EQUIPMENT_PRESETS } from "@/lib/domain/types"
import {
  estimateDurationMinutes,
  explainWorkout,
  generateWorkout,
  replaceExercise,
  type Workout,
  type WorkoutExercise,
} from "@/lib/engine"
import { GOAL_PRESCRIPTIONS, restCeiling, type MainRole } from "@/lib/engine/prescriptions"
import { computeRecovery, weeklyCap } from "@/lib/engine/recovery"
import { isMainCategory, passesProfileFilter } from "@/lib/engine/selection"
import { forGroups, isLightCardio } from "@/lib/engine/warmup"
import { isBreathing } from "@/lib/engine/cooldown"
import {
  completeAtTop,
  makeInput,
  makeProfile,
  progressFromHistory,
  WEEKLY_TRAINING_DAYS,
  type CompleteOptions,
} from "@/lib/engine/test-fixtures"
import { addDays } from "@/lib/dates"

const GOALS: Goal[] = ["muscle_gain", "strength", "fat_loss", "general_fitness", "endurance"]
const LEVELS: Experience[] = ["beginner", "intermediate", "advanced"]
const PRESETS: Exclude<EquipmentPreset, "custom">[] = ["full_gym", "dumbbells", "home_gym", "bodyweight"]
const DAYS: TrainingDays[] = [2, 3, 4, 5, 6]
/** Monday-indexed weekday pattern for each training frequency (shared with the coach harness). */
const SCHEDULE = WEEKLY_TRAINING_DAYS
/**
 * Simulated lifters log plausible loads (coach round 1, F21): a starting estimate is logged as a
 * calibrated working weight, never the same 40 kg on every lift, which the engine's logged-load
 * check rightly holds (40 kg per hand on a lateral raise).
 */
const LOGGED: CompleteOptions = { loads: "calibrated" }
/** A Monday. */
const START = "2026-10-05"
const SIM_DAYS = 21
const MODE = process.env.FORGE_REPORT ?? "sample"

interface Scenario {
  goal: Goal
  experience: Experience
  preset: Exclude<EquipmentPreset, "custom">
  days: TrainingDays
  duration: DurationPreference
}

function scenarios(): Scenario[] {
  const out: Scenario[] = []
  for (const goal of GOALS)
    for (const experience of LEVELS)
      for (const preset of PRESETS)
        for (const days of DAYS) {
          const durations: DurationPreference[] = preset === "full_gym" ? [30, 45, 60, 75] : [45, 60]
          for (const duration of durations) out.push({ goal, experience, preset, days, duration })
        }
  return out
}

function label(s: Scenario): string {
  return `${s.goal}/${s.experience}/${s.preset}/${s.days}d/${s.duration}m`
}

function profileFor(s: Scenario): UserProfile {
  return makeProfile({
    id: `report-${label(s)}`,
    goal: s.goal,
    experience: s.experience,
    equipmentPreset: s.preset,
    equipment: EQUIPMENT_PRESETS[s.preset],
    trainingDaysPerWeek: s.days,
    durationPreferenceMinutes: s.duration,
  })
}

function fmtReps(e: WorkoutExercise): string {
  if (e.reps) return e.reps[0] === e.reps[1] ? `${e.sets}×${e.reps[0]}` : `${e.sets}×${e.reps[0]}–${e.reps[1]}`
  return `${e.sets}×${e.durationSeconds ?? 0}s`
}

function fmtSlot(e: WorkoutExercise): string {
  const ex = getExercise(e.exerciseId)
  const name = ex?.name ?? e.exerciseId
  const group = ex ? muscleGroupOf(ex) : "?"
  const weight = e.recommendedWeightKg !== null ? `  @ ${e.recommendedWeightKg} kg` : ""
  const rir = e.rir !== null ? `  RIR ${e.rir}` : ""
  return `    ${e.role.padEnd(18)} ${name.padEnd(36)} ${group.padEnd(10)} ${fmtReps(e).padEnd(10)} rest ${String(e.restSeconds).padStart(3)}s${rir}${weight}`
}

function printWorkout(heading: string, w: Workout, bullets: string[] = []): void {
  const lines = [
    `── ${heading}`,
    `   ${w.title}  ·  focus ${w.focus.join(", ")}  ·  ~${w.estimatedMinutes} min  ·  ${w.exercises.length} slots`,
  ]
  let phase = ""
  for (const e of w.exercises) {
    if (e.phase !== phase) {
      phase = e.phase
      lines.push(`   [${phase}]`)
    }
    lines.push(fmtSlot(e))
  }
  for (const b of bullets) lines.push(`   why: ${b}`)
  if (bullets.length === 0) for (const n of w.notes ?? []) lines.push(`   note: ${n}`)
  console.log(lines.join("\n"))
}

interface SimDay {
  date: string
  workout: Workout
  history: CompletedWorkout[]
}

/** Three weeks on a realistic weekly schedule, completing every workout at the top of its range. */
function simulate(profile: UserProfile): SimDay[] {
  const history: CompletedWorkout[] = []
  const out: SimDay[] = []
  for (let d = 0; d < SIM_DAYS; d++) {
    if (!SCHEDULE[profile.trainingDaysPerWeek].includes(d % 7)) continue
    const date = addDays(START, d)
    const input = makeInput(profile, date, history.slice(), progressFromHistory(history))
    const workout = generateWorkout(input)
    out.push({ date, workout, history: history.slice() })
    // Coach round 2 (R24): the lifter logs a plausible load on "find your working weight" cards, so
    // machine, cable and trained lifters' barbell lifts build history and progress.
    history.unshift(completeAtTop(workout, getExercise, 40, { ...LOGGED, lifter: profile }))
  }
  return out
}

function mainOf(w: Workout): WorkoutExercise[] {
  return w.exercises.filter((e) => e.phase === "main")
}

function mainIds(w: Workout): string[] {
  return mainOf(w).map((e) => e.exerciseId)
}

function hasCompoundOption(profile: UserProfile): boolean {
  return EXERCISES.some(
    (e) => isMainCategory(e) && e.category !== "cardio" && e.mechanics === "compound" && passesProfileFilter(e, profile),
  )
}

/** Soft coach's-eye checks; returns human-readable warnings for one workout. */
function audit(profile: UserProfile, w: Workout): string[] {
  const warnings: string[] = []
  const main = mainOf(w)
  const warm = w.exercises.filter((e) => e.phase === "warmup")
  const cool = w.exercises.filter((e) => e.phase === "cooldown")
  const rx = GOAL_PRESCRIPTIONS[profile.goal]
  const exOf = (e: WorkoutExercise) => getExercise(e.exerciseId)!

  // Order: compounds before isolation.
  let seenIsolation = false
  for (const e of main) {
    const ex = exOf(e)
    if (e.role === "isolation") seenIsolation = true
    else if (seenIsolation && (e.role === "primary_compound" || e.role === "secondary_compound")) {
      warnings.push(`isolation before compound (${ex.name} after an isolation slot)`)
    }
  }
  if (main[0] && exOf(main[0]).mechanics !== "compound" && hasCompoundOption(profile)) {
    warnings.push(`first main slot is not a compound (${exOf(main[0]).name})`)
  }
  // Trunk work is judged by weekly coverage, not per session (core spec C01-C04: designated core days,
  // a catch-up and a ceiling of core days a week): scripts/coach/core-audit.test.ts measures it.
  // Push-day pattern balance.
  const patterns = main.map((e) => exOf(e).movementPattern)
  if (w.split === "push" || w.split === "upper") {
    const horizontal = patterns.filter((p) => p === "horizontal_push").length
    const vertical = patterns.filter((p) => p === "vertical_push").length
    if (horizontal >= 2 && vertical === 0 && main.length >= 5) warnings.push("two horizontal pushes and no vertical push")
  }
  // Warm-up: cardio first, dynamic drills only.
  if (warm.length > 0 && !isLightCardio(exOf(warm[0]!))) {
    const anyCardio = EXERCISES.some((e) => isLightCardio(e) && passesProfileFilter(e, profile))
    if (anyCardio) warnings.push("warm-up does not start with light cardio")
  }
  for (const e of warm) if (exOf(e).movementPattern === "stretch") warnings.push(`static stretch in warm-up (${exOf(e).name})`)
  // Prescriptions vs goal. The goal table governs the heavy lifts; support work gets the band a
  // coach would write for it (strength accessories 5–12 reps on ~90 s, isolation 6–15 on ~60 s).
  for (const e of main) {
    if (e.role === "finisher") continue
    const ex = exOf(e)
    const heavy = e.role === "primary_compound" || e.role === "secondary_compound"
    const strengthSupport = profile.goal === "strength" && !heavy
    const repBand: [number, number] = strengthSupport ? (e.role === "isolation" ? [4, 15] : [3, 12]) : [rx.reps[0] - 2, rx.reps[1] + 2]
    // Heavy lifts may rest up to their coach ceiling (F27: heavy hypertrophy compounds up to 180 s).
    const restTop = heavy ? restCeiling(ex, profile.goal, e.role as MainRole) : rx.rest[1]
    const restBand: [number, number] = strengthSupport ? (e.role === "isolation" ? [45, 125] : [60, 185]) : [rx.rest[0] - 15, restTop + 15]
    if (e.reps) {
      if (e.role === "primary_compound" && profile.goal === "strength" && e.reps[1] > 8) {
        warnings.push(`strength primary with ${e.reps[0]}–${e.reps[1]} reps (${ex.name})`)
      }
      if (e.reps[0] < repBand[0] || e.reps[1] > repBand[1]) {
        warnings.push(`${heavy ? "compound" : "support"} reps ${e.reps[0]}–${e.reps[1]} outside ${repBand[0]}–${repBand[1]} for ${profile.goal} (${ex.name})`)
      }
    }
    if (e.restSeconds < restBand[0] || e.restSeconds > restBand[1]) {
      warnings.push(`${heavy ? "compound" : "support"} rest ${e.restSeconds}s outside ${restBand[0]}–${restBand[1]} for ${profile.goal} (${ex.name})`)
    }
  }
  if (profile.goal === "muscle_gain" && main.length >= 5 && !main.some((e) => e.role === "isolation" || exOf(e).mechanics === "isolation")) {
    warnings.push("hypertrophy day with no isolation work")
  }
  if (rx.conditioning && main.length >= 5 && !main.some((e) => e.role === "finisher")) warnings.push(`${profile.goal} day without a conditioning finisher`)
  // Cool-down relevance.
  for (const e of cool) {
    const ex = exOf(e)
    if (isBreathing(ex)) continue
    const tags = forGroups(ex)
    if (!tags.some((g) => w.focus.includes(g))) warnings.push(`cool-down stretch not for the day's focus (${ex.name})`)
  }
  // Duplicate heavy lifts: primary and secondary compound with the same muscle and pattern.
  const heavyKeys = main.filter((e) => e.role === "primary_compound" || e.role === "secondary_compound").map((e) => `${exOf(e).primaryMuscle}/${exOf(e).movementPattern}`)
  if (new Set(heavyKeys).size < heavyKeys.length) warnings.push(`primary and secondary compound duplicate a muscle and pattern (${heavyKeys.join(", ")})`)
  return warnings
}

interface Violation {
  scenario: string
  rule: string
  detail: string
}

describe("engine report", () => {
  const all = scenarios()
  const violations: Violation[] = []
  const warningCounts = new Map<string, { count: number; example: string }>()
  const fail = (scenario: string, rule: string, detail: string) => violations.push({ scenario, rule, detail })
  const warn = (scenario: string, warnings: string[]) => {
    for (const w of warnings) {
      const key = w.replace(/\(.*\)$/, "").trim()
      const entry = warningCounts.get(key) ?? { count: 0, example: `${scenario}: ${w}` }
      entry.count += 1
      warningCounts.set(key, entry)
    }
  }

  function checkCommon(scenario: string, profile: UserProfile, w: Workout): void {
    const main = mainOf(w)
    const warm = w.exercises.filter((e) => e.phase === "warmup")
    const cool = w.exercises.filter((e) => e.phase === "cooldown")
    if (main.length === 0) fail(scenario, "no empty main phase", w.title)
    if (main.length < 3) fail(scenario, "at least 3 main exercises", `${w.title}: ${main.length}`)
    const first = main[0] ? getExercise(main[0].exerciseId) : undefined
    // A light day (every focus group at its weekly cap) has no compound left to open with.
    const lightDay = (w.notes ?? []).some((n) => n.startsWith("Light day"))
    if (first && first.mechanics !== "compound" && hasCompoundOption(profile) && !lightDay) {
      fail(scenario, "first main slot is a compound", `${w.title}: ${first.name}`)
    }
    // Warm-ups and cool-downs serve what the session works: the day's focus or a group a main lift
    // loads (a stand-in shoulder press on Full body B gets its own primer).
    const trained = new Set<MuscleGroup>([...w.focus, ...main.filter((e) => e.role !== "finisher").map((e) => muscleGroupOf(getExercise(e.exerciseId)!))])
    for (const e of warm) {
      const ex = getExercise(e.exerciseId)!
      const groups = forGroups(ex)
      const ok = groups.some((g) => trained.has(g)) || (isLightCardio(ex) && groups.includes("full_body"))
      if (!ok) fail(scenario, "warm-up matches focus", `${w.title}: ${ex.name} [${groups.join(",")}] vs ${[...trained].join(",")}`)
    }
    for (const e of cool) {
      const ex = getExercise(e.exerciseId)!
      if (isBreathing(ex)) continue
      const groups = forGroups(ex)
      if (!groups.some((g) => trained.has(g))) fail(scenario, "cool-down matches what was trained", `${w.title}: ${ex.name} [${groups.join(",")}] vs ${[...trained].join(",")}`)
    }
    if (w.estimatedMinutes !== estimateDurationMinutes(w)) fail(scenario, "estimatedMinutes matches estimateDurationMinutes", w.title)
    for (const e of w.exercises) {
      const ex = getExercise(e.exerciseId)!
      if (!ex.equipment.every((q) => profile.equipment.includes(q))) fail(scenario, "equipment respected", ex.id)
      if (ex.contraindications.some((c) => profile.limitations.includes(c))) fail(scenario, "limitations respected", ex.id)
    }
    const bullets = explainWorkout(w, makeInput(profile, w.date))
    if (bullets.length === 0) fail(scenario, "explainWorkout has bullets", w.title)
    // Goal table (product requirement): heavy-lift rest never leaves the goal's range, except
    // below it when the lift itself is prescribed shorter rests, and above it only up to the coach
    // ceiling for heavy hypertrophy compounds (F27: 90–180 s for warmupRequired lifts).
    const rx = GOAL_PRESCRIPTIONS[profile.goal]
    for (const e of main) {
      if (e.role !== "primary_compound" && e.role !== "secondary_compound") continue
      const ex = getExercise(e.exerciseId)!
      const ceiling = restCeiling(ex, profile.goal, e.role as MainRole)
      if (e.restSeconds > ceiling || e.restSeconds < Math.min(rx.rest[0], ex.restRange[0])) {
        fail(scenario, "compound rest inside the goal table", `${ex.name}: ${e.restSeconds}s vs ${rx.rest[0]}–${ceiling}`)
      }
      if (profile.goal === "strength" && e.role === "primary_compound" && e.reps && ex.repRange && ex.repRange[0] <= 6 && e.reps[1] > 8) {
        fail(scenario, "strength primaries stay low-rep", `${ex.name}: ${e.reps[0]}–${e.reps[1]}`)
      }
    }
    // Order: no compound after an isolation exercise; trunk work and conditioning close the session.
    let seenIsolation = false
    for (const e of main) {
      const ex = getExercise(e.exerciseId)!
      if (e.role === "finisher") continue
      if (ex.mechanics === "isolation" && ex.category !== "core") seenIsolation = true
      else if (seenIsolation && ex.mechanics === "compound" && ex.category !== "core" && e.role !== "accessory") {
        fail(scenario, "compounds before isolation", `${w.title}: ${ex.name}`)
      }
    }
    const finisherAt = main.findIndex((e) => e.role === "finisher")
    if (finisherAt >= 0 && main.slice(finisherAt).some((e) => e.role !== "finisher")) fail(scenario, "finisher closes the main phase", w.title)
    // Warm-up is dynamic: never a static stretch.
    for (const e of warm) if (getExercise(e.exerciseId)!.movementPattern === "stretch") fail(scenario, "no static stretch in warm-up", e.exerciseId)
  }

  function checkDuration(scenario: string, profile: UserProfile, w: Workout): void {
    const pref = profile.durationPreferenceMinutes
    if (pref === 45 || pref === 60) {
      // F18: goals without conditioning are no longer padded with finishers, and a bodyweight push
      // day runs out of honest options (one push-up family, shoulders at their share). Those days
      // may come in at 0.6x, as in lib/engine/generate.integration.test.ts assertValid.
      const floor = profile.equipmentPreset === "bodyweight" && !GOAL_PRESCRIPTIONS[profile.goal].conditioning ? 0.6 : 0.75
      if (w.estimatedMinutes < pref * floor || w.estimatedMinutes > pref * 1.25) {
        fail(scenario, "duration within 25% of preference", `${w.title}: ${w.estimatedMinutes} min for ${pref}`)
      }
    } else if (w.estimatedMinutes < pref * 0.6 || w.estimatedMinutes > pref * 1.4) {
      fail(scenario, "duration within 40% of preference (30/75)", `${w.title}: ${w.estimatedMinutes} min for ${pref}`)
    }
  }

  it("generates and audits every scenario with empty history", () => {
    const sample = new Set([
      "muscle_gain/intermediate/full_gym/6d/60m",
      "strength/advanced/full_gym/4d/75m",
      "fat_loss/beginner/dumbbells/3d/45m",
      "general_fitness/beginner/bodyweight/2d/45m",
      "endurance/intermediate/home_gym/5d/60m",
      "muscle_gain/beginner/full_gym/3d/30m",
      "strength/intermediate/home_gym/3d/60m",
      "fat_loss/advanced/bodyweight/6d/60m",
    ])
    for (const s of all) {
      const scenario = label(s)
      const profile = profileFor(s)
      const w = generateWorkout(makeInput(profile, START))
      checkCommon(scenario, profile, w)
      checkDuration(scenario, profile, w)
      warn(scenario, audit(profile, w))
      if (MODE === "full" || (MODE === "sample" && sample.has(scenario))) printWorkout(`${scenario} · empty history`, w, explainWorkout(w, makeInput(profile, START)))
    }
    expect(violations, violations.map((v) => `[${v.rule}] ${v.scenario} → ${v.detail}`).join("\n")).toEqual([])
  })

  it("21-day simulation: rotation, caps, progression, variety", () => {
    const sample = new Set([
      "muscle_gain/intermediate/full_gym/6d/60m",
      "strength/beginner/full_gym/4d/45m",
      "fat_loss/intermediate/dumbbells/3d/45m",
    ])
    for (const s of all) {
      const scenario = label(s)
      const profile = profileFor(s)
      const cap = weeklyCap(profile.experience)
      const sim = simulate(profile)
      const lastByTitle = new Map<string, Workout>()
      const lastTop = new Map<string, { weight: number; reps: [number, number] }>()
      let progressed = 0
      let repeatedExternal = 0
      for (let i = 0; i < sim.length; i++) {
        const { date, workout: w, history } = sim[i]!
        const day = `${scenario} day ${i + 1} (${date})`
        checkCommon(day, profile, w)
        warn(day, audit(profile, w))
        if (MODE === "full" || (MODE === "sample" && sample.has(scenario))) {
          printWorkout(`${scenario} · ${date}`, w, explainWorkout(w, makeInput(profile, date, history, progressFromHistory(history))))
        }

        // Weekly caps: direct sets in the last 7 days plus today's plan never exceed the cap.
        const recovery = computeRecovery(history, date)
        const planned = new Map<MuscleGroup, number>()
        for (const e of mainOf(w)) {
          if (e.role === "finisher") continue
          const g = muscleGroupOf(getExercise(e.exerciseId)!)
          planned.set(g, (planned.get(g) ?? 0) + e.sets)
        }
        for (const g of ALL_MUSCLE_GROUPS) {
          if (g === "cardio" || g === "full_body") continue
          const total = recovery[g].setsLast7 + (planned.get(g) ?? 0)
          if (total > cap) fail(day, "weekly sets never exceed cap", `${g}: ${recovery[g].setsLast7} done + ${planned.get(g)} planned > ${cap}`)
        }

        // Consecutive workouts on 4–6 day splits never load the same group with a primary compound.
        if (profile.trainingDaysPerWeek >= 4 && i > 0) {
          const prev = sim[i - 1]!.workout
          const prevPrimary = new Set(mainOf(prev).filter((e) => e.role === "primary_compound").map((e) => muscleGroupOf(getExercise(e.exerciseId)!)))
          const todayPrimary = mainOf(w).filter((e) => e.role === "primary_compound").map((e) => muscleGroupOf(getExercise(e.exerciseId)!))
          const clash = todayPrimary.filter((g) => prevPrimary.has(g))
          if (clash.length > 0) fail(day, "consecutive days do not repeat a primary group", `${prev.title} → ${w.title}: ${clash.join(",")}`)
        }

        // Coach round 2 (R07) replaced "same split differs in ≥ 2 exercises": support lifts build load
        // history, so the simulated lifter's on-target support work repeats on its split day and at
        // most one support lift rotates per session (at a block boundary or after a stall). A lift
        // whose group is at or near this week's cap may leave too: that is the cap, not a rotation;
        // and a lift that leaves with nothing new in its place was dropped for time, not rotated.
        const prevSame = lastByTitle.get(w.title)
        if (prevSame) {
          const support = (x: Workout) => mainOf(x).filter((e) => e.role === "accessory" || e.role === "isolation").map((e) => e.exerciseId)
          const today = new Set(mainIds(w))
          const nearCap = (id: string) => {
            const g = muscleGroupOf(getExercise(id)!)
            return recovery[g].setsLast7 + (planned.get(g) ?? 0) >= cap - 2
          }
          const prevIds = new Set(mainIds(prevSame))
          const left = support(prevSame).filter((id) => !today.has(id) && !nearCap(id))
          const added = support(w).filter((id) => !prevIds.has(id))
          if (Math.min(left.length, added.length) > 1) {
            fail(day, "same split rotates at most one support lift", `${w.title}: ${left.join(", ")} left for ${added.join(", ")}`)
          }
        }
        lastByTitle.set(w.title, w)

        // Progression: an external lift repeated with the same range after a top-of-range session goes up.
        for (const e of mainOf(w)) {
          const ex = getExercise(e.exerciseId)!
          const prev = lastTop.get(e.exerciseId)
          // Deliberate holds: a maintenance dose ("hold the load", F06), a logged load being checked
          // (F21) and a kettlebell waiting for a second top session before a big bell jump (F14);
          // coach round 2 (R11): any load whose next step is more than 10% heavier waits too.
          const held = e.loadCheck || /hold the load|Stay at .*: the next (bell|step)/.test(e.note ?? "")
          if (prev && !held && e.reps && ex.loadType === "external" && prev.reps[0] === e.reps[0] && prev.reps[1] === e.reps[1]) {
            repeatedExternal++
            if (e.recommendedWeightKg === null || e.recommendedWeightKg <= prev.weight) {
              fail(day, "weight increases after top-of-range session", `${ex.name}: ${prev.weight} → ${e.recommendedWeightKg}`)
            } else progressed++
          }
        }
        const done = completeAtTop(w, getExercise, 40, { ...LOGGED, lifter: profile })
        for (const e of done.exercises) {
          const ex = getExercise(e.exerciseId)!
          if (e.phase === "main" && ex.loadType === "external" && e.prescribedReps && e.sets[0]?.weightKg != null) {
            lastTop.set(e.exerciseId, { weight: e.sets[0]!.weightKg!, reps: e.prescribedReps })
          }
        }
      }
      if (s.preset !== "bodyweight" && repeatedExternal > 0 && progressed === 0) fail(scenario, "progression happens over 3 weeks", "no external lift progressed")
      const titles = new Set(sim.map((d) => d.workout.title))
      if (titles.size < 2) fail(scenario, "rotation cycles the split", [...titles].join(","))
    }
    expect(violations, violations.map((v) => `[${v.rule}] ${v.scenario} → ${v.detail}`).join("\n")).toEqual([])
  }, 120_000)

  it("holds the load after missed reps", () => {
    const profile = profileFor({ goal: "muscle_gain", experience: "intermediate", preset: "full_gym", days: 3, duration: 60 })
    const first = generateWorkout(makeInput(profile, START))
    const done = completeAtTop(first, getExercise, 40)
    // Miss the bottom of the range on every set of every external lift.
    for (const e of done.exercises) {
      if (e.phase !== "main" || !e.prescribedReps) continue
      for (const s of e.sets) s.reps = Math.max(1, e.prescribedReps[0] - 1)
    }
    const history = [done]
    // Advance until the same split comes round again.
    let next: Workout | undefined
    for (let d = 1; d <= 7 && !next; d++) {
      const date = addDays(START, d)
      const w = generateWorkout(makeInput(profile, date, history, progressFromHistory(history)))
      if (w.title === first.title) next = w
      else history.unshift(completeAtTop(w, getExercise, 40))
    }
    expect(next).toBeDefined()
    let checked = 0
    for (const e of mainOf(next!)) {
      const prev = done.exercises.find((p) => p.exerciseId === e.exerciseId && p.phase === "main")
      const ex = getExercise(e.exerciseId)!
      if (!prev || ex.loadType !== "external" || !e.reps || !prev.prescribedReps) continue
      if (prev.prescribedReps[0] !== e.reps[0] || prev.prescribedReps[1] !== e.reps[1]) continue
      expect(e.recommendedWeightKg, ex.name).toBe(prev.sets[0]!.weightKg)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it("bodyweight-only beginner with every limitation still gets 3 main exercises", () => {
    const profile = makeProfile({
      id: "report-limited",
      experience: "beginner",
      equipmentPreset: "bodyweight",
      equipment: EQUIPMENT_PRESETS.bodyweight,
      limitations: ["shoulder", "elbow", "wrist", "lower_back", "hip", "knee", "ankle", "neck"],
      trainingDaysPerWeek: 3,
      durationPreferenceMinutes: 45,
    })
    for (let d = 0; d < 7; d++) {
      const w = generateWorkout(makeInput(profile, addDays(START, d)))
      if (MODE !== "quiet" && d === 0) printWorkout("beginner · bodyweight · every limitation", w)
      expect(mainOf(w).length, w.title).toBeGreaterThanOrEqual(3)
    }
  })

  it("swipe-left replacement keeps the primary muscle group and the slot role", () => {
    const checks: Scenario[] = [
      { goal: "muscle_gain", experience: "intermediate", preset: "full_gym", days: 3, duration: 60 },
      { goal: "strength", experience: "advanced", preset: "home_gym", days: 4, duration: 60 },
      { goal: "fat_loss", experience: "beginner", preset: "dumbbells", days: 3, duration: 45 },
      { goal: "general_fitness", experience: "beginner", preset: "bodyweight", days: 2, duration: 45 },
    ]
    for (const s of checks) {
      const profile = profileFor(s)
      const input = makeInput(profile, START)
      const w = generateWorkout(input)
      for (const slot of mainOf(w)) {
        if (slot.role === "finisher") continue
        const current = getExercise(slot.exerciseId)!
        const swapped = replaceExercise(w, slot.slotId, input)
        if (!swapped) continue
        const next = swapped.exercises.find((e) => e.slotId === slot.slotId)!
        const replacement = getExercise(next.exerciseId)!
        const sameGroupExists = EXERCISES.some(
          (e) => e.id !== current.id && isMainCategory(e) && e.category !== "cardio" && passesProfileFilter(e, profile) && muscleGroupOf(e) === muscleGroupOf(current) && !w.exercises.some((x) => x.exerciseId === e.id),
        )
        expect(next.role, `${label(s)} ${current.name}`).toBe(slot.role)
        if (sameGroupExists) expect(muscleGroupOf(replacement), `${label(s)} ${current.name} → ${replacement.name}`).toBe(muscleGroupOf(current))
        if (slot.role === "primary_compound" || slot.role === "secondary_compound") {
          const compoundExists = EXERCISES.some(
            (e) => e.id !== current.id && isMainCategory(e) && e.category !== "cardio" && e.mechanics === "compound" && passesProfileFilter(e, profile) && muscleGroupOf(e) === muscleGroupOf(current) && !w.exercises.some((x) => x.exerciseId === e.id),
          )
          if (compoundExists) expect(replacement.mechanics, `${label(s)} ${current.name} → ${replacement.name}`).toBe("compound")
        }
        if (MODE !== "quiet" && slot.role === "primary_compound") console.log(`   swap ${label(s)}: ${current.name} → ${replacement.name}`)
      }
    }
  })

  it("prints the audit summary", () => {
    const rows = [...warningCounts.entries()].sort((a, b) => b[1].count - a[1].count)
    console.log("\n── Coach audit (soft warnings across all generated workouts)")
    if (rows.length === 0) console.log("   none")
    for (const [key, { count, example }] of rows) console.log(`   ${String(count).padStart(5)}  ${key}\n          e.g. ${example}`)
  })
})
