import { beforeEach, describe, expect, it, vi } from "vitest"

import type { UserProfile as UserProfileRow } from "@/lib/generated/prisma/client"

/* In-memory stand-in for the prisma.userProfile calls profile.ts makes. */
const rows = new Map<string, UserProfileRow>()

type Where = { userId: string; updatedAt?: Date | { lte: Date } }

function matches(row: UserProfileRow, where: Where): boolean {
  if (row.userId !== where.userId) return false
  const { updatedAt } = where
  if (updatedAt instanceof Date)
    return row.updatedAt.getTime() === updatedAt.getTime()
  if (updatedAt) return row.updatedAt.getTime() <= updatedAt.lte.getTime()
  return true
}

const userProfile = {
  findUnique: ({ where }: { where: { userId: string } }) =>
    Promise.resolve(rows.get(where.userId) ?? null),
  findUniqueOrThrow: ({ where }: { where: { userId: string } }) => {
    const row = rows.get(where.userId)
    return row ? Promise.resolve(row) : Promise.reject(new Error("not found"))
  },
  updateMany: ({
    where,
    data,
  }: {
    where: Where
    data: Partial<UserProfileRow>
  }) => {
    const row = rows.get(where.userId)
    if (!row || !matches(row, where)) return Promise.resolve({ count: 0 })
    rows.set(where.userId, { ...row, ...data })
    return Promise.resolve({ count: 1 })
  },
  create: ({ data }: { data: Omit<UserProfileRow, "createdAt"> }) => {
    const row = { createdAt: new Date(), ...data } as UserProfileRow
    rows.set(row.userId, row)
    return Promise.resolve(row)
  },
}

vi.mock("@/lib/prisma", () => ({ prisma: { userProfile } }))

const { clampUpdatedAt, unionInOrder, upsertProfile } =
  await import("./profile")
type PutMeInput = Parameters<typeof upsertProfile>[1]

/* ------------------------------------------------------------------ */

const NOW = new Date("2026-10-07T12:00:00.000Z")

/** The account's tuned profile, as another device left it on the server. */
function accountRow(): UserProfileRow {
  return {
    userId: "u1",
    goal: "strength",
    gender: "male",
    weightKg: 90,
    experience: "advanced",
    trainingDaysPerWeek: 5,
    equipmentPreset: "full_gym",
    equipment: ["barbell", "dumbbell"],
    durationPreferenceMinutes: 75,
    units: "kg",
    limitations: ["knee", "lower_back"],
    excludedExerciseIds: ["barbell-back-squat", "conventional-deadlift"],
    preferredExerciseIds: ["leg-press"],
    displayName: "Sam",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T08:00:00.000Z"),
  }
}

/** A fresh onboarding profile from a new device: defaults, newer than the account's. */
function onboardingInput(overrides: Partial<PutMeInput> = {}): PutMeInput {
  return {
    goal: "general_fitness",
    gender: "unspecified",
    weightKg: 70,
    experience: "beginner",
    trainingDaysPerWeek: 3,
    equipmentPreset: "dumbbells",
    equipment: ["dumbbell", "bodyweight", "bench"],
    durationPreferenceMinutes: 45,
    units: "kg",
    limitations: [],
    excludedExerciseIds: [],
    preferredExerciseIds: [],
    updatedAt: "2026-10-07T11:55:00.000Z",
    ...overrides,
  }
}

beforeEach(() => {
  rows.clear()
})

describe("clampUpdatedAt / unionInOrder", () => {
  it("never lets a client timestamp run ahead of server time", () => {
    expect(clampUpdatedAt("9999-12-31T23:59:59.999Z", NOW)).toEqual(NOW)
    expect(clampUpdatedAt("2026-10-07T11:00:00.000Z", NOW)).toEqual(
      new Date("2026-10-07T11:00:00.000Z")
    )
    expect(clampUpdatedAt(undefined, NOW)).toEqual(NOW)
  })

  it("appends only missing members, keeping order", () => {
    expect(unionInOrder(["a", "b"], ["b", "c", "a", "d"])).toEqual([
      "a",
      "b",
      "c",
      "d",
    ])
  })
})

describe("upsertProfile on a device's first sync (keepExisting)", () => {
  it("keeps the account profile instead of the newer onboarding default", async () => {
    rows.set("u1", accountRow())
    const result = await upsertProfile("u1", onboardingInput(), {
      keepExisting: true,
      now: NOW,
    })

    expect(result.goal).toBe("strength")
    expect(result.experience).toBe("advanced")
    expect(result.limitations).toEqual(["knee", "lower_back"])
    expect(result.excludedExerciseIds).toEqual([
      "barbell-back-squat",
      "conventional-deadlift",
    ])
    expect(result.preferredExerciseIds).toEqual(["leg-press"])
    // Re-stamped to server time, so the device's `server.updatedAt > local.updatedAt` check adopts it.
    expect(result.updatedAt).toBe(NOW.toISOString())
    expect(result.updatedAt > onboardingInput().updatedAt!).toBe(true)
  })

  it("adds limitations and exclusions entered on the new device", async () => {
    rows.set("u1", accountRow())
    const result = await upsertProfile(
      "u1",
      onboardingInput({
        limitations: ["shoulder", "knee"],
        excludedExerciseIds: ["burpee"],
      }),
      { keepExisting: true, now: NOW }
    )
    expect(result.limitations).toEqual(["knee", "lower_back", "shoulder"])
    expect(result.excludedExerciseIds).toEqual([
      "barbell-back-squat",
      "conventional-deadlift",
      "burpee",
    ])
    expect(result.goal).toBe("strength")
  })

  it("stores the device's profile when the account has none yet", async () => {
    const result = await upsertProfile("u1", onboardingInput(), {
      keepExisting: true,
      now: NOW,
    })
    expect(result.goal).toBe("general_fitness")
    expect(result.updatedAt).toBe(onboardingInput().updatedAt)
  })
})

describe("upsertProfile last-write-wins", () => {
  it("lets a newer edit from a synced device win", async () => {
    rows.set("u1", accountRow())
    const result = await upsertProfile(
      "u1",
      onboardingInput({ goal: "endurance" }),
      { now: NOW }
    )
    expect(result.goal).toBe("endurance")
  })

  it("keeps the server copy when the push is older", async () => {
    rows.set("u1", accountRow())
    const result = await upsertProfile(
      "u1",
      onboardingInput({ updatedAt: "2026-09-01T00:00:00.000Z" }),
      { now: NOW }
    )
    expect(result.goal).toBe("strength")
  })

  it("clamps a future-dated push so later correctly-clocked edits still win", async () => {
    rows.set("u1", accountRow())
    const ahead = await upsertProfile(
      "u1",
      onboardingInput({
        goal: "fat_loss",
        updatedAt: "2099-01-01T00:00:00.000Z",
      }),
      { now: NOW }
    )
    expect(ahead.updatedAt).toBe(NOW.toISOString())

    const later = new Date(NOW.getTime() + 60_000)
    const edit = await upsertProfile(
      "u1",
      onboardingInput({ goal: "endurance", updatedAt: later.toISOString() }),
      { now: later }
    )
    expect(edit.goal).toBe("endurance")
  })
})
