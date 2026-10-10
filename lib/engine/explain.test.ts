import { describe, expect, it } from "vitest"
import type { CompletedWorkout } from "@/lib/domain/types"
import { generateWorkout } from "./generate"
import { explainWorkout } from "./explain"
import { libraryFrom } from "./library"
import { completeAtTop, FIXTURE_BY_ID, FIXTURE_LIBRARY, makeInput, makeProfile, progressFromHistory } from "./test-fixtures"

const lib = libraryFrom(FIXTURE_LIBRARY)

describe("explainWorkout", () => {
  it("explains a first workout", () => {
    const input = makeInput(makeProfile({ goal: "strength" }))
    const w = generateWorkout(input, lib)
    const lines = explainWorkout(w, input, lib)
    expect(lines.length).toBeGreaterThanOrEqual(4)
    expect(lines[0]).toMatch(/^Upper A: .*fresh/)
    expect(lines[1]).toMatch(/Day 1 of your 4-day rotation/)
    expect(lines.some((l) => /Strength block: \d×\d(–\d)?/.test(l))).toBe(true)
    expect(lines.some((l) => /main exercises to fit about 60 minutes/.test(l))).toBe(true)
    expect(lines.some((l) => /Weights suggested/.test(l))).toBe(false)
  })

  it("mentions rest days, rotation, finisher, weights and caps when they apply", () => {
    const profile = makeProfile({ goal: "fat_loss", trainingDaysPerWeek: 3, experience: "beginner" })
    const first = generateWorkout(makeInput(profile, "2026-10-04"), lib)
    const history = [completeAtTop(first, (id) => FIXTURE_BY_ID.get(id), 30)]
    const input = makeInput(profile, "2026-10-07", history, progressFromHistory(history))
    const w = generateWorkout(input, lib)
    const lines = explainWorkout(w, input, lib)
    expect(lines[0]).toMatch(/3 days rested|fresh|untouched/)
    expect(lines[1]).toMatch(/Next in your 3-day rotation after Full body A/)
    expect(lines.some((l) => /Fat-loss block/.test(l))).toBe(true)
    expect(lines.some((l) => /Conditioning finisher/.test(l))).toBe(true)
    if (w.exercises.some((e) => e.recommendedWeightKg !== null && e.weightSource === "history")) {
      expect(lines.some((l) => /Weights suggested/.test(l))).toBe(true)
    }
    expect(explainWorkout(w, input, lib)).toEqual(lines)
  })

  it("says the rotation restarted after a long break instead of inventing a recovery swap", () => {
    for (const trainingDaysPerWeek of [2, 4] as const) {
      const profile = makeProfile({ trainingDaysPerWeek })
      const first = generateWorkout(makeInput(profile, "2026-09-23"), lib)
      const history = [completeAtTop(first, (id) => FIXTURE_BY_ID.get(id))]
      const input = makeInput(profile, "2026-10-07", history, progressFromHistory(history))
      const w = generateWorkout(input, lib)
      expect(w.title).toBe(first.title)
      const lines = explainWorkout(w, input, lib)
      expect(lines[1]).toBe(`Restarting your ${trainingDaysPerWeek}-day rotation after 14 days off.`)
      expect(lines.some((l) => /Swapped|48h/.test(l))).toBe(false)
    }
  })

  it("explains a recovery swap only when the generator made one", () => {
    const profile = makeProfile({ trainingDaysPerWeek: 4 })
    const history: CompletedWorkout[] = []
    for (let d = 1; d <= 4; d++) {
      const w = generateWorkout(makeInput(profile, `2026-10-0${d}`, history), lib)
      history.unshift(completeAtTop(w, (id) => FIXTURE_BY_ID.get(id)))
    }
    // Natural next is Upper A, but an upper session yesterday (logged as Lower B) loaded the chest.
    const fake = completeAtTop(generateWorkout(makeInput(profile, "2026-10-05", history), lib), (id) => FIXTURE_BY_ID.get(id))
    const all = [{ ...fake, title: "Lower B", split: "lower" as const, date: "2026-10-05" }, ...history]
    const input = makeInput(profile, "2026-10-06", all, progressFromHistory(all))
    const w = generateWorkout(input, lib)
    expect(w.title).not.toBe("Upper A")
    const lines = explainWorkout(w, input, lib)
    expect(lines[1]).toMatch(new RegExp(`^Swapped Upper A for ${w.title}: .*chest.* trained heavy in the last 48h\\.$`))
  })

  it("follows the goal's rotation and surfaces the rest-day guard (F23, F17)", () => {
    // A 3-day strength lifter trains full body: the explanation must name the same rotation.
    const profile = makeProfile({ goal: "strength", experience: "intermediate", trainingDaysPerWeek: 3 })
    const first = generateWorkout(makeInput(profile, "2026-10-05"), lib)
    expect(first.title).toBe("Full body A")
    const history = [completeAtTop(first, (id) => FIXTURE_BY_ID.get(id))]
    const input = makeInput(profile, "2026-10-07", history, progressFromHistory(history))
    const w = generateWorkout(input, lib)
    expect(explainWorkout(w, input, lib)[1]).toBe("Next in your 3-day rotation after Full body A.")

    const daily = makeProfile({ trainingDaysPerWeek: 4 })
    const done: CompletedWorkout[] = []
    for (let d = 1; d <= 6; d++) {
      const day = generateWorkout(makeInput(daily, `2026-10-0${d}`, done.slice()), lib)
      done.unshift(completeAtTop(day, (id) => FIXTURE_BY_ID.get(id)))
    }
    const tired = makeInput(daily, "2026-10-07", done, progressFromHistory(done))
    const lines = explainWorkout(generateWorkout(tired, lib), tired, lib)
    expect(lines.some((l) => l.startsWith("Rest day recommended"))).toBe(true)
  })

  it("names a conditioning-led day's block as the main work, not a finisher (R17)", () => {
    const profile = makeProfile({ goal: "endurance", trainingDaysPerWeek: 5, durationPreferenceMinutes: 45 })
    const first = generateWorkout(makeInput(profile, "2026-10-05"), lib)
    expect(first.title).toBe("Full body A")
    const history = [completeAtTop(first, (id) => FIXTURE_BY_ID.get(id))]
    const input = makeInput(profile, "2026-10-06", history, progressFromHistory(history))
    const w = generateWorkout(input, lib)
    expect(w.split).toBe("conditioning")
    const lines = explainWorkout(w, input, lib)
    expect(lines[1]).toBe("Next in your 5-day rotation after Full body A.")
    expect(lines.some((l) => l.startsWith("Conditioning day: a short full-body circuit"))).toBe(true)
    expect(lines.some((l) => l.startsWith("Conditioning finisher"))).toBe(false)
    // A lifting day still closes with a finisher.
    expect(explainWorkout(first, makeInput(profile, "2026-10-05"), lib).some((l) => l.startsWith("Conditioning finisher"))).toBe(true)
  })

  it("surfaces engine notes and swaps", () => {
    const input = makeInput(makeProfile())
    const w = generateWorkout(input, libraryFrom([]))
    const lines = explainWorkout(w, input, libraryFrom([]))
    expect(lines[lines.length - 1]).toMatch(/No exercises match/)
  })
})
