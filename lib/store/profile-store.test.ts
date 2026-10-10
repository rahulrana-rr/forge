import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CompletedWorkout, UserProfile } from "@/lib/domain/types"
import {
  normalizeProfile,
  resolveEquipment,
  useProfileStore,
} from "./profile-store"
import { useHistoryStore } from "./history-store"

const base: Omit<UserProfile, "id" | "createdAt" | "updatedAt"> = {
  goal: "strength",
  gender: "unspecified",
  weightKg: 80,
  experience: "intermediate",
  trainingDaysPerWeek: 4,
  equipmentPreset: "custom",
  equipment: ["barbell", "bench"],
  durationPreferenceMinutes: 60,
  units: "kg",
  limitations: [],
  excludedExerciseIds: [],
  preferredExerciseIds: [],
}

beforeEach(() => {
  useProfileStore.setState({ profile: null })
  useHistoryStore.setState({ workouts: [], progress: {} })
})

describe("equipment always includes bodyweight", () => {
  it("adds bodyweight to a custom list and leaves presets as they are", () => {
    expect(resolveEquipment(base)).toEqual(["barbell", "bench", "bodyweight"])
    expect(
      resolveEquipment({ ...base, equipment: ["bodyweight", "dumbbell"] })
    ).toEqual(["bodyweight", "dumbbell"])
    expect(
      resolveEquipment({ equipmentPreset: "dumbbells", equipment: [] })
    ).toEqual(["dumbbell", "bodyweight", "bench"])
  })

  it("createProfile, updateProfile and replaceProfile keep bodyweight", () => {
    const created = useProfileStore.getState().createProfile(base)
    expect(created.equipment).toContain("bodyweight")

    useProfileStore.getState().updateProfile({
      equipmentPreset: "custom",
      equipment: ["machine", "cable"],
    })
    expect(useProfileStore.getState().profile?.equipment).toEqual([
      "machine",
      "cable",
      "bodyweight",
    ])

    useProfileStore.getState().replaceProfile({
      ...created,
      id: "server",
      equipment: ["dumbbell"],
    })
    expect(useProfileStore.getState().profile?.equipment).toEqual([
      "dumbbell",
      "bodyweight",
    ])
  })

  it("repairs a stored profile on load", () => {
    const stored: UserProfile = {
      ...base,
      id: "p",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    }
    const merge = useProfileStore.persist.getOptions().merge!
    const merged = merge({ profile: stored }, useProfileStore.getState())
    expect(merged.profile?.equipment).toEqual([
      "barbell",
      "bench",
      "bodyweight",
    ])
    expect(merged.profile?.updatedAt).toBe(stored.updatedAt)
    expect(merge(undefined, useProfileStore.getState()).profile).toBeNull()
    expect(normalizeProfile(merged.profile!)).toBe(merged.profile)
  })
})

describe("streak follows the training plan", () => {
  function session(id: string, date: string): CompletedWorkout {
    return {
      id,
      date,
      title: "Full body A",
      split: "full_body",
      focus: ["full_body"],
      goal: "strength",
      startedAt: `${date}T09:00:00.000Z`,
      completedAt: `${date}T10:00:00.000Z`,
      durationSeconds: 3600,
      exercises: [],
      totals: {
        exercisesCompleted: 1,
        exercisesSkipped: 0,
        sets: 1,
        reps: 5,
        volumeKg: 100,
        caloriesEstimate: null,
      },
      personalRecords: [],
      engineVersion: 1,
      synced: false,
    }
  }

  it("keeps a 3-day lifter's streak on Monday morning after Friday", () => {
    useProfileStore
      .getState()
      .createProfile({ ...base, trainingDaysPerWeek: 3 })
    useHistoryStore.setState({
      workouts: [
        session("f", "2026-10-02"),
        session("w", "2026-09-30"),
        session("m", "2026-09-28"),
      ],
    })
    // Monday 2026-10-05, local noon: three days after Friday's session.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 9, 5, 12, 0))
      expect(useHistoryStore.getState().streak().current).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
