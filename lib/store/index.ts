/**
 * Client state. Import hooks from "@/lib/store"; UI code depends only on the contracts in ./types.
 * All stores are client-only and expose `hydrated`; render a skeleton until it is true.
 */
export * from "./types"
export { useProfileStore } from "./profile-store"
export { useHistoryStore } from "./history-store"
export { useWorkoutStore } from "./workout-store"
export { useSyncStore } from "@/lib/sync/sync-store"
