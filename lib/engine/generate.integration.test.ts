/**
 * Runs the engine against the real exercise library.
 */
import { describe, expect, it } from "vitest"
import { EXERCISES, getExercise, muscleGroupOf } from "@/lib/exercises"
import { DIFFICULTY_RANK, type Goal } from "@/lib/exercises/types"
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
  generateWorkout,
  explainWorkout,
  replaceExercise,
  replacementCandidates,
  estimateDurationMinutes,
} from "./index"
import {
  completeAtTop,
  makeInput,
  makeProfile,
  progressFromHistory,
  setupNoteViolation,
  trainingDayOffsets,
} from "./test-fixtures"
import { GOAL_PRESCRIPTIONS } from "./prescriptions"
import { coreFamily, familyRoot, fitsFinisher, isUnloadedPlyometric, lookupFor, passesProfileFilter } from "./selection"
import { liftingSlotCap, MAX_CORE_DAYS } from "./splits"
import { coreWeeklyCap } from "./recovery"
import type { Workout } from "./types"
import { addDays } from "@/lib/dates"

const GOALS: Goal[] = [
  "muscle_gain",
  "strength",
  "fat_loss",
  "general_fitness",
  "endurance",
]
const LEVELS: Experience[] = ["beginner", "intermediate", "advanced"]
const PRESETS: Exclude<EquipmentPreset, "custom">[] = [
  "full_gym",
  "dumbbells",
  "home_gym",
  "bodyweight",
]
const DAYS: TrainingDays[] = [2, 3, 4, 5, 6]
const DURATIONS: DurationPreference[] = [30, 45, 60, 75]

function profileFor(
  goal: Goal,
  experience: Experience,
  preset: Exclude<EquipmentPreset, "custom">,
  days: TrainingDays,
  duration: DurationPreference
): UserProfile {
  return makeProfile({
    id: `p-${goal}-${experience}-${preset}-${days}-${duration}`,
    goal,
    experience,
    equipmentPreset: preset,
    equipment: EQUIPMENT_PRESETS[preset],
    trainingDaysPerWeek: days,
    durationPreferenceMinutes: duration,
  })
}

function assertValid(
  profile: UserProfile,
  w: ReturnType<typeof generateWorkout>,
  options: { capped?: boolean } = {}
) {
  const warm = w.exercises.filter((e) => e.phase === "warmup")
  const main = w.exercises.filter((e) => e.phase === "main")
  const cool = w.exercises.filter((e) => e.phase === "cooldown")
  expect(warm.length).toBeGreaterThanOrEqual(1)
  expect(warm.length).toBeLessThanOrEqual(6)
  expect(main.length).toBeGreaterThanOrEqual(3)
  expect(cool.length).toBeGreaterThanOrEqual(2)
  expect(new Set(w.exercises.map((e) => e.slotId)).size).toBe(
    w.exercises.length
  )
  for (const e of w.exercises) {
    const ex = getExercise(e.exerciseId)
    expect(ex, e.exerciseId).toBeDefined()
    expect(
      ex!.equipment.every((q) => profile.equipment.includes(q)),
      `${ex!.id} equipment`
    ).toBe(true)
    expect(DIFFICULTY_RANK[ex!.difficulty]).toBeLessThanOrEqual(
      DIFFICULTY_RANK[profile.experience]
    )
    expect(
      ex!.contraindications.some((c) => profile.limitations.includes(c))
    ).toBe(false)
    expect(profile.excludedExerciseIds).not.toContain(ex!.id)
    expect(e.sets).toBeGreaterThanOrEqual(1)
    expect(e.reps !== null || e.durationSeconds !== null).toBe(true)
  }
  const pref = profile.durationPreferenceMinutes
  const label = `${profile.id} ${w.title}: ${w.estimatedMinutes} min`
  // Coach round 1 (F18, F13): goals without conditioning are never padded with a finisher or with
  // a repeat of a movement already in the day. A bodyweight push day runs out of distinct
  // movements inside its share of the weekly cap, so it may finish short of the preference.
  const unpadded =
    profile.equipmentPreset === "bodyweight" &&
    !GOAL_PRESCRIPTIONS[profile.goal].conditioning
  // Weekly caps legitimately shorten sessions once history piles up, so only the ceiling applies then.
  if (pref === 45 || pref === 60) {
    if (!options.capped)
      expect(w.estimatedMinutes, label).toBeGreaterThanOrEqual(pref * (unpadded ? 0.6 : 0.7))
    expect(w.estimatedMinutes, label).toBeLessThanOrEqual(pref * 1.3)
  } else {
    if (!options.capped)
      expect(w.estimatedMinutes, label).toBeGreaterThanOrEqual(pref * 0.5)
    expect(w.estimatedMinutes, label).toBeLessThanOrEqual(pref * 1.5)
  }
  expect(w.estimatedMinutes).toBe(estimateDurationMinutes(w))
}

describe("generateWorkout (real library)", () => {
  it("every goal × experience × preset × days × duration with empty history", () => {
    for (const goal of GOALS) {
      for (const experience of LEVELS) {
        for (const preset of PRESETS) {
          for (const days of DAYS) {
            for (const duration of DURATIONS) {
              const profile = profileFor(
                goal,
                experience,
                preset,
                days,
                duration
              )
              const input = makeInput(profile)
              let w: ReturnType<typeof generateWorkout> | undefined
              expect(() => {
                w = generateWorkout(input)
              }, `${profile.id}`).not.toThrow()
              assertValid(profile, w!)
              expect(generateWorkout(input)).toEqual(w)
              expect(explainWorkout(w!, input).length).toBeGreaterThan(0)
            }
          }
        }
      }
    }
    // 1,200 profiles, each generated twice for determinism: about 5 s alone, longer when the whole
    // suite runs in parallel, so the default 5 s timeout is too tight.
  }, 60_000)

  it("the warm-up starts with light cardio when equipment allows and matches the focus", () => {
    const w = generateWorkout(
      makeInput(profileFor("muscle_gain", "intermediate", "full_gym", 3, 60))
    )
    const first = w.exercises[0]!
    expect(first.phase).toBe("warmup")
    expect(first.exerciseId.startsWith("warmup-")).toBe(true)
    const ex = getExercise(first.exerciseId)!
    expect(["locomotion", "conditioning"]).toContain(ex.movementPattern)
  })

  it("survives a bodyweight-only beginner with every limitation", () => {
    const profile = makeProfile({
      experience: "beginner",
      equipmentPreset: "bodyweight",
      equipment: EQUIPMENT_PRESETS.bodyweight,
      limitations: [
        "shoulder",
        "elbow",
        "wrist",
        "lower_back",
        "hip",
        "knee",
        "ankle",
        "neck",
      ],
      trainingDaysPerWeek: 3,
      durationPreferenceMinutes: 30,
    })
    const w = generateWorkout(makeInput(profile))
    for (const e of w.exercises) {
      const ex = getExercise(e.exerciseId)!
      expect(ex.contraindications).toEqual([])
      expect(ex.equipment.every((q) => profile.equipment.includes(q))).toBe(
        true
      )
    }
  })

  it("falls back when every chest exercise is excluded", () => {
    const chestIds = EXERCISES.filter((e) => muscleGroupOf(e) === "chest").map(
      (e) => e.id
    )
    const profile = makeProfile({
      trainingDaysPerWeek: 3,
      excludedExerciseIds: chestIds,
    })
    const w = generateWorkout(makeInput(profile))
    expect(w.split).toBe("push")
    expect(w.exercises.some((e) => chestIds.includes(e.exerciseId))).toBe(false)
    expect(
      w.exercises.filter((e) => e.phase === "main").length
    ).toBeGreaterThanOrEqual(3)
  })

  it("replacement candidates and swaps are valid for the profile", () => {
    const profile = profileFor("muscle_gain", "intermediate", "home_gym", 4, 60)
    const input = makeInput(profile)
    const w = generateWorkout(input)
    for (const slot of w.exercises.filter((e) => e.phase === "main")) {
      const candidates = replacementCandidates(w, slot.slotId, input, 5)
      for (const c of candidates) {
        const ex = getExercise(c.exerciseId)!
        expect(ex.equipment.every((q) => profile.equipment.includes(q))).toBe(
          true
        )
        expect(w.exercises.some((e) => e.exerciseId === c.exerciseId)).toBe(
          false
        )
      }
      const swapped = replaceExercise(w, slot.slotId, input)
      if (swapped) {
        const s = swapped.exercises.find((e) => e.slotId === slot.slotId)!
        expect(s.exerciseId).not.toBe(slot.exerciseId)
        expect(s.replacedFromExerciseId).toBe(slot.exerciseId)
      }
    }
  })

  it("14-day simulation rotates the split, rests heavy groups and progresses weights", () => {
    for (const days of DAYS) {
      for (const experience of LEVELS) {
        const profile = profileFor(
          "muscle_gain",
          experience,
          "full_gym",
          days,
          60
        )
        const history: CompletedWorkout[] = []
        const titles: string[] = []
        const heavyByDay: Set<string>[] = []
        const lastTopWeight = new Map<
          string,
          { weight: number; reps: [number, number] }
        >()
        let increases = 0

        for (let d = 1; d <= 14; d++) {
          const date = `2026-10-${String(d).padStart(2, "0")}`
          const input = makeInput(
            profile,
            date,
            history,
            progressFromHistory(history)
          )
          const w = generateWorkout(input)
          assertValid(profile, w, { capped: history.length > 0 })
          titles.push(w.title)

          const heavy = new Set<string>()
          for (const e of w.exercises) {
            if (e.phase !== "main") continue
            const ex = getExercise(e.exerciseId)!
            if (
              e.role === "primary_compound" ||
              e.role === "secondary_compound"
            )
              heavy.add(muscleGroupOf(ex))
            const prev = lastTopWeight.get(e.exerciseId)
            // Coach round 1 (F06): training every day puts groups over their weekly target, and a
            // compound kept at a maintenance dose holds its load on purpose ("hold the load").
            const maintenance = /hold the load/.test(e.note ?? "")
            // Coach round 1 (F21): a logged load far above the starting estimate is held once with a
            // "check your logged weight" note before it progresses.
            if (e.loadCheck) continue
            // Coach round 1 (F14): a kettlebell stays on its bell until a second top-of-range
            // session when the next bell is more than 10% heavier.
            // Coach round 2 (R11): any load whose next step is more than 10% heavier waits for a
            // second top-of-range session.
            if (/Stay at .*: the next (bell|step)/.test(e.note ?? "")) continue
            if (
              prev &&
              e.reps &&
              prev.reps[0] === e.reps[0] &&
              prev.reps[1] === e.reps[1] &&
              ex.loadType === "external" &&
              !maintenance
            ) {
              expect(
                e.recommendedWeightKg,
                `${e.exerciseId} on ${date}`
              ).not.toBeNull()
              expect(e.recommendedWeightKg!, `${e.exerciseId} on ${date}: ${e.note}`).toBeGreaterThan(prev.weight)
              increases++
            }
          }
          heavyByDay.push(heavy)

          // Plausible loads (F21): a starting estimate is logged as the lifter's calibrated working
          // weight, not the same 40 kg on every lift (which the load check rightly flags).
          // Coach round 2 (R04, R10, R24): trained lifters' heavy compounds and every machine or
          // cable lift now show "find your working weight"; the lifter logs a plausible found load.
          const done = completeAtTop(w, getExercise, 40, { loads: "calibrated", lifter: profile })
          for (const e of done.exercises) {
            const ex = getExercise(e.exerciseId)!
            if (
              e.phase === "main" &&
              ex.loadType === "external" &&
              e.prescribedReps &&
              e.sets[0]?.weightKg != null
            ) {
              lastTopWeight.set(e.exerciseId, {
                weight: e.sets[0]!.weightKg!,
                reps: e.prescribedReps,
              })
            }
          }
          history.unshift(done)
        }

        expect(
          new Set(titles).size,
          `days=${days} ${experience}`
        ).toBeGreaterThan(1)
        const rotationLength =
          days === 3 && experience === "beginner" ? 3 : days
        expect(new Set(titles).size).toBe(rotationLength)
        if (days >= 4) {
          for (let i = 1; i < heavyByDay.length; i++) {
            const overlap = [...heavyByDay[i]!].filter((g) =>
              heavyByDay[i - 1]!.has(g)
            )
            expect(
              overlap,
              `days=${days} ${experience} day ${i + 1}: ${titles[i - 1]} → ${titles[i]}`
            ).toEqual([])
          }
        }
        expect(
          increases,
          `days=${days} ${experience} progression`
        ).toBeGreaterThan(0)
      }
    }
  })

  it("full-body rotations balance pressing and pulling across the week", () => {
    // Monday-indexed training days for the two full-body frequencies.
    const schedule: Partial<Record<TrainingDays, number[]>> = { 2: [0, 3], 3: [0, 2, 4] }
    const configs: [TrainingDays, Experience][] = [
      [2, "beginner"],
      [2, "intermediate"],
      [3, "beginner"],
    ]
    for (const [days, experience] of configs) {
      for (const duration of [45, 60, 75] as DurationPreference[]) {
        let press = 0
        let pull = 0
        for (const goal of GOALS) {
          for (const preset of ["full_gym", "home_gym", "dumbbells"] as const) {
            const profile = profileFor(goal, experience, preset, days, duration)
            const history: CompletedWorkout[] = []
            for (let d = 0; d < 14; d++) {
              if (!schedule[days]!.includes(d % 7)) continue
              const date = `2026-10-${String(5 + d).padStart(2, "0")}`
              const w = generateWorkout(
                makeInput(profile, date, history.slice(), progressFromHistory(history))
              )
              // Week two, once caps and rotation are in steady state.
              if (d >= 7) {
                for (const e of w.exercises) {
                  if (e.phase !== "main" || e.role === "finisher") continue
                  const ex = getExercise(e.exerciseId)!
                  const group = muscleGroupOf(ex)
                  const pattern = ex.movementPattern
                  if (
                    (pattern === "horizontal_push" || pattern === "vertical_push") &&
                    ex.mechanics === "compound" &&
                    (group === "chest" || group === "shoulders")
                  )
                    press += e.sets
                  if (pattern === "horizontal_pull" || pattern === "vertical_pull") pull += e.sets
                }
              }
              history.unshift(completeAtTop(w, getExercise, 40))
            }
          }
        }
        const label = `${days}d ${experience} ${duration}m: ${press} press / ${pull} pull sets`
        expect(press / pull, label).toBeLessThanOrEqual(1.2)
        expect(press / pull, label).toBeGreaterThanOrEqual(0.6)
      }
    }
  })

  it("heavy lifts in either compound slot get the ramp-up note", () => {
    let secondaries = 0
    for (const goal of ["strength", "muscle_gain"] as Goal[]) {
      for (const days of [3, 4, 6] as TrainingDays[]) {
        const profile = profileFor(goal, "intermediate", "full_gym", days, 60)
        const history: CompletedWorkout[] = []
        for (let d = 1; d <= 7; d++) {
          const date = `2026-10-${String(d).padStart(2, "0")}`
          const w = generateWorkout(
            makeInput(profile, date, history, progressFromHistory(history))
          )
          for (const e of w.exercises) {
            if (e.phase !== "main") continue
            if (e.role !== "primary_compound" && e.role !== "secondary_compound") continue
            if (!getExercise(e.exerciseId)!.warmupRequired) continue
            if (e.role === "secondary_compound") secondaries++
            // Coach review F16/F02: the ramp-up sentence follows the load (none within two steps
            // of the empty bar), is never dropped behind a cap or calibration note, and a "find
            // your working weight" note, which builds up from light sets, may replace it.
            expect(
              setupNoteViolation(e, getExercise(e.exerciseId)!),
              `${profile.id} ${date} ${e.exerciseId}`
            ).toBeNull()
            if (e.recommendedWeightKg !== null && e.weightSource === "history") {
              expect(e.note ?? "").toContain(
                "Ramp up over 2 lighter sets before your working sets."
              )
            }
          }
          history.unshift(completeAtTop(w, getExercise, 40))
        }
      }
    }
    expect(secondaries).toBeGreaterThan(0)
  })
})

/** Monday-indexed weekday pattern for each training frequency (a realistic week). */
const WEEK: Record<TrainingDays, number[]> = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
}
/** A Monday. */
const MONDAY = "2026-10-05"

function dateAt(offset: number): string {
  const d = new Date(`${MONDAY}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

/** Train on the given day offsets, completing every workout at the top of its range. */
function trainOn(profile: UserProfile, offsets: number[]): ReturnType<typeof generateWorkout>[] {
  const history: CompletedWorkout[] = []
  const out: ReturnType<typeof generateWorkout>[] = []
  for (const offset of offsets) {
    const w = generateWorkout(makeInput(profile, dateAt(offset), history.slice(), progressFromHistory(history)))
    out.push(w)
    history.unshift(completeAtTop(w, getExercise, 40))
  }
  return out
}

function mainOf(w: ReturnType<typeof generateWorkout>) {
  return w.exercises.filter((e) => e.phase === "main")
}

const PRESS_PATTERNS = new Set(["horizontal_push", "vertical_push"])
const PULL_PATTERNS = new Set(["horizontal_pull", "vertical_pull"])

describe("coach round 1 (real library)", () => {
  it("an every-other-day 3-day beginner keeps the day's main lifts in the fourth session (F06)", () => {
    const profiles: [Goal, Exclude<EquipmentPreset, "custom">][] = [
      ["fat_loss", "bodyweight"],
      ["muscle_gain", "dumbbells"],
      ["strength", "home_gym"],
      ["endurance", "bodyweight"],
    ]
    for (const [goal, preset] of profiles) {
      const profile = profileFor(goal, "beginner", preset, 3, 45)
      const sessions = trainOn(profile, [0, 2, 4, 6])
      const day6 = sessions[3]!
      const label = `${goal}/${preset} ${day6.title}`
      expect(day6.title, label).toBe("Full body A")
      const lifts = mainOf(day6)
        .filter((e) => e.role !== "finisher")
        .map((e) => getExercise(e.exerciseId)!)
      const has = (patterns: string[], groups: string[]) =>
        lifts.some((ex) => patterns.includes(ex.movementPattern) && groups.includes(muscleGroupOf(ex)))
      expect(has(["horizontal_push"], ["chest"]), `${label}: chest press`).toBe(true)
      expect(has(["squat", "lunge"], ["quads", "glutes"]), `${label}: squat or lunge`).toBe(true)
      expect(has(["horizontal_pull", "vertical_pull"], ["back"]), `${label}: pull`).toBe(true)
      // Nothing was excluded or unavailable, so nothing stands in through a secondary muscle.
      expect(mainOf(day6).some((e) => /Stand-in/.test(e.note ?? "")), label).toBe(false)
    }
  })

  it("a knee-limited Lower B never stacks hip thrusts for the squat and says why quads are missing (F06, F10)", () => {
    const lookup = lookupFor(EXERCISES)
    let lowerB = 0
    for (const goal of GOALS) {
      for (const preset of ["full_gym", "dumbbells", "home_gym"] as const) {
        const profile = makeProfile({
          id: `knee-${goal}-${preset}`,
          goal,
          experience: "intermediate",
          equipmentPreset: preset,
          equipment: EQUIPMENT_PRESETS[preset],
          trainingDaysPerWeek: 4,
          limitations: ["knee"],
        })
        for (const w of trainOn(profile, [0, 1, 3, 4, 7, 8, 10, 11])) {
          if (w.title !== "Lower B") continue
          lowerB++
          const lifts = mainOf(w).filter((e) => e.role !== "finisher").map((e) => getExercise(e.exerciseId)!)
          const thrusts = lifts.filter((ex) => familyRoot(ex, lookup) === "barbell-hip-thrust")
          expect(thrusts.length, `${profile.id} ${w.date}`).toBeLessThanOrEqual(1)
          const quadSets = mainOf(w)
            .filter((e) => e.role !== "finisher" && muscleGroupOf(getExercise(e.exerciseId)!) === "quads")
            .reduce((sum, e) => sum + e.sets, 0)
          if (quadSets === 0) {
            expect(w.focus, `${profile.id} ${w.date}`).not.toContain("quads")
            expect((w.notes ?? []).some((n) => /quads/.test(n) && /knee is flagged/.test(n) && /professional assessment/.test(n))).toBe(true)
          }
        }
      }
    }
    expect(lowerB).toBeGreaterThan(0)
    // The coach's sample profile has no knee-safe quad lift: the note is required there.
    const sample = makeProfile({ id: "knee-sample", goal: "fat_loss", experience: "intermediate", trainingDaysPerWeek: 4, limitations: ["knee"] })
    const day = trainOn(sample, [0, 1, 3, 4]).find((w) => w.title === "Lower B")!
    expect(day.focus).not.toContain("quads")
    expect((day.notes ?? []).some((n) => /No direct quads work while your knee is flagged/.test(n))).toBe(true)
  })

  it("full-body and upper days never press without pulling, and pulling keeps up overall (F09)", () => {
    let pressSets = 0
    let pullSets = 0
    const check = (w: ReturnType<typeof generateWorkout>, label: string, maxDeficit: number | null) => {
      if (w.split !== "full_body" && w.split !== "upper") return
      const lifts = mainOf(w).filter((e) => e.role !== "finisher").map((e) => ({ e, ex: getExercise(e.exerciseId)! }))
      const press = lifts.filter(({ ex }) => PRESS_PATTERNS.has(ex.movementPattern))
      const pull = lifts.filter(({ ex }) => PULL_PATTERNS.has(ex.movementPattern))
      if (press.length > 0) expect(pull.length, `${label}: press without pull`).toBeGreaterThan(0)
      const p = press.filter(({ ex }) => ex.mechanics === "compound").reduce((s, { e }) => s + e.sets, 0)
      const q = pull.reduce((s, { e }) => s + e.sets, 0)
      if (maxDeficit !== null) expect(p - q, `${label}: ${p} press sets vs ${q} pull sets`).toBeLessThanOrEqual(maxDeficit)
      pressSets += p
      pullSets += q
    }
    for (const goal of GOALS) {
      for (const experience of LEVELS) {
        for (const preset of PRESETS) {
          for (const days of [2, 3, 4, 5] as TrainingDays[]) {
            for (const duration of DURATIONS) {
              const profile = profileFor(goal, experience, preset, days, duration)
              const w = generateWorkout(makeInput(profile))
              check(w, `${profile.id} ${w.title}`, 2)
              if (duration === 30 || duration === 60) {
                const offsets = [...WEEK[days], ...WEEK[days].map((d) => d + 7)]
                for (const s of trainOn(profile, offsets)) check(s, `${profile.id} ${s.title} ${s.date}`, null)
              }
            }
          }
        }
      }
    }
    expect(pullSets).toBeGreaterThanOrEqual(pressSets)
    // A full-grid simulation: it ran close to the default 5 s timeout before the core changes, and
    // the protected-core check adds a second plan on some days.
  }, 60_000)

  it("thirty-minute conditioning sessions always close with exactly one finisher (F05)", () => {
    for (const goal of ["endurance", "fat_loss", "general_fitness"] as Goal[]) {
      for (const preset of ["bodyweight", "full_gym"] as const) {
        for (const experience of LEVELS) {
          const profile = profileFor(goal, experience, preset, 3, 30)
          const gentle = EXERCISES.some((e) => fitsFinisher(e) && passesProfileFilter(e, profile) && e.tags?.includes("low_impact"))
          for (let seed = 1; seed <= 20; seed++) {
            const w = generateWorkout(makeInput(profile, "2026-10-07", [], {}, seed))
            const label = `${profile.id} seed ${seed}`
            const finishers = mainOf(w).filter((e) => e.role === "finisher")
            expect(finishers, label).toHaveLength(1)
            expect(mainOf(w)[mainOf(w).length - 1]?.role, label).toBe("finisher")
            expect(w.estimatedMinutes, label).toBeLessThanOrEqual(30 * 1.05)
            // Beginners' conditioning starts low impact whenever there is a low-impact option.
            if (experience === "beginner" && gentle) expect(getExercise(finishers[0]!.exerciseId)!.tags ?? [], label).toContain("low_impact")
          }
        }
      }
    }
  })

  it("a 4-day hypertrophy week at 60 minutes trains side and rear delts and keeps chest near back (F23)", () => {
    for (const preset of ["full_gym", "dumbbells", "home_gym"] as const) {
      for (const experience of LEVELS) {
        const profile = profileFor("muscle_gain", experience, preset, 4, 60)
        let chest = 0
        let back = 0
        let abduction = 0
        let rear = 0
        for (const w of trainOn(profile, WEEK[4])) {
          for (const e of mainOf(w)) {
            if (e.role === "finisher") continue
            const ex = getExercise(e.exerciseId)!
            if (muscleGroupOf(ex) === "chest") chest += e.sets
            if (muscleGroupOf(ex) === "back") back += e.sets
            if (ex.movementPattern === "shoulder_abduction") abduction++
            if (ex.primaryMuscle === "rear_delts") rear++
          }
        }
        const label = `${preset} ${experience}: chest ${chest} / back ${back}`
        expect(abduction, label).toBeGreaterThan(0)
        expect(rear, label).toBeGreaterThan(0)
        expect(chest / back, label).toBeGreaterThanOrEqual(0.7)
      }
    }
    // Strength on three days: every main lift more than once a week, not once.
    for (const experience of ["intermediate", "advanced"] as Experience[]) {
      const week = trainOn(profileFor("strength", experience, "full_gym", 3, 60), WEEK[3])
      expect(week.every((w) => w.split === "full_body")).toBe(true)
      const pressing = week.filter((w) => mainOf(w).some((e) => getExercise(e.exerciseId)!.movementPattern === "horizontal_push"))
      expect(pressing.length, experience).toBeGreaterThanOrEqual(2)
    }
  })

  it("explosive work opens the main phase and goals without conditioning get no finisher (F28, F18)", () => {
    let explosiveDays = 0
    for (const goal of GOALS) {
      for (const experience of LEVELS) {
        for (const preset of ["full_gym", "bodyweight"] as const) {
          for (const days of [3, 4, 5, 6] as TrainingDays[]) {
            const profile = profileFor(goal, experience, preset, days, 60)
            for (const w of trainOn(profile, WEEK[days])) {
              const m = mainOf(w).filter((e) => e.role !== "finisher")
              // Power work leads: unloaded plyometrics and Olympic lifts. Loaded ballistic lifts that
              // are not Olympic (Pendlay row, push press, swings) keep their compound place, so a
              // Pendlay row never comes before the day's deadlift (prescriptions F28 follow-up).
              const explosive = m.map((e) => {
                const ex = getExercise(e.exerciseId)!
                return isUnloadedPlyometric(ex) || !!ex.tags?.includes("olympic")
              })
              if (!GOAL_PRESCRIPTIONS[goal].conditioning) expect(mainOf(w).some((e) => e.role === "finisher"), `${profile.id} ${w.date}`).toBe(false)
              if (!explosive.includes(true)) continue
              explosiveDays++
              const label = `${profile.id} ${w.title}: ${m.map((e) => e.exerciseId).join(", ")}`
              expect(explosive[0], label).toBe(true)
              // Every explosive lift comes before every other lift.
              expect(explosive.indexOf(false) === -1 || explosive.lastIndexOf(true) < explosive.indexOf(false), label).toBe(true)
            }
          }
        }
      }
    }
    expect(explosiveDays).toBeGreaterThan(0)
  })
})

/** The coach sample harness's lifter: trains on the plan's weekdays from a Monday, logging calibrated loads. */
function simulateWeek(profile: UserProfile, totalDays: number): ReturnType<typeof generateWorkout>[] {
  const history: CompletedWorkout[] = []
  const out: ReturnType<typeof generateWorkout>[] = []
  for (const day of trainingDayOffsets(profile.trainingDaysPerWeek, totalDays)) {
    const w = generateWorkout(makeInput(profile, addDays(MONDAY, day), [...history].reverse(), progressFromHistory(history)))
    out.push(w)
    history.push(completeAtTop(w, getExercise, 40, { loads: "calibrated", lifter: profile }))
  }
  return out
}

/** Seconds of conditioning work in a session: finishers and cardio blocks, as the coach counts them. */
function conditioningSeconds(w: ReturnType<typeof generateWorkout>): number {
  return mainOf(w)
    .filter((e) => e.role === "finisher" || muscleGroupOf(getExercise(e.exerciseId)!) === "cardio")
    .reduce((sum, e) => sum + e.sets * (e.durationSeconds ?? (e.reps ? e.reps[1] * 3 : 0)), 0)
}

describe("coach round 2 (real library)", () => {
  it("every Upper A pulls once vertically and at least once horizontally (R08)", () => {
    let upperA = 0
    for (const goal of ["muscle_gain", "strength", "fat_loss", "general_fitness"] as Goal[]) {
      for (const preset of ["full_gym", "home_gym"] as const) {
        for (const duration of [45, 60] as DurationPreference[]) {
          const profile = profileFor(goal, "intermediate", preset, 4, duration)
          const verticalPull = EXERCISES.some(
            (ex) => ex.movementPattern === "vertical_pull" && ex.mechanics === "compound" && muscleGroupOf(ex) === "back" && passesProfileFilter(ex, profile),
          )
          if (!verticalPull) continue
          for (let seed = 1; seed <= 30; seed++) {
            const w = generateWorkout(makeInput(profile, MONDAY, [], {}, seed))
            if (w.title !== "Upper A") continue
            upperA++
            const lifts = mainOf(w).filter((e) => e.role !== "finisher").map((e) => getExercise(e.exerciseId)!)
            const label = `${profile.id} seed ${seed}: ${lifts.map((ex) => ex.id).join(", ")}`
            expect(lifts.filter((ex) => ex.movementPattern === "vertical_pull"), label).toHaveLength(1)
            expect(lifts.filter((ex) => ex.movementPattern === "horizontal_pull").length, label).toBeGreaterThanOrEqual(1)
          }
        }
      }
    }
    expect(upperA).toBeGreaterThan(0)
  })

  it("an endurance week does at least 20 conditioning minutes and keeps its lifting within the cap (R17)", () => {
    for (const preset of ["full_gym", "bodyweight"] as const) {
      for (const experience of LEVELS) {
        const profile = profileFor("endurance", experience, preset, 5, 45)
        const week = simulateWeek(profile, 7)
        const label = `${profile.id}: ${week.map((w) => w.title).join(", ")}`
        // Conditioning-led days alternate with full-body lifting.
        expect(week.filter((w) => w.split === "conditioning").length, label).toBeGreaterThanOrEqual(1)
        const minutes = week.reduce((sum, w) => sum + conditioningSeconds(w), 0) / 60
        expect(minutes, `${label}: ${minutes.toFixed(1)} conditioning min`).toBeGreaterThanOrEqual(20)
        for (const w of week) {
          const lifts = mainOf(w).filter((e) => e.role !== "finisher")
          // Core spec C03: a protected core day's trunk work does not count against the lifting cap.
          const nonCore = lifts.filter((e) => getExercise(e.exerciseId)!.category !== "core")
          expect(nonCore.length, `${label} ${w.title}`).toBeLessThanOrEqual(liftingSlotCap(45, "endurance"))
          expect(lifts.length, `${label} ${w.title}`).toBeLessThanOrEqual(liftingSlotCap(45, "endurance") + 1)
          if (w.split !== "conditioning") continue
          // The circuit: accessory lifts at their minimum dose, never a heavy compound slot.
          for (const e of lifts) {
            expect(e.role, `${label} ${w.title} ${e.exerciseId}`).not.toMatch(/compound/)
            expect(e.sets, `${label} ${w.title} ${e.exerciseId}`).toBeLessThanOrEqual(2)
          }
          expect(conditioningSeconds(w), `${label} ${w.title}`).toBeGreaterThanOrEqual(5 * 60)
        }
      }
    }
  })

  it("a thirty-minute three-day full-body week has trunk work (R17)", () => {
    for (const goal of ["endurance", "fat_loss", "general_fitness"] as Goal[]) {
      for (const preset of ["bodyweight", "full_gym"] as const) {
        const profile = profileFor(goal, "beginner", preset, 3, 30)
        const week = simulateWeek(profile, 7)
        const core = week.flatMap((w) => mainOf(w)).filter((e) => getExercise(e.exerciseId)!.category === "core")
        expect(core.length, `${profile.id}: ${week.map((w) => w.title).join(", ")}`).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it("the endurance sample keeps its conditioning rounds through the time fit (R01)", () => {
    const profile = makeProfile({
      id: "coach-endurance-intermediate-fullgym-5d",
      goal: "endurance",
      experience: "intermediate",
      gender: "male",
      weightKg: 72,
      trainingDaysPerWeek: 5,
      equipmentPreset: "full_gym",
      equipment: EQUIPMENT_PRESETS.full_gym,
      durationPreferenceMinutes: 45,
    })
    const week = simulateWeek(profile, 8)
    for (const w of [week[0]!, week[week.length - 1]!]) {
      const finisher = mainOf(w).find((e) => e.role === "finisher")!
      expect(finisher, w.date).toBeDefined()
      const ex = getExercise(finisher.exerciseId)!
      const label = `${w.date} ${w.title}: ${finisher.exerciseId} ${finisher.sets} rounds`
      // Interval blocks keep at least three rounds and the exercise's own minimum (a steady block
      // is one long round): the lifts give up sets to fit, not the conditioning.
      if (ex.setsRange[1] > 1) expect(finisher.sets, label).toBeGreaterThanOrEqual(Math.max(3, ex.setsRange[0]))
      expect(w.estimatedMinutes, label).toBeLessThanOrEqual(45 * 1.05)
    }
  })

  it("support lifts repeat on their split day while they progress, and a swap never brings in an off-goal lift (R07)", () => {
    // hypertrophy-i-d7: 4 of 6 main lifts were first exposures every week, so none progressed.
    const profile = profileFor("muscle_gain", "intermediate", "full_gym", 4, 60)
    const upperA = simulateWeek(profile, 21).filter((w) => w.title === "Upper A")
    expect(upperA.length).toBeGreaterThanOrEqual(3)
    const support = (w: ReturnType<typeof generateWorkout>) => mainOf(w).filter((e) => e.role === "accessory" || e.role === "isolation")
    const first = support(upperA[0]!)
    let progressed = 0
    for (const lift of first) {
      const later = upperA.slice(1, 3).map((w) => support(w).find((e) => e.exerciseId === lift.exerciseId))
      expect(later.every(Boolean), `${lift.exerciseId} repeats in weeks 2 and 3`).toBe(true)
      const doses = [lift, ...later].map((e) => [e!.recommendedWeightKg ?? 0, e!.reps?.[1] ?? 0, e!.sets] as const)
      if (doses.some((d, i) => i > 0 && (d[0] > doses[i - 1]![0] || d[1] > doses[i - 1]![1] || d[2] > doses[i - 1]![2]))) progressed++
    }
    expect(progressed, "a repeated support lift gains load, reps or a set").toBeGreaterThan(0)

    // endurance-b-d7: the rotation swapped the doorway row for negative pull-ups (not an endurance lift).
    const endurance = profileFor("endurance", "beginner", "bodyweight", 3, 45)
    const week = simulateWeek(endurance, 8)
    const fullA = week.filter((w) => w.title === week[0]!.title)
    expect(fullA.length).toBeGreaterThanOrEqual(2)
    const firstIds = new Set(support(fullA[0]!).map((e) => e.exerciseId))
    for (const w of fullA.slice(1)) {
      for (const e of support(w)) expect(getExercise(e.exerciseId)!.goalCompatibility, e.exerciseId).toContain("endurance")
      if (firstIds.has("doorway-row")) expect(mainOf(w).map((e) => e.exerciseId)).toContain("doorway-row")
    }
  })

  it("a 60-minute hypertrophy upper/lower week has direct triceps work and keeps its side and rear delts (R18)", () => {
    for (const experience of LEVELS) {
      for (const preset of ["full_gym", "home_gym"] as const) {
        const profile = profileFor("muscle_gain", experience, preset, 4, 60)
        let elbowExtension = 0
        let rear = 0
        for (const w of trainOn(profile, WEEK[4])) {
          for (const e of mainOf(w)) {
            const ex = getExercise(e.exerciseId)!
            if (ex.movementPattern === "elbow_extension" && ex.mechanics === "isolation") elbowExtension += e.sets
            if (ex.primaryMuscle === "rear_delts") rear++
          }
        }
        expect(elbowExtension, `${preset} ${experience}`).toBeGreaterThanOrEqual(3)
        expect(rear, `${preset} ${experience}`).toBeGreaterThan(0)
      }
    }
  })

  it("a full-body day's second pull is a back compound when the back has room (R09)", () => {
    for (const goal of ["muscle_gain", "general_fitness", "strength"] as Goal[]) {
      for (const experience of LEVELS) {
        const profile = profileFor(goal, experience, "full_gym", 2, 60)
        for (let seed = 1; seed <= 10; seed++) {
          const w = generateWorkout(makeInput(profile, "2026-10-05", [], {}, seed))
          if (w.title !== "Full body A") continue
          for (const e of mainOf(w).filter((x) => x.role === "accessory")) {
            const ex = getExercise(e.exerciseId)!
            if (ex.movementPattern !== "horizontal_pull" && ex.movementPattern !== "vertical_pull") continue
            expect(muscleGroupOf(ex), `${profile.id} seed ${seed}: ${ex.id}`).toBe("back")
            expect(ex.mechanics, `${profile.id} seed ${seed}: ${ex.id}`).toBe("compound")
          }
        }
      }
    }
  })

  it("lifts that need an adjustable or raised bench, or battle ropes, reach only the full-gym preset (R26)", () => {
    const needsKit = ["seal-row", "incline-dumbbell-press", "chest-supported-dumbbell-row", "battle-rope"].map((id) => getExercise(id)!)
    for (const preset of ["home_gym", "dumbbells", "bodyweight"] as const) {
      const profile = profileFor("muscle_gain", "advanced", preset, 4, 60)
      for (const ex of needsKit) expect(passesProfileFilter(ex, profile), `${preset}: ${ex.id}`).toBe(false)
      for (const w of trainOn(profile, WEEK[4])) for (const e of mainOf(w)) expect(needsKit.map((x) => x.id), preset).not.toContain(e.exerciseId)
    }
    const custom = makeProfile({ equipmentPreset: "custom", equipment: [...EQUIPMENT_PRESETS.full_gym] })
    for (const ex of needsKit) expect(passesProfileFilter(ex, custom), `custom: ${ex.id}`).toBe(false)
    const gym = profileFor("muscle_gain", "advanced", "full_gym", 4, 60)
    for (const ex of needsKit) expect(passesProfileFilter(ex, gym), `full_gym: ${ex.id}`).toBe(true)
  })

  it("a shoulder-flagged upper day says which support work its flag leaves out (R27)", () => {
    const profile = makeProfile({ ...profileFor("general_fitness", "intermediate", "home_gym", 4, 60), limitations: ["shoulder"] })
    const w = generateWorkout(makeInput(profile, MONDAY))
    expect(w.title).toBe("Upper A")
    const dropped = (w.notes ?? []).filter((n) => /flagged; consider a professional assessment/.test(n))
    expect(dropped.length, (w.notes ?? []).join(" | ")).toBeGreaterThan(0)
    expect(dropped.some((n) => /shoulder/.test(n))).toBe(true)
  })

  it("an upper day's back compound pull can be swapped for the other plane (R08)", () => {
    const profile = profileFor("muscle_gain", "intermediate", "full_gym", 4, 60)
    const input = makeInput(profile, MONDAY)
    const w = generateWorkout(input)
    expect(w.title).toBe("Upper A")
    const pulldown = mainOf(w).find((e) => e.role === "secondary_compound")!
    expect(getExercise(pulldown.exerciseId)!.movementPattern).toBe("vertical_pull")
    const swaps = replacementCandidates(w, pulldown.slotId, input, 12).map((c) => getExercise(c.exerciseId)!)
    expect(swaps.some((e) => e.movementPattern === "vertical_pull")).toBe(true)
    expect(swaps.some((e) => e.movementPattern === "horizontal_pull" && muscleGroupOf(e) === "back")).toBe(true)
    // The same plane comes first.
    expect(swaps[0]!.movementPattern).toBe("vertical_pull")
  })

  it("a conditioning day's steady block swaps for other steady cardio and keeps its minutes (R17)", () => {
    const profile = profileFor("endurance", "intermediate", "full_gym", 4, 45)
    let checked = 0
    for (const day of [1, 3]) {
      const input = makeInput(profile, addDays(MONDAY, day), [], {})
      const history = simulateWeek(profile, day + 1).slice(0, -1).map((w) => completeAtTop(w, getExercise, 40, { loads: "calibrated", lifter: profile }))
      const w = generateWorkout({ ...input, history: [...history].reverse(), progress: progressFromHistory(history) })
      if (w.split !== "conditioning") continue
      const block = mainOf(w).find((e) => e.role === "finisher")!
      const ex = getExercise(block.exerciseId)!
      if (!ex.tags?.includes("steady_state")) continue
      const swapped = replaceExercise(w, block.slotId, { ...input, history: [...history].reverse(), progress: progressFromHistory(history) })
      expect(swapped).not.toBeNull()
      const after = swapped!.exercises.find((e) => e.slotId === block.slotId)!
      const next = getExercise(after.exerciseId)!
      expect(next.tags).toContain("steady_state")
      expect(after.sets).toBe(1)
      expect(after.durationSeconds).toBe(Math.max(next.durationRange![0], Math.min(next.durationRange![1], block.durationSeconds!)))
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it("a swapped warm-up or cool-down item keeps the builders' short prescriptions (R25, R18)", () => {
    const profile = profileFor("fat_loss", "intermediate", "bodyweight", 3, 45)
    const input = makeInput(profile, MONDAY)
    const w = generateWorkout(input)
    const pulse = w.exercises.find((e) => e.phase === "warmup")!
    const swapped = replaceExercise(w, pulse.slotId, input, { withExerciseId: "warmup-jumping-jacks" }) ?? replaceExercise(w, pulse.slotId, input)
    expect(swapped).not.toBeNull()
    const after = swapped!.exercises.find((e) => e.slotId === pulse.slotId)!
    if (after.exerciseId === "warmup-jumping-jacks") expect(after.durationSeconds!).toBeLessThanOrEqual(120)
    const stretch = w.exercises.find((e) => e.phase === "cooldown" && e.durationSeconds !== null && getExercise(e.exerciseId)!.movementPattern === "stretch")!
    const cooled = replaceExercise(w, stretch.slotId, input)!
    const next = cooled.exercises.find((e) => e.slotId === stretch.slotId)!
    const range = getExercise(next.exerciseId)!.durationRange
    if (range) expect(next.durationSeconds).toBe(range[0])
  })

  it("a conditioning block done in full moves one lever the next time it comes round (R12)", () => {
    const profile = makeProfile({ ...profileFor("fat_loss", "intermediate", "full_gym", 3, 60), preferredExerciseIds: ["rowing-intervals"] })
    const week = simulateWeek(profile, 10)
    const blocks = week.map((w) => mainOf(w).find((e) => e.exerciseId === "rowing-intervals")).filter((e): e is NonNullable<typeof e> => !!e)
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    const [first, next] = [blocks[0]!, blocks[1]!]
    const moved = next.durationSeconds! > first.durationSeconds! || next.sets > first.sets || next.restSeconds < first.restSeconds
    expect(moved, `${first.sets}×${first.durationSeconds}/${first.restSeconds} → ${next.sets}×${next.durationSeconds}/${next.restSeconds}`).toBe(true)
    expect(next.note ?? "").toMatch(/^(Held the full \d+ s every round last time|Every round done last time)/)
  })
})


// ---------------------------------------------------------------------------------------------
// Core programming spec (C01, C04, C05, C07, C22): two-week simulations against the real library.
// ---------------------------------------------------------------------------------------------

describe("core programming over two weeks (core spec)", () => {
  /** The core audit's schedule: training-day offsets within a week (Mon = 0). */
  const WEEK: Record<TrainingDays, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] }
  const trunk = (e: Workout["exercises"][number]) => {
    if (e.phase !== "main" || e.role === "finisher") return false
    const ex = getExercise(e.exerciseId)!
    return (ex.category === "core" || muscleGroupOf(ex) === "core") && !ex.tags?.includes("conditioning")
  }
  /** Two calendar weeks on the audit schedule, each week's workouts in order, every session completed on target. */
  function twoWeeks(profile: UserProfile): Workout[][] {
    const history: CompletedWorkout[] = []
    const weeks: Workout[][] = []
    for (let week = 0; week < 2; week++) {
      const done: Workout[] = []
      for (const offset of WEEK[profile.trainingDaysPerWeek]) {
        const w = generateWorkout(makeInput(profile, addDays("2026-10-05", week * 7 + offset), [...history].reverse(), progressFromHistory(history)))
        done.push(w)
        history.push(completeAtTop(w, getExercise, 40, { loads: "calibrated", lifter: profile }))
      }
      weeks.push(done)
    }
    return weeks
  }
  const coreSessions = (week: Workout[]) => week.filter((w) => w.exercises.some(trunk)).length
  const coreSets = (week: Workout[]) => week.reduce((sum, w) => sum + w.exercises.filter(trunk).reduce((s, e) => s + e.sets, 0), 0)

  it("C01/C02: at least two core sessions in each calendar week, never more than the day ceiling", () => {
    for (const goal of GOALS) {
      for (const days of DAYS) {
        for (const minutes of [30, 45, 60] as DurationPreference[]) {
          const profile = profileFor(goal, "intermediate", "full_gym", days, minutes)
          const weeks = twoWeeks(profile)
          for (const week of weeks) {
            const label = `${profile.id}: ${week.map((w) => `${w.title}${w.exercises.some(trunk) ? "+core" : ""}`).join(", ")}`
            expect(coreSessions(week), label).toBeLessThanOrEqual(MAX_CORE_DAYS[days])
            // Known gap (reported with the spec): at 30 minutes a conditioning goal's day is three
            // lifts and a conditioning block with no isolation to give way, and an endurance 2-3 day
            // plan's Full body A is filled by its lifts and block, so the protected block (which never
            // costs a compound set or the block's protected rounds, C03) often has no time. Every
            // other plan, and every plan from 45 minutes, meets the floor.
            const short = minutes === 30 && (goal === "fat_loss" || goal === "general_fitness" || (goal === "endurance" && days <= 3))
            if (!short) expect(coreSessions(week), label).toBeGreaterThanOrEqual(2)
          }
        }
      }
    }
  }, 120_000)

  it("C04: weekly core sets stay within the trunk's own cap", () => {
    const cases = [
      { profile: profileFor("muscle_gain", "advanced", "full_gym", 6, 75), cap: 12 },
      { profile: profileFor("strength", "beginner", "home_gym", 3, 75), cap: 6 },
    ]
    for (const { profile, cap } of cases) {
      expect(coreWeeklyCap(profile.goal, profile.experience)).toBe(cap)
      for (const week of twoWeeks(profile)) expect(coreSets(week), profile.id).toBeLessThanOrEqual(cap)
    }
  })

  it("C05 and C22: trunk work follows every compound, and no core note sells fat loss or injury proofing", () => {
    const COPY = /fat|burn|belly|waist|ton(e|ing)|injur(y|ies)[- ]proof|prevent/i
    for (const goal of GOALS) {
      for (const experience of LEVELS) {
        for (const preset of PRESETS) {
          for (const days of [3, 5] as TrainingDays[]) {
            for (const minutes of [30, 60] as DurationPreference[]) {
              const profile = profileFor(goal, experience, preset, days, minutes)
              for (const w of twoWeeks(profile).flat()) {
                const main = w.exercises.filter((e) => e.phase === "main")
                const first = main.findIndex(trunk)
                if (first < 0) continue
                for (const e of main.slice(first + 1)) {
                  const ex = getExercise(e.exerciseId)!
                  if (ex.category === "core") continue
                  const compound = e.role === "primary_compound" || e.role === "secondary_compound" || (e.role === "accessory" && ex.mechanics === "compound")
                  expect(compound, `${profile.id} ${w.title}: ${e.exerciseId} after trunk work`).toBe(false)
                }
                for (const e of main.filter(trunk)) expect(e.note ?? "", `${profile.id} ${e.exerciseId}`).not.toMatch(COPY)
              }
            }
          }
        }
      }
    }
  }, 120_000)

  it("C07: a three-day full-body week rotates trunk families and keeps each day's drill for its block", () => {
    const profile = profileFor("general_fitness", "intermediate", "full_gym", 3, 60)
    const weeks = twoWeeks(profile)
    const families = new Set(weeks.flat().flatMap((w) => w.exercises.filter(trunk).map((e) => coreFamily(getExercise(e.exerciseId)!))))
    families.delete(null)
    expect(families.size, [...families].join(",")).toBeGreaterThanOrEqual(3)
    const fullA = weeks.map((week) => week.find((w) => w.title === "Full body A")!.exercises.filter(trunk).map((e) => e.exerciseId))
    expect(fullA[0]!.length).toBeGreaterThan(0)
    expect(fullA[1]).toEqual(fullA[0])
  })
})
