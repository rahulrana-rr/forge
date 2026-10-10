/**
 * Profile store: the user's training profile, persisted to localStorage ("forge:profile").
 */
import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { ProfileState } from "./types"
import { EQUIPMENT_PRESETS, type UserProfile } from "@/lib/domain/types"
import {
  createLocalStorage,
  onLocalStorageKeyChange,
} from "@/lib/persistence/local-storage"
import { newId } from "@/lib/ids"
import { onRehydrate, type Hydratable } from "./hydration"

export const PROFILE_STORAGE_KEY = "forge:profile"
export const PROFILE_SCHEMA_VERSION = 1

export type ProfileStore = ProfileState & Hydratable

/** Shape written to storage. Bump PROFILE_SCHEMA_VERSION and extend `migrateProfile` on change. */
export interface PersistedProfile {
  profile: UserProfile | null
}

/**
 * Migrates older persisted shapes to the current one. Version 1 is the first shipped shape, so
 * anything unknown is treated as "no profile" rather than guessed at.
 */
export function migrateProfile(
  persisted: unknown,
  version: number
): PersistedProfile {
  if (version === PROFILE_SCHEMA_VERSION && isPersistedProfile(persisted))
    return persisted
  // Future: `if (version === 1) { ...upgrade to 2 }`
  return { profile: null }
}

function isPersistedProfile(value: unknown): value is PersistedProfile {
  return typeof value === "object" && value !== null && "profile" in value
}

/**
 * Everyone can train with their own body, whatever kit they list. Almost every warm-up drill and
 * cool-down stretch needs only "bodyweight", so a custom list without it (people tap the kit they
 * own, not their body) would silently drop the whole warm-up and cool-down.
 */
export function withBodyweight(
  equipment: UserProfile["equipment"]
): UserProfile["equipment"] {
  return equipment.includes("bodyweight")
    ? [...equipment]
    : [...equipment, "bodyweight"]
}

export function resolveEquipment(
  input: Pick<UserProfile, "equipmentPreset" | "equipment">
): UserProfile["equipment"] {
  if (input.equipmentPreset === "custom") return withBodyweight(input.equipment)
  return [...EQUIPMENT_PRESETS[input.equipmentPreset]]
}

/**
 * Repairs a profile from storage or the server (e.g. a custom equipment list without bodyweight).
 * A preset's equipment is re-derived from the preset, so a profile saved before a preset gained an
 * item (the squat rack) gets it.
 */
export function normalizeProfile(profile: UserProfile): UserProfile {
  if (!Array.isArray(profile.equipment)) return profile
  if (profile.equipmentPreset !== "custom" && profile.equipmentPreset in EQUIPMENT_PRESETS) {
    const preset = EQUIPMENT_PRESETS[profile.equipmentPreset]
    const same = preset.length === profile.equipment.length && preset.every((e) => profile.equipment.includes(e))
    return same ? profile : { ...profile, equipment: [...preset] }
  }
  if (profile.equipment.includes("bodyweight")) return profile
  return { ...profile, equipment: withBodyweight(profile.equipment) }
}

export const useProfileStore = create<ProfileStore>()(
  persist(
    (set, get) => ({
      hydrated: false,
      profile: null,
      setHydrated: (hydrated) => {
        if (get().hydrated !== hydrated) set({ hydrated })
      },

      createProfile(input) {
        const now = new Date().toISOString()
        const profile: UserProfile = {
          ...input,
          equipment: resolveEquipment(input),
          id: newId(),
          createdAt: now,
          updatedAt: now,
        }
        set({ profile })
        return profile
      },

      updateProfile(patch) {
        const current = get().profile
        if (!current) return
        const next: UserProfile = {
          ...current,
          ...patch,
          updatedAt: new Date().toISOString(),
        }
        // Switching to a named preset without an explicit equipment list re-derives it.
        if (
          patch.equipmentPreset &&
          patch.equipmentPreset !== "custom" &&
          patch.equipment === undefined
        ) {
          next.equipment = resolveEquipment({
            equipmentPreset: patch.equipmentPreset,
            equipment: [],
          })
        }
        set({ profile: normalizeProfile(next) })
      },

      replaceProfile(profile) {
        set({ profile: normalizeProfile(profile) })
      },

      clearProfile() {
        set({ profile: null })
      },
    }),
    {
      name: PROFILE_STORAGE_KEY,
      version: PROFILE_SCHEMA_VERSION,
      storage: createLocalStorage<PersistedProfile>(),
      partialize: (state): PersistedProfile => ({ profile: state.profile }),
      migrate: migrateProfile,
      merge: (persisted, current) => {
        if (!isPersistedProfile(persisted)) return current
        return {
          ...current,
          profile: persisted.profile
            ? normalizeProfile(persisted.profile)
            : null,
        }
      },
      skipHydration: false,
      onRehydrateStorage: onRehydrate<ProfileStore>(),
    }
  )
)

// Another tab or app window changed the profile: re-read it before this tab writes a stale copy.
onLocalStorageKeyChange(PROFILE_STORAGE_KEY, () => {
  void useProfileStore.persist.rehydrate()
})
