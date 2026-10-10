import { describe, expect, it } from "vitest"
import type { Experience, TrainingDays } from "@/lib/domain/types"
import type { Goal } from "@/lib/exercises/types"
import {
  CONDITIONING_TEMPLATES,
  CORE_DAYS_TARGET,
  coreDays,
  FINISHER_SLOT,
  MAX_CORE_DAYS,
  liftingSlotCap,
  mainSlotCount,
  rotationFor,
  slotsForCount,
  spareSlots,
  TEMPLATES,
  templateForHistory,
  type SplitTemplate,
} from "./splits"

describe("splits", () => {
  it("rotations follow the programming rules", () => {
    expect(rotationFor(2, "beginner").map((t) => t.split)).toEqual(["full_body", "full_body"])
    expect(rotationFor(3, "beginner").map((t) => t.split)).toEqual(["full_body", "full_body", "full_body"])
    expect(rotationFor(3, "intermediate").map((t) => t.split)).toEqual(["push", "pull", "legs"])
    expect(rotationFor(4, "advanced").map((t) => t.split)).toEqual(["upper", "lower", "upper", "lower"])
    expect(rotationFor(5, "intermediate").map((t) => t.split)).toEqual(["push", "pull", "legs", "upper", "lower"])
    expect(rotationFor(6, "advanced").map((t) => t.split)).toEqual(["push", "pull", "legs", "push", "pull", "legs"])
    for (const days of [2, 3, 4, 5, 6] as TrainingDays[]) {
      const titles = rotationFor(days, "advanced").map((t) => t.title)
      expect(new Set(titles).size).toBe(titles.length)
    }
  })

  it("every template has ordered roles and sane slots", () => {
    for (const t of Object.values(TEMPLATES)) {
      expect(t.slots[0]?.role).toBe("primary_compound")
      expect(t.slots[1]?.role).toBe("secondary_compound")
      expect(t.slots.filter((s) => s.kind === "core")).toHaveLength(1)
      expect(new Set(t.slots.map((s) => s.priority)).size).toBe(t.slots.length)
      expect(t.focus.length).toBeGreaterThan(0)
      expect(t.heavyGroups.length).toBeGreaterThan(0)
      for (const s of t.slots) expect(s.patterns.length).toBeGreaterThan(0)
    }
  })

  it("full-body days carry one lower, one push, one pull and core in the top four", () => {
    for (const key of ["full_a", "full_b", "full_c"]) {
      const t = TEMPLATES[key]!
      const kinds = slotsForCount(t, 4, false).map((s) => s.kind)
      expect(kinds).toContain("lower")
      expect(kinds).toContain("upper_push")
      expect(kinds).toContain("upper_pull")
      expect(kinds).toContain("core")
    }
    // Consecutive full-body days alternate squat and hinge primaries.
    expect(TEMPLATES.full_a!.slots[0]!.patterns).toEqual(["squat"])
    expect(TEMPLATES.full_b!.slots[0]!.patterns).toEqual(["hinge"])
    expect(TEMPLATES.full_c!.slots[0]!.patterns).toEqual(["horizontal_push"])
  })

  it("slot counts follow the duration preference", () => {
    expect(mainSlotCount(30, false)).toBe(4)
    expect(mainSlotCount(45, false)).toBe(5)
    expect(mainSlotCount(60, false)).toBe(6)
    expect(mainSlotCount(75, false)).toBe(7)
    expect(mainSlotCount(30, true)).toBe(4)
    expect(mainSlotCount(45, true)).toBe(6)
    expect(mainSlotCount(60, true)).toBe(7)
    expect(mainSlotCount(75, true)).toBe(8)
  })

  it("slotsForCount keeps template order and appends the finisher", () => {
    const t = TEMPLATES.push_a!
    const four = slotsForCount(t, 4, false)
    expect(four.map((s) => s.role)).toEqual(["primary_compound", "secondary_compound", "accessory", "isolation"])
    const six = slotsForCount(t, 6, true)
    expect(six[six.length - 1]).toBe(FINISHER_SLOT)
    expect(six).toHaveLength(6)
    const order = t.slots.filter((s) => six.includes(s))
    expect(six.slice(0, 5)).toEqual(order)
    expect(spareSlots(t, four).every((s) => !four.includes(s))).toBe(true)
  })

  it("conditioning goals reserve the finisher at thirty minutes too (F05)", () => {
    for (const t of Object.values(TEMPLATES)) {
      const slots = slotsForCount(t, mainSlotCount(30, true), true)
      expect(slots).toHaveLength(4)
      expect(slots[slots.length - 1]).toBe(FINISHER_SLOT)
      expect(slots.slice(0, 3).map((s) => s.role).slice(0, 2)).toEqual(["primary_compound", "secondary_compound"])
    }
    // Non-conditioning goals keep all four slots for lifting.
    expect(slotsForCount(TEMPLATES.push_a!, 4, false)).not.toContain(FINISHER_SLOT)
  })

  it("the hypertrophy isolation swap never removes the day's last pull (F09)", () => {
    // The day's only pull is also its lowest-priority accessory: the press accessory makes way instead.
    const base = TEMPLATES.full_a!.slots
    const slot = (key: string) => base.find((s) => s.key === key)!
    const onePull: SplitTemplate = {
      ...TEMPLATES.full_a!,
      key: "one_pull",
      slots: [
        slot("primary"),
        slot("secondary"),
        { key: "acc_press", role: "accessory", patterns: ["vertical_push"], groups: ["shoulders"], mechanics: "compound", priority: 3, kind: "upper_push" },
        { ...slot("core"), priority: 4 },
        { ...slot("accessory"), priority: 5 },
        { ...slot("iso_hams"), priority: 6 },
      ],
    }
    const five = slotsForCount(onePull, 5, false, true)
    expect(five.map((s) => s.key)).toEqual(["primary", "secondary", "core", "accessory", "iso_hams"])
    // With two pulls the second one may still make way for the isolation work.
    const fullA = slotsForCount(TEMPLATES.full_a!, 5, false, true)
    expect(fullA.filter((s) => s.kind === "upper_pull")).toHaveLength(1)
  })

  it("upper/lower templates keep side-delt, rear-delt, chest and leg-curl work at 60 minutes (F23)", () => {
    const at = (key: string, n: number) => slotsForCount(TEMPLATES[key]!, n, false)
    expect(at("upper_a", 5).some((s) => s.patterns.includes("shoulder_abduction"))).toBe(true)
    const upperB = at("upper_b", 6)
    expect(upperB.some((s) => s.key === "iso_chest" && s.groups.includes("chest") && s.mechanics === "isolation")).toBe(true)
    expect(upperB.some((s) => s.key === "iso_rear" && s.patterns.includes("horizontal_pull"))).toBe(true)
    for (const key of ["legs_b", "lower_b"]) {
      expect(at(key, 5).some((s) => s.patterns.includes("knee_flexion"))).toBe(true)
      // Trunk work still stays on a trimmed leg day, ahead of calves.
      expect(at(key, 5).some((s) => s.kind === "core")).toBe(true)
    }
    // A three-slot Upper A (thirty minutes with a finisher) is one press and two pulls.
    const three = at("upper_a", 3)
    expect(three.filter((s) => s.kind === "upper_pull")).toHaveLength(2)
    expect(three.filter((s) => s.kind === "upper_push")).toHaveLength(1)
  })

  it("three days a week is full body unless the goal is hypertrophy past the beginner stage (F23)", () => {
    const splitsOf = (experience: Experience, goal?: Goal) => rotationFor(3, experience, goal).map((t) => t.split)
    for (const experience of ["intermediate", "advanced"] as Experience[]) {
      for (const goal of ["strength", "fat_loss", "general_fitness", "endurance"] as Goal[]) {
        expect(splitsOf(experience, goal)).toEqual(["full_body", "full_body", "full_body"])
      }
      expect(splitsOf(experience, "muscle_gain")).toEqual(["push", "pull", "legs"])
      // Callers that do not pass a goal keep the historical rotation.
      expect(splitsOf(experience)).toEqual(["push", "pull", "legs"])
    }
    expect(splitsOf("beginner", "muscle_gain")).toEqual(["full_body", "full_body", "full_body"])
    // Every main lift more than once a week for a 3-day strength lifter: two of three days press horizontally.
    const pressing = rotationFor(3, "intermediate", "strength").filter((t) => t.slots.slice(0, 3).some((s) => s.patterns.includes("horizontal_push")))
    expect(pressing.length).toBeGreaterThanOrEqual(2)
  })

  it("Upper A pulls vertically in its secondary and horizontally in its accessory (R08)", () => {
    const slots = TEMPLATES.upper_a!.slots
    const secondary = slots.find((s) => s.key === "secondary")!
    expect(secondary.patterns).toEqual(["vertical_pull"])
    expect(slots.find((s) => s.key === "acc_pull")!.patterns).toEqual(["horizontal_pull"])
    // Upper B mirrors it: a row first, a vertical pull as the accessory.
    const upperB = TEMPLATES.upper_b!.slots
    expect(upperB.find((s) => s.key === "primary")!.patterns).toEqual(["horizontal_pull"])
    expect(upperB.find((s) => s.key === "acc_pull")!.patterns).toEqual(["vertical_pull"])
    // Every trimmed Upper A (three slots or more) has a pull in each plane.
    for (const n of [3, 4, 5, 6]) {
      const pulls = slotsForCount(TEMPLATES.upper_a!, n, false).filter((s) => s.kind === "upper_pull")
      expect(pulls.flatMap((s) => s.patterns).sort(), `${n} slots`).toEqual(["horizontal_pull", "vertical_pull"])
    }
  })

  it("endurance alternates full-body lifting with conditioning-led days at four or more days (R17)", () => {
    for (const days of [4, 5, 6] as TrainingDays[]) {
      for (const experience of ["beginner", "intermediate", "advanced"] as Experience[]) {
        const rotation = rotationFor(days, experience, "endurance")
        const label = `${days} days ${experience}`
        expect(rotation, label).toHaveLength(days)
        expect(new Set(rotation.map((t) => t.title)).size, label).toBe(days)
        const conditioning = rotation.filter((t) => t.conditioning)
        expect(conditioning.length, label).toBeGreaterThanOrEqual(1)
        expect(conditioning.every((t) => t.split === "conditioning"), label).toBe(true)
        // The lifting days are full body, and no two conditioning-led days are back to back.
        expect(rotation.filter((t) => !t.conditioning).every((t) => t.split === "full_body"), label).toBe(true)
        rotation.forEach((t, i) => {
          const next = rotation[(i + 1) % rotation.length]!
          expect(!!t.conditioning && !!next.conditioning, `${label}: ${t.title} then ${next.title}`).toBe(false)
        })
      }
    }
    // Two and three days stay full body, and other goals keep their splits.
    expect(rotationFor(3, "intermediate", "endurance").every((t) => !t.conditioning)).toBe(true)
    expect(rotationFor(5, "intermediate", "muscle_gain").map((t) => t.split)).toEqual(["push", "pull", "legs", "upper", "lower"])
    expect(rotationFor(4, "intermediate", "fat_loss").map((t) => t.split)).toEqual(["upper", "lower", "upper", "lower"])
  })

  it("conditioning-led days are a short full-body circuit with no heavy slots (R17)", () => {
    const modes = new Set<string>()
    for (const t of Object.values(CONDITIONING_TEMPLATES)) {
      modes.add(t.conditioning!)
      expect(t.heavyGroups).toEqual([])
      expect(t.slots.every((s) => s.role === "accessory"), t.key).toBe(true)
      expect(t.slots.filter((s) => s.kind === "core"), t.key).toHaveLength(1)
      expect(new Set(t.slots.map((s) => s.priority)).size).toBe(t.slots.length)
      // Lower body, a pull and trunk work: a circuit never presses (pressing stays on the lifting
      // days), so it never needs a balancing pull past the weekly target.
      expect(t.slots.map((s) => s.kind)).toEqual(["lower", "upper_pull", "core"])
      // Thirty minutes: the whole circuit and the conditioning block.
      const thirty = slotsForCount(t, mainSlotCount(30, true, "endurance"), true)
      expect(thirty.map((s) => s.kind)).toEqual(["lower", "upper_pull", "core", "conditioning"])
    }
    // Both a steady-state day and an interval day.
    expect([...modes].sort()).toEqual(["intervals", "steady"])
  })

  it("endurance caps its lifting so the conditioning block has the time (R17)", () => {
    expect([30, 45, 60, 75].map((m) => liftingSlotCap(m, "endurance"))).toEqual([3, 4, 5, 6])
    // The starting slot count includes the finisher: lifts never start above the cap.
    for (const m of [30, 45, 60, 75]) expect(mainSlotCount(m, true, "endurance") - 1).toBe(liftingSlotCap(m, "endurance"))
    // Other goals have no lifting cap of their own and keep their slot counts.
    for (const goal of ["muscle_gain", "strength", "fat_loss", "general_fitness"] as Goal[]) {
      expect(liftingSlotCap(45, goal)).toBe(Number.POSITIVE_INFINITY)
      expect(mainSlotCount(45, goal !== "muscle_gain" && goal !== "strength", goal)).toBe(goal === "muscle_gain" || goal === "strength" ? 5 : 6)
    }
  })

  it("a thirty-minute full-body week with a finisher has trunk work on one day (R17)", () => {
    const days = rotationFor(3, "beginner", "endurance")
    const withCore = days.filter((t) => slotsForCount(t, mainSlotCount(30, true, "endurance"), true).some((s) => s.kind === "core"))
    expect(withCore.map((t) => t.key)).toEqual(["full_b"])
    // Full body B trades its press for the trunk at three lifts, so it has nothing to balance.
    const fullB = slotsForCount(TEMPLATES.full_b!, 4, true).map((s) => s.kind)
    expect(fullB).toEqual(["lower", "upper_pull", "core", "conditioning"])
  })

  it("templateForHistory matches by title then split", () => {
    const rotation = rotationFor(6, "advanced")
    expect(templateForHistory(rotation, "push", "Push B")?.key).toBe("push_b")
    expect(templateForHistory(rotation, "push", "Chest day")?.key).toBe("push_a")
    expect(templateForHistory(rotation, "upper", "Upper A")).toBeUndefined()
  })
})

describe("designated core days (core spec C01)", () => {
  const LEVELS: Experience[] = ["beginner", "intermediate", "advanced"]
  const GOALS: (Goal | undefined)[] = ["muscle_gain", "strength", "fat_loss", "general_fitness", "endurance", undefined]
  /** Expected designated days by rotation (the template keys in rotation order). */
  const EXPECTED: Record<string, string[]> = {
    "full_a,full_b": ["full_a", "full_b"],
    "full_a,full_b,full_c": ["full_a", "full_b"],
    "push_a,pull_a,legs_a": ["pull_a", "legs_a"],
    "upper_a,lower_a,upper_b,lower_b": ["lower_a", "lower_b"],
    "push_a,pull_a,legs_a,upper_b,lower_b": ["pull_a", "legs_a", "lower_b"],
    "push_a,pull_a,legs_a,push_b,pull_b,legs_b": ["pull_a", "push_b", "legs_b"],
    "full_a,conditioning_a,full_b,conditioning_b": ["conditioning_a", "conditioning_b"],
    "full_a,conditioning_a,full_b,conditioning_b,full_c": ["full_a", "conditioning_a", "conditioning_b"],
    "full_a,conditioning_a,full_b,conditioning_b,full_c,conditioning_c": ["conditioning_a", "conditioning_b", "conditioning_c"],
  }

  it("coreDays picks the expected days for every rotation", () => {
    const seen = new Set<string>()
    for (const days of [2, 3, 4, 5, 6] as TrainingDays[]) {
      for (const experience of LEVELS) {
        for (const goal of GOALS) {
          const rotation = rotationFor(days, experience, goal)
          const key = rotation.map((t) => t.key).join(",")
          const expected = EXPECTED[key]
          expect(expected, `no expectation for ${key}`).toBeDefined()
          expect([...coreDays(rotation, days)].sort(), `${days}d ${experience} ${goal}: ${key}`).toEqual([...expected!].sort())
          expect(coreDays(rotation, days).size).toBe(CORE_DAYS_TARGET[days])
          seen.add(key)
        }
      }
    }
    // Every rotation the plans can produce was checked.
    expect(seen.size).toBe(Object.keys(EXPECTED).length)
  })

  it("the target and the ceiling: 2/2/2/3/3 designated days and at most 2/3/3/4/4 core days", () => {
    expect(CORE_DAYS_TARGET).toEqual({ 2: 2, 3: 2, 4: 2, 5: 3, 6: 3 })
    expect(MAX_CORE_DAYS).toEqual({ 2: 2, 3: 3, 4: 3, 5: 4, 6: 4 })
    for (const days of [2, 3, 4, 5, 6] as TrainingDays[]) expect(MAX_CORE_DAYS[days]).toBeGreaterThanOrEqual(CORE_DAYS_TARGET[days])
  })

  it("core slots take carries at match level 0 (C06)", () => {
    for (const t of [...Object.values(TEMPLATES), ...Object.values(CONDITIONING_TEMPLATES)]) {
      expect(t.slots.find((s) => s.kind === "core")!.patterns, t.key).toContain("carry")
    }
  })
})
