/**
 * Favourite exercises (profile.preferredExerciseIds). Imports the profile store module directly
 * (not the "@/lib/store" barrel) so /exercise/[slug] does not pull in the workout store and engine.
 */
import { useProfileStore } from "@/lib/store/profile-store"

export function useIsFavourite(exerciseId: string | null | undefined): boolean {
  return useProfileStore((s) =>
    exerciseId
      ? (s.profile?.preferredExerciseIds.includes(exerciseId) ?? false)
      : false
  )
}

/**
 * Adds or removes a favourite and returns whether it is now a favourite (null without a profile).
 * A favourite is never also excluded, so adding one clears it from the excluded list.
 */
export function toggleFavourite(exerciseId: string): boolean | null {
  const store = useProfileStore.getState()
  const profile = store.profile
  if (!profile) return null
  const favourite = profile.preferredExerciseIds.includes(exerciseId)
  if (favourite) {
    store.updateProfile({
      preferredExerciseIds: profile.preferredExerciseIds.filter(
        (id) => id !== exerciseId
      ),
    })
    return false
  }
  store.updateProfile({
    preferredExerciseIds: [...profile.preferredExerciseIds, exerciseId],
    excludedExerciseIds: profile.excludedExerciseIds.filter(
      (id) => id !== exerciseId
    ),
  })
  return true
}
