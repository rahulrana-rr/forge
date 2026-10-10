import { describe, expect, it } from "vitest"

import type { Gender, Experience, Units } from "@/lib/domain/types"
import { EXERCISES, requireExercise } from "@/lib/exercises"
import { estimateStartingLoad, MIN_KG, startingLoadKg } from "./starting-load"

const male = { weightKg: 82, gender: "male" as const, experience: "intermediate" as const, units: "kg" as const }
const beginnerMale = { ...male, experience: "beginner" as const }

/** The heuristic behind an estimate (kept even when the card asks for a working weight). */
function rawKg(id: string, profile: Parameters<typeof estimateStartingLoad>[1], reps: [number, number]): number {
  return estimateStartingLoad(requireExercise(id), profile, reps).rawKg!
}

describe("startingLoadKg", () => {
  // Coach round 2 (R10): an intermediate's main barbell lifts used to show these heuristic values
  // as numbers (bench 32.5 kg for an 82 kg man). They now ask for a working weight; the heuristic
  // is kept (rawKg) because it bounds the logged-load check, and it stays conservative.
  it("keeps conservative heuristics for the main barbell lifts", () => {
    const bench = rawKg("barbell-bench-press", male, [6, 8])
    const squat = rawKg("barbell-back-squat", male, [6, 8])
    const deadlift = rawKg("conventional-deadlift", male, [5, 6])
    expect(bench).toBeGreaterThanOrEqual(20)
    expect(bench).toBeLessThanOrEqual(0.5 * male.weightKg)
    expect(squat).toBeGreaterThan(bench)
    expect(deadlift).toBeGreaterThan(bench)
    expect(deadlift).toBeLessThanOrEqual(0.7 * male.weightKg)
    // A beginner still gets a number for them.
    expect(startingLoadKg(requireExercise("barbell-back-squat"), beginnerMale, [6, 8])).toBeGreaterThan(20)
  })

  it("rounds to the load step and asks for a working weight instead of showing the empty bar", () => {
    const squat = startingLoadKg(requireExercise("barbell-back-squat"), beginnerMale, [6, 8])!
    expect(squat % 2.5).toBe(0)
    // Coach round 1 (F02): this used to return 20, the empty bar, for a raw value of about 9 kg.
    // The rack minimum shown as an estimate is not an estimate; the card now asks the lifter to
    // find their working weight.
    const tiny = estimateStartingLoad(requireExercise("barbell-bench-press"), { ...male, weightKg: 40, experience: "beginner" }, [10, 12])
    expect(tiny.weightKg).toBeNull()
    expect(tiny.findWorkingWeight).toBe(true)
  })

  it("scales with experience and gender", () => {
    // Coach round 2 (R10): compared on the heuristic, since only beginners see a squat number now.
    const id = "barbell-back-squat"
    const beginner = rawKg(id, { ...male, experience: "beginner" }, [8, 10])
    const intermediate = rawKg(id, male, [8, 10])
    const advanced = rawKg(id, { ...male, experience: "advanced" }, [8, 10])
    expect(beginner).toBeLessThan(intermediate)
    expect(intermediate).toBeLessThan(advanced)
    const female = rawKg(id, { ...male, gender: "female" }, [8, 10])
    const unspecified = rawKg(id, { ...male, gender: "unspecified" }, [8, 10])
    expect(female).toBeLessThanOrEqual(unspecified)
    expect(unspecified).toBeLessThanOrEqual(intermediate)
  })

  it("goes lighter as reps go up", () => {
    // Coach round 2 (R10): the dumbbell bench (a ramp-up lift) finds its load for an intermediate,
    // so the floor press, which keeps its estimate, carries this rule.
    const ex = requireExercise("dumbbell-floor-press")
    const heavy = startingLoadKg(ex, male, [6, 8])!
    const light = startingLoadKg(ex, male, [15, 20])!
    expect(light).toBeLessThanOrEqual(heavy)
    expect(light).toBeGreaterThanOrEqual(2)
  })

  it("returns null when there is no honest estimate", () => {
    expect(startingLoadKg(requireExercise("lat-pulldown"), male, [8, 12])).toBeNull()
    expect(startingLoadKg(requireExercise("push-up"), male, [8, 12])).toBeNull()
    expect(startingLoadKg(requireExercise("plank"), male, null)).toBeNull()
    expect(startingLoadKg(requireExercise("barbell-bench-press"), { ...male, weightKg: 0 }, [6, 8])).toBeNull()
  })

  it("stays conservative for heavy users: allometric above the reference, flat past the ceiling", () => {
    const bench = requireExercise("barbell-bench-press")
    const squat = requireExercise("barbell-back-squat")
    const at = (kg: number, experience: "beginner" | "intermediate" | "advanced" = "intermediate") => ({ ...male, weightKg: kg, experience })
    // Coach round 2 (R10): intermediate and advanced lifters find their working weight on these
    // lifts, so the bounds are checked on the heuristic (rawKg) that still bounds the logged-load
    // check; beginners' shown numbers keep the rounded bounds.
    // Never decreases with body weight, and stops growing at the ceiling.
    let previous = 0
    for (const kg of [60, 82, 100, 120, 150, 200, 300]) {
      const load = rawKg(bench.id, at(kg), [6, 8])
      expect(load).toBeGreaterThanOrEqual(previous)
      previous = load
    }
    expect(rawKg(bench.id, at(300), [6, 8])).toBe(rawKg(bench.id, at(150), [6, 8]))
    expect(rawKg(squat.id, at(300), [6, 8])).toBe(rawKg(squat.id, at(200), [6, 8]))
    expect(startingLoadKg(squat, at(300, "beginner"), [6, 8])).toBe(startingLoadKg(squat, at(200, "beginner"), [6, 8]))
    for (const kg of [150, 200, 300]) {
      // Intermediate men: well under a typical intermediate working weight at any body weight.
      expect(rawKg(bench.id, at(kg), [5, 6])).toBeLessThanOrEqual(50)
      expect(rawKg(squat.id, at(kg), [6, 8])).toBeLessThanOrEqual(60)
      expect(rawKg("conventional-deadlift", at(kg), [5, 6])).toBeLessThanOrEqual(70)
      expect(rawKg("overhead-press", at(kg), [4, 6])).toBeLessThanOrEqual(32.5)
      // The shown value for this was 60 kg; its unrounded heuristic is 60.5 kg.
      expect(rawKg(bench.id, at(kg, "advanced"), [5, 6])).toBeLessThanOrEqual(62.5)
      expect(startingLoadKg(requireExercise("trap-bar-deadlift"), at(kg, "beginner"), [4, 6])!).toBeLessThanOrEqual(45)
    }
    // Below the reference weight the estimate is unchanged (linear): 60 × 0.4 × 1.05.
    expect(rawKg(bench.id, at(60), [6, 8])).toBeCloseTo(25.2, 2)
  })

  it("gives no estimate for bar isolation work far below the empty bar", () => {
    const beginnerWoman = { weightKg: 60, gender: "female" as const, experience: "beginner" as const, units: "kg" as const }
    for (const id of ["barbell-curl", "wrist-curl", "reverse-wrist-curl"]) {
      expect(startingLoadKg(requireExercise(id), beginnerWoman, [8, 12])).toBeNull()
      expect(startingLoadKg(requireExercise(id), { ...beginnerWoman, units: "lb" }, [15, 20])).toBeNull()
    }
    expect(startingLoadKg(requireExercise("wrist-curl"), { ...male, weightKg: 80 }, [15, 20])).toBeNull()
    expect(startingLoadKg(requireExercise("ez-bar-curl"), beginnerWoman, [8, 12])).toBeNull()
    // Coach round 1 (F02): these used to show the lightest implement (a 2 kg dumbbell, the 20 kg
    // bar for a raw value of 17 kg). Values that only land on the rack minimum now ask the lifter
    // to find their working weight instead.
    const curl = estimateStartingLoad(requireExercise("dumbbell-curl"), beginnerWoman, [8, 12])
    expect(curl.weightKg).toBeNull()
    expect(curl.findWorkingWeight).toBe(true)
    const strongCurl = estimateStartingLoad(requireExercise("barbell-curl"), { ...male, weightKg: 100, experience: "advanced" }, [8, 10])
    expect(strongCurl.weightKg).toBeNull()
    expect(strongCurl.findWorkingWeight).toBe(true)
    // A curl estimate clearly above the bar is still shown.
    expect(startingLoadKg(requireExercise("ez-bar-curl"), { ...male, weightKg: 100, experience: "advanced" }, [8, 10])).toBeGreaterThan(MIN_KG.ez_bar)
  })

  it("gives no estimate for Olympic and skill lifts, and press-limited loads for thrusters", () => {
    const advanced = { ...male, weightKg: 85, experience: "advanced" as const }
    for (const id of ["barbell-snatch", "power-clean", "hang-power-clean", "barbell-clean-and-jerk", "turkish-get-up"]) {
      expect(startingLoadKg(requireExercise(id), advanced, [1, 3])).toBeNull()
      expect(startingLoadKg(requireExercise(id), advanced, [3, 5])).toBeNull()
    }
    for (const profile of [male, advanced, { ...male, weightKg: 120 }, { ...male, experience: "beginner" as const }]) {
      // Since coach round 1 (F02) a press that would only show the empty bar has no number
      // (null); the thruster then has none either. Since coach round 2 (R10) trained lifters
      // find their working weight on both ramp-up presses, so the press limit is checked on the
      // heuristic values.
      const press = startingLoadKg(requireExercise("overhead-press"), profile, [6, 10])
      const thruster = startingLoadKg(requireExercise("barbell-thruster"), profile, [6, 10])
      if (press === null) expect(thruster).toBeNull()
      else expect(thruster ?? 0).toBeLessThanOrEqual(press)
      expect(rawKg("barbell-thruster", profile, [6, 10])).toBeLessThanOrEqual(rawKg("overhead-press", profile, [6, 10]))
      const dbThruster = estimateStartingLoad(requireExercise("dumbbell-thruster"), profile, [8, 12])
      expect(dbThruster.rawKg!).toBeLessThanOrEqual(rawKg("seated-dumbbell-shoulder-press", profile, [8, 12]))
      const dbPress = startingLoadKg(requireExercise("seated-dumbbell-shoulder-press"), profile, [8, 12])
      if (dbPress !== null && dbThruster.weightKg !== null) expect(dbThruster.weightKg).toBeLessThanOrEqual(dbPress)
    }
  })

  it("works in pounds and stores kilograms", () => {
    // Coach round 2 (R10): a beginner's squat, since an intermediate's bench has no number now.
    const lb = startingLoadKg(requireExercise("barbell-back-squat"), { ...beginnerMale, units: "lb" }, [6, 8])!
    const inLb = lb / 0.45359237
    expect(Math.abs(inLb - Math.round(inLb / 5) * 5)).toBeLessThan(0.01)
    expect(inLb).toBeGreaterThanOrEqual(45)
  })
})

describe("starting loads after coach round 1 (F02)", () => {
  const beginner70 = { weightKg: 70, gender: "unspecified" as const, experience: "beginner" as const, units: "kg" as const }

  it("gives a 70 kg beginner real first loads, not the rack minimum", () => {
    // These used to land on the lightest implement (2 kg, 4 kg and 4 kg).
    for (const reps of [[8, 12], [10, 12], [10, 13], [12, 15]] as [number, number][]) {
      for (const id of ["incline-dumbbell-press", "single-arm-dumbbell-row", "kettlebell-deadlift"]) {
        const estimate = estimateStartingLoad(requireExercise(id), beginner70, reps)
        if (estimate.weightKg !== null) expect(estimate.weightKg, `${id} ${reps}`).toBeGreaterThan(MIN_KG[estimate.implement!])
      }
    }
    expect(startingLoadKg(requireExercise("kettlebell-deadlift"), beginner70, [10, 13])).toBeGreaterThanOrEqual(8)
    expect(startingLoadKg(requireExercise("incline-dumbbell-press"), beginner70, [10, 12])).toBeGreaterThan(2)
  })

  it("never shows a number more than 15% under its raw value, or at the rack minimum", () => {
    const genders: Gender[] = ["male", "female", "unspecified"]
    const levels: Experience[] = ["beginner", "intermediate", "advanced"]
    const repRanges: [number, number][] = [[3, 5], [6, 8], [8, 12], [10, 13], [12, 15], [15, 20]]
    let shown = 0
    for (const exercise of EXERCISES) {
      if (exercise.loadType !== "external") continue
      for (const gender of genders) for (const experience of levels) for (const units of ["kg", "lb"] as Units[]) {
        for (const weightKg of [48, 61, 70, 82, 100, 130]) for (const reps of repRanges) {
          const e = estimateStartingLoad(exercise, { weightKg, gender, experience, units }, reps)
          const label = `${exercise.id} ${gender} ${experience} ${weightKg} ${units} ${reps}`
          if (e.weightKg === null) {
            // Coach round 2 (R04): every loaded lift without a number asks for a working weight
            // unless technique limits it (Olympic and skill lifts). This used to require a
            // heuristic (rawKg) behind the prompt, so machines, cables and bands got neither.
            const technique = exercise.tags?.some((t) => t === "olympic" || t === "skill") ?? false
            expect(e.findWorkingWeight, label).toBe(!technique)
            continue
          }
          shown++
          expect(e.weightKg, label).toBeGreaterThanOrEqual(0.85 * e.rawKg! - 0.01)
          expect(e.weightKg, label).toBeGreaterThan(MIN_KG[e.implement!])
        }
      }
    }
    expect(shown).toBeGreaterThan(1000)
  })

  it("does not stack a third discount on top of the conservative table", () => {
    // Beginner (0.6) x female upper (0.6) = 0.36 is floored at 0.5 of the intermediate-male value.
    const row = requireExercise("chest-supported-dumbbell-row")
    const intermediateMale = estimateStartingLoad(row, { weightKg: 61, gender: "male", experience: "intermediate", units: "kg" }, [8, 12]).rawKg!
    const beginnerFemale = estimateStartingLoad(row, { weightKg: 61, gender: "female", experience: "beginner", units: "kg" }, [8, 12]).rawKg!
    expect(beginnerFemale / intermediateMale).toBeCloseTo(0.5, 2)
    // Rounding no longer floors a 5.3 kg hammer curl to 4 kg (a 25% cut): it goes to 6 kg.
    const hammer = estimateStartingLoad(requireExercise("hammer-curl"), { weightKg: 104, gender: "male", experience: "intermediate", units: "kg" }, [8, 12])
    expect(hammer.rawKg!).toBeLessThan(6)
    expect(hammer.weightKg).toBe(6)
  })
})

describe("single-implement lifts and calf raises (F29)", () => {
  it("loads one dumbbell held in both hands at about twice the per-hand value", () => {
    for (const reps of [[8, 12], [10, 15]] as [number, number][]) {
      const goblet = estimateStartingLoad(requireExercise("goblet-squat"), male, reps)
      const perHand = estimateStartingLoad(requireExercise("dumbbell-front-squat"), male, reps)
      expect(goblet.rawKg! / perHand.rawKg!).toBeCloseTo(2, 2)
      expect(goblet.weightKg!).toBeGreaterThanOrEqual(1.6 * perHand.weightKg!)
      expect(goblet.weightKg!).toBeLessThanOrEqual(2.4 * perHand.weightKg!)
    }
    const hipThrust = estimateStartingLoad(requireExercise("dumbbell-hip-thrust"), male, [10, 15])
    const bStance = estimateStartingLoad(requireExercise("b-stance-hip-thrust"), male, [10, 15])
    expect(hipThrust.rawKg! / bStance.rawKg!).toBeCloseTo(2, 2)
    // The sumo squat holds one dumbbell too; two-dumbbell and unilateral lifts are unchanged.
    const sumo = estimateStartingLoad(requireExercise("dumbbell-sumo-squat"), male, [10, 15]).rawKg!
    const front = estimateStartingLoad(requireExercise("dumbbell-front-squat"), male, [10, 15]).rawKg!
    expect(sumo / front).toBeCloseTo(2, 2)
  })

  it("gives the dumbbell calf raise a per-hand estimate", () => {
    const calf = startingLoadKg(requireExercise("dumbbell-calf-raise"), male, [10, 15])
    expect(calf).not.toBeNull()
    expect(calf!).toBeGreaterThan(MIN_KG.dumbbell)
    // Conservative: no more than the per-hand dumbbell squat value for the same reps.
    expect(calf!).toBeLessThanOrEqual(startingLoadKg(requireExercise("dumbbell-front-squat"), male, [10, 15])!)
  })
})

describe("coach round 2: trained lifters, loads without a heuristic, hinge and row fractions (R04, R10)", () => {
  it("asks intermediate and advanced lifters to find the load on heavy compounds, keeping the heuristic", () => {
    for (const experience of ["intermediate", "advanced"] as const) {
      for (const id of ["barbell-bench-press", "barbell-back-squat", "conventional-deadlift", "overhead-press", "incline-dumbbell-press"]) {
        const e = estimateStartingLoad(requireExercise(id), { ...male, experience }, [6, 10])
        expect(e.weightKg, `${id} ${experience}`).toBeNull()
        expect(e.findWorkingWeight, `${id} ${experience}`).toBe(true)
        // Kept: it bounds the logged-load check (progression.ts).
        expect(e.rawKg, `${id} ${experience}`).not.toBeNull()
      }
    }
    // Beginners keep a conservative number, and so do trained lifters on lifts without a ramp-up.
    expect(startingLoadKg(requireExercise("incline-dumbbell-press"), beginnerMale, [8, 12])).not.toBeNull()
    expect(startingLoadKg(requireExercise("chest-supported-dumbbell-row"), male, [8, 12])).not.toBeNull()
  })

  it("asks for a working weight on loaded lifts the tables cannot estimate", () => {
    for (const id of ["leg-press", "seated-cable-row", "landmine-press", "machine-chest-press", "lat-pulldown", "dumbbell-front-raise"]) {
      const e = estimateStartingLoad(requireExercise(id), male, [10, 12])
      expect(e.weightKg, id).toBeNull()
      expect(e.findWorkingWeight, id).toBe(true)
      expect(e.rawKg, id).toBeNull()
      expect(e.band ?? false, id).toBe(false)
    }
    const band = estimateStartingLoad(requireExercise("band-pushdown"), male, [15, 20])
    expect(band.findWorkingWeight).toBe(true)
    expect(band.band).toBe(true)
    // No body weight on the profile: no number, but still the prompt.
    expect(estimateStartingLoad(requireExercise("dumbbell-curl"), { ...male, weightKg: 0 }, [8, 12]).findWorkingWeight).toBe(true)
    // Technique-limited lifts and unloaded work get neither.
    for (const id of ["power-clean", "turkish-get-up", "push-up"]) {
      expect(estimateStartingLoad(requireExercise(id), male, [3, 5]).findWorkingWeight, id).toBe(false)
    }
  })

  it("does not discount a dumbbell hinge twice", () => {
    const beginner70 = { weightKg: 70, gender: "unspecified" as const, experience: "beginner" as const, units: "kg" as const }
    // Was 4 kg per hand: the hamstring factor discounted an already grip-limited dumbbell value.
    expect(startingLoadKg(requireExercise("dumbbell-romanian-deadlift"), beginner70, [10, 12])).toBeGreaterThanOrEqual(6)
    // Barbell RDLs still start lighter than floor pulls.
    expect(rawKg("romanian-deadlift", male, [8, 10])).toBeCloseTo(0.7 * rawKg("conventional-deadlift", male, [8, 10]), 1)
  })

  it("starts a bench-braced one-arm row heavier than a two-dumbbell row", () => {
    const profile = { weightKg: 66, gender: "female" as const, experience: "intermediate" as const, units: "kg" as const }
    const braced = estimateStartingLoad(requireExercise("single-arm-dumbbell-row"), profile, [10, 12])
    const twoHands = estimateStartingLoad(requireExercise("dumbbell-bent-over-row"), profile, [10, 12])
    expect(braced.rawKg!).toBeGreaterThan(1.5 * twoHands.rawKg!)
    // Was 6 kg for this lifter.
    expect(braced.weightKg!).toBeGreaterThanOrEqual(8)
  })

  it("keeps an advanced lifter's estimate well above a beginner's", () => {
    const advancedWoman = { weightKg: 64, gender: "female" as const, experience: "advanced" as const, units: "kg" as const }
    const beginnerWoman = { ...advancedWoman, experience: "beginner" as const }
    const row = (p: typeof advancedWoman | typeof beginnerWoman) => rawKg("chest-supported-dumbbell-row", p, [8, 12])
    // Profile factors 0.9 (advanced floor) against 0.5 (beginner floor); was 0.75 against 0.5.
    expect(row(advancedWoman) / row(beginnerWoman)).toBeCloseTo(1.8, 2)
  })
})
