/**
 * Writes coach review inputs for a matrix of profiles to .coach/samples/ so the `coach` agent
 * (.claude/agents/coach.md) can review exactly what the runtime coach receives.
 *
 *   pnpm coach:samples
 *
 * The writer is skipped during the normal test run; the harness checks below always run.
 *
 * Each profile trains on its plan's weekly days (3 days: Mon/Wed/Fri; 4: Mon/Tue/Thu/Fri; 5:
 * Mon–Fri; 6: six on, one off) and logs plausible loads: history loads as shown, a starting
 * estimate about 15% heavier (at least one load step), and, where the card showed no load, a load
 * from the fixture table scaled by body weight and experience (plausibleLoadKg). Coach round 1
 * (F21): the old harness trained every round(7 / days) days and logged a flat 40 kg for every
 * estimate. Coach round 2 (R24): it logged nothing on machine, cable and band cards, so those
 * lifts never built history and week-2 samples could not show their progression.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { getExercise } from "@/lib/exercises"
import { buildCoachRequest } from "@/lib/coach/context"
import { buildCoachMessage } from "@/lib/coach/message"
import { addDays } from "@/lib/dates"
import type { CompletedWorkout, EquipmentPreset, TrainingDays, UserProfile } from "@/lib/domain/types"
import { EQUIPMENT_PRESETS } from "@/lib/domain/types"
import { generateWorkout, type EngineInput, type Workout } from "@/lib/engine"
import {
  calibratedLoadKg,
  completeAtTop,
  makeInput,
  makeProfile,
  plausibleLoadKg,
  progressFromHistory,
  trainingDayOffsets,
} from "@/lib/engine/test-fixtures"
import type { BodyArea, Difficulty, Goal } from "@/lib/exercises/types"

const OUT = path.resolve(import.meta.dirname, "../../.coach/samples")

interface Case {
  name: string
  goal: Goal
  experience: Difficulty
  gender: "male" | "female" | "unspecified"
  weightKg: number
  days: TrainingDays
  preset: Exclude<EquipmentPreset, "custom">
  minutes: 30 | 45 | 60 | 75
  limitations?: BodyArea[]
}

const CASES: Case[] = [
  { name: "hypertrophy-intermediate-fullgym-4d", goal: "muscle_gain", experience: "intermediate", gender: "male", weightKg: 82, days: 4, preset: "full_gym", minutes: 60 },
  { name: "hypertrophy-beginner-dumbbells-3d", goal: "muscle_gain", experience: "beginner", gender: "female", weightKg: 61, days: 3, preset: "dumbbells", minutes: 45 },
  { name: "strength-advanced-fullgym-5d", goal: "strength", experience: "advanced", gender: "male", weightKg: 95, days: 5, preset: "full_gym", minutes: 75 },
  { name: "strength-beginner-homegym-3d", goal: "strength", experience: "beginner", gender: "unspecified", weightKg: 74, days: 3, preset: "home_gym", minutes: 45 },
  { name: "fatloss-beginner-bodyweight-3d", goal: "fat_loss", experience: "beginner", gender: "female", weightKg: 88, days: 3, preset: "bodyweight", minutes: 30 },
  { name: "fatloss-intermediate-fullgym-4d-knee", goal: "fat_loss", experience: "intermediate", gender: "male", weightKg: 104, days: 4, preset: "full_gym", minutes: 45, limitations: ["knee"] },
  { name: "general-beginner-fullgym-2d", goal: "general_fitness", experience: "beginner", gender: "unspecified", weightKg: 70, days: 2, preset: "full_gym", minutes: 45 },
  { name: "general-intermediate-homegym-4d-shoulder", goal: "general_fitness", experience: "intermediate", gender: "female", weightKg: 66, days: 4, preset: "home_gym", minutes: 60, limitations: ["shoulder"] },
  { name: "endurance-intermediate-fullgym-5d", goal: "endurance", experience: "intermediate", gender: "male", weightKg: 72, days: 5, preset: "full_gym", minutes: 45 },
  { name: "endurance-beginner-bodyweight-3d", goal: "endurance", experience: "beginner", gender: "female", weightKg: 58, days: 3, preset: "bodyweight", minutes: 30 },
  { name: "hypertrophy-advanced-fullgym-6d", goal: "muscle_gain", experience: "advanced", gender: "female", weightKg: 64, days: 6, preset: "full_gym", minutes: 75 },
  { name: "strength-intermediate-fullgym-3d-lowerback", goal: "strength", experience: "intermediate", gender: "male", weightKg: 90, days: 3, preset: "full_gym", minutes: 60, limitations: ["lower_back"] },
]

/** Day 1 (no history) and day 8: the first session of week two, a training day on every plan. */
const SAMPLE_DAYS = [0, 7]
const LAST_DAY = Math.max(...SAMPLE_DAYS)
/** A Monday, so the weekly patterns fall on the weekdays they name. */
const FIRST_DATE = "2026-10-05"

interface Session {
  day: number
  input: EngineInput
  workout: Workout
  done: CompletedWorkout
}

function profileFor(c: Case): UserProfile {
  return makeProfile({
    id: `coach-${c.name}`,
    goal: c.goal,
    experience: c.experience,
    gender: c.gender,
    weightKg: c.weightKg,
    trainingDaysPerWeek: c.days,
    equipmentPreset: c.preset,
    equipment: EQUIPMENT_PRESETS[c.preset],
    durationPreferenceMinutes: c.minutes,
    limitations: c.limitations ?? [],
  })
}

const simulated = new Map<string, Session[]>()

/** Every session of a case through LAST_DAY, each one completed at the top of its range. */
function simulate(c: Case): Session[] {
  const cached = simulated.get(c.name)
  if (cached) return cached
  const profile = profileFor(c)
  const history: CompletedWorkout[] = []
  const sessions: Session[] = []
  for (const day of trainingDayOffsets(c.days, LAST_DAY + 1)) {
    const input = makeInput(profile, addDays(FIRST_DATE, day), [...history].reverse(), progressFromHistory(history))
    const workout = generateWorkout(input)
    const done = completeAtTop(workout, getExercise, 40, { loads: "calibrated", lifter: profile })
    sessions.push({ day, input, workout, done })
    history.push(done)
  }
  simulated.set(c.name, sessions)
  return sessions
}

describe("coach sample harness", () => {
  it("trains each plan on its weekly days: exactly N sessions in every 7-day window", () => {
    for (const days of [2, 3, 4, 5, 6] as TrainingDays[]) {
      const offsets = trainingDayOffsets(days, 28)
      for (let start = 0; start + 7 <= 28; start++) {
        expect(offsets.filter((d) => d >= start && d < start + 7), `${days}-day plan, days ${start}-${start + 6}`).toHaveLength(days)
      }
    }
    for (const c of CASES) {
      const days = simulate(c).map((s) => s.day)
      for (const d of SAMPLE_DAYS) expect(days, `${c.name} trains on sample day ${d + 1}`).toContain(d)
      // The 7 days before day 8 hold exactly one week of the plan.
      expect(days.filter((d) => d >= LAST_DAY - 7 && d < LAST_DAY), c.name).toHaveLength(c.days)
    }
  })

  it("logs plausible loads: calibrated from the engine's estimate, from the table on a no-load card, never invented", () => {
    const seen = { estimate: 0, history: 0, table: 0 }
    for (const c of CASES) {
      const lifter = profileFor(c)
      // The first load logged for each lift: every later log stays within 2x of it.
      const firstLogged = new Map<string, number>()
      for (const s of simulate(c)) {
        s.done.exercises.forEach((logged, i) => {
          const planned = s.workout.exercises[i]!
          const ex = getExercise(logged.exerciseId)!
          const where = `${c.name} day ${s.day + 1}: ${logged.exerciseId}`
          const loaded = planned.phase === "main" && ex.loadType === "external"
          for (const set of logged.sets) {
            if (!loaded) {
              expect(set.weightKg, where).toBeNull()
              continue
            }
            if (planned.recommendedWeightKg == null) {
              // No load on the card: the lifter picks one from the fixture table and owns it.
              expect(set.weightKg, where).toBe(plausibleLoadKg(ex, lifter))
              expect(logged.weightSource, where).toBe("user")
              seen.table++
            } else if (planned.weightSource === "estimate") {
              // R24: a calibrated estimate is always at least one load step heavier.
              expect(set.weightKg, where).toBe(calibratedLoadKg(planned.recommendedWeightKg, ex))
              expect(set.weightKg!, where).toBeGreaterThan(planned.recommendedWeightKg)
              seen.estimate++
            } else {
              expect(set.weightKg, where).toBe(planned.recommendedWeightKg)
              seen.history++
            }
            expect(set.weightKg!, where).toBeGreaterThan(0)
            const first = firstLogged.get(ex.id) ?? set.weightKg!
            firstLogged.set(ex.id, first)
            expect(set.weightKg!, `${where} logged ${set.weightKg} kg after a first log of ${first} kg`).toBeLessThanOrEqual(2 * first)
          }
        })
      }
    }
    expect(seen.estimate, "sets logged from a starting estimate").toBeGreaterThan(0)
    expect(seen.history, "sets logged from a history load").toBeGreaterThan(0)
    expect(seen.table, "sets logged on a card with no load").toBeGreaterThan(0)
  })

  it("logs a load for every external lift in week 1, so its week-2 card shows one (R24)", () => {
    let carried = 0
    for (const c of CASES) {
      const sessions = simulate(c)
      const loggedInWeek1 = new Set<string>()
      for (const s of sessions.filter((x) => x.day < 7)) {
        for (const e of s.done.exercises) {
          if (e.phase !== "main" || getExercise(e.exerciseId)!.loadType !== "external") continue
          for (const set of e.sets) expect(set.weightKg, `${c.name} day ${s.day + 1}: ${e.exerciseId}`).not.toBeNull()
          loggedInWeek1.add(e.exerciseId)
        }
      }
      for (const s of sessions.filter((x) => x.day >= 7)) {
        for (const e of s.workout.exercises) {
          if (e.phase !== "main" || !loggedInWeek1.has(e.exerciseId)) continue
          expect(e.recommendedWeightKg, `${c.name} day ${s.day + 1}: ${e.exerciseId} (${e.note})`).not.toBeNull()
          carried++
        }
      }
    }
    expect(carried, "week-2 cards for lifts logged in week 1").toBeGreaterThan(0)
  })

  it("logs no-load cards from the fixture table, scaled by body weight and experience (R24)", () => {
    const pulldown = getExercise("lat-pulldown")!
    const light = { weightKg: 60, experience: "beginner" as const }
    const heavy = { weightKg: 100, experience: "advanced" as const }
    expect(plausibleLoadKg(pulldown, light)).toBeLessThan(plausibleLoadKg(pulldown, heavy))
    // Whole stack for a machine; per hand (half) for two dumbbells.
    expect(plausibleLoadKg(pulldown, heavy)).toBe(Math.floor((0.6 * 100 * 1.25) / 2.5) * 2.5)
    const frontRaise = getExercise("dumbbell-front-raise")!
    expect(plausibleLoadKg(frontRaise, heavy)).toBe(Math.floor((0.2 * 0.5 * 100 * 1.25) / 2) * 2)
    for (const ex of [pulldown, frontRaise]) expect(plausibleLoadKg(ex, { weightKg: 25, experience: "beginner" })).toBeGreaterThan(0)
  })

  it("calibrates a starting estimate at least one load step up (R24)", () => {
    const dumbbellPress = getExercise("incline-dumbbell-press")!
    // 6 kg x 1.15 = 6.9 kg used to round back to 6 kg: the lifter now logs the next dumbbell.
    expect(calibratedLoadKg(6, dumbbellPress)).toBe(8)
    expect(calibratedLoadKg(40, getExercise("barbell-back-squat")!)).toBe(45)
  })
})

describe.skipIf(!process.env.COACH_SAMPLES)("coach samples", () => {
  it("writes review inputs", () => {
    fs.rmSync(OUT, { recursive: true, force: true })
    fs.mkdirSync(OUT, { recursive: true })
    for (const c of CASES) {
      for (const s of simulate(c)) {
        if (!SAMPLE_DAYS.includes(s.day)) continue
        const file = path.join(OUT, `${c.name}--day${s.day + 1}.txt`)
        fs.writeFileSync(file, buildCoachMessage(buildCoachRequest(s.workout, s.input)))
      }
    }
    console.log(`coach samples written to ${OUT}`)
  })
})
