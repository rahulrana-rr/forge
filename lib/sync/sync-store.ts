/**
 * Sync store: pushes unsynced workouts and the profile, pulls remote changes.
 * Swipes never wait on this; it runs in the background and coalesces concurrent flushes.
 * Persisted (localStorage "forge:sync"): the pull cursor `lastSyncedAt`, the wall-clock time of
 * the last completed sync (`lastCompletedAt`, for display), the account the local data belongs to
 * (`ownerUserId`), the local profile last reconciled with it (`linkedProfileId`) and workout
 * deletes not yet sent to the server (`pendingDeletes`).
 *
 * Account scoping: local history and profile are not tagged per user, so the device as a whole
 * belongs to one account at a time. The first sync with an account takes ownership (guest data is
 * adopted, as intended) with a full pull, and the account's own profile wins over a local one
 * that was never reconciled with it. If a different account signs in while local workouts from
 * the previous one remain, nothing is pushed or pulled until the user resolves it.
 */
import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { SyncState } from "@/lib/store/types"
import type { PutMeRequest, SyncRejection, SyncResponse } from "./types"
import type { CompletedWorkout, UserProfile } from "@/lib/domain/types"
import { api, isApiClientError } from "./client"
import { onWorkoutRemoved, useHistoryStore } from "@/lib/store/history-store"
import { useProfileStore } from "@/lib/store/profile-store"
import { whenHydrated } from "@/lib/store/hydration"
import {
  createLocalStorage,
  onLocalStorageKeyChange,
} from "@/lib/persistence/local-storage"

export const SYNC_STORAGE_KEY = "forge:sync"
export const SYNC_BATCH_SIZE = 25
export const SYNC_MAX_ATTEMPTS = 3
export const SYNC_BACKOFF_BASE_MS = 500
/** Most deletes sent per request (the server accepts up to 500). */
export const SYNC_DELETE_BATCH_SIZE = 200
/** Safety bound on request rounds per flush (pushes plus pull pages). */
export const SYNC_MAX_ROUNDS = 200

export const FOREIGN_DATA_MESSAGE =
  "This device has workouts from another account, so syncing is paused. Sign in to that account to sync them, or reset local data in Profile to use this account here."

export interface SyncStore extends SyncState {
  signedIn: boolean
  /** The signed-in user's id when the caller passed it to setSignedIn; null otherwise. */
  userId: string | null
  /** Account the local data belongs to; set by the first sync with an account. */
  ownerUserId: string | null
  /** Id of the local profile last reconciled with the owner account's server profile. */
  linkedProfileId: string | null
  /**
   * Wall-clock time (this device) of the last sync that completed without error. Use this for
   * "Synced X ago": `lastSyncedAt` is the server's pull cursor, which trails server time and can
   * be far in the past while a large pull is still paging.
   */
  lastCompletedAt: string | null
  /** Ids of synced workouts deleted on this device that the server has not acknowledged yet. */
  pendingDeletes: string[]
  /**
   * Forgets the pull cursor so the next sync pulls the account's whole history, and gives
   * workouts rejected earlier in this session another try.
   */
  resetCursor(): void
  /**
   * Treat this device's local data as the signed-in account's although it was last synced with a
   * different one: its unsynced workouts are pushed to this account. For an explicit user choice.
   */
  adoptLocalData(): Promise<void>
}

interface PersistedSync {
  lastSyncedAt: string | null
  lastCompletedAt: string | null
  ownerUserId: string | null
  linkedProfileId: string | null
  pendingDeletes: string[]
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false
}

function toPutMe(profile: UserProfile): PutMeRequest {
  const body: Partial<UserProfile> = { ...profile }
  delete body.id
  delete body.createdAt
  return body as PutMeRequest
}

function countPending(): number {
  return useHistoryStore.getState().workouts.filter((w) => !w.synced).length
}

/** Unsynced workouts that are still worth pushing (rejected ones are left out). */
function pushable(): CompletedWorkout[] {
  return useHistoryStore
    .getState()
    .workouts.filter((w) => !w.synced && !rejectedIds.has(w.id))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return "Sync failed"
}

function union(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])]
}

/** True when the 413 came from the request body being too large for the server. */
function isTooLarge(error: unknown): boolean {
  return isApiClientError(error) && error.status === 413
}

let inFlight: Promise<void> | null = null
/** A flush was asked for while one was running; it may have work the running one missed. */
let rerunRequested = false

/**
 * Workouts the server rejected (validation error or an id owned by another account).
 * They stay on this device and are left out of later pushes in this session so a poison
 * workout cannot make every flush re-send it; the next app load retries once.
 */
const rejectedIds = new Set<string>()

function rejectionMessage(rejected: SyncRejection[]): string {
  const n = rejected.length
  const reason = rejected[0]?.message
  const head = `${n} workout${n === 1 ? "" : "s"} could not be synced and will stay on this device`
  return reason ? `${head}: ${reason}` : `${head}.`
}

export const useSyncStore = create<SyncStore>()(
  persist(
    (set, get) => {
      /** The local profile was reconciled with this account, so its edits are the account's. */
      function isLinked(profile: UserProfile | null): boolean {
        return profile != null && profile.id === get().linkedProfileId
      }

      /**
       * Starts this device over for `userId`: a full pull, and the account's own profile wins over
       * whatever profile is local (its timestamp says nothing about the account's copy).
       */
      function takeOwnership(userId: string): void {
        rejectedIds.clear()
        set({
          ownerUserId: userId,
          lastSyncedAt: null,
          lastCompletedAt: null,
          linkedProfileId: null,
          // Deletes queued for the previous account are not this account's to apply.
          pendingDeletes: [],
        })
      }

      /**
       * Returns false when the local data belongs to another account than the signed-in one and
       * there are local workouts to protect: pushing would put them in the wrong account and
       * pulling would mix two accounts' history on this device.
       */
      function claimDevice(): boolean {
        const { userId, ownerUserId } = get()
        if (!userId || ownerUserId === userId) return true
        const hasLocalWorkouts = useHistoryStore.getState().workouts.length > 0
        if (ownerUserId != null && hasLocalWorkouts) return false
        // First sync with an account here (guest data is adopted), or the previous account left
        // nothing behind (e.g. after Reset local data).
        takeOwnership(userId)
        return true
      }

      /**
       * Applies the account's profile from a sync response.
       *
       * - No local profile, or one never reconciled with this account (onboarding on a new device,
       *   a guest profile before signing in): the account's copy wins, but the local limitations
       *   and excluded exercises are kept in it, so a contraindication entered during onboarding
       *   is never dropped. When that adds anything the result is re-stamped so it is pushed next.
       * - A linked profile this flush just pushed and has not edited since: the server's answer is
       *   authoritative (it clamps timestamps to its own clock, so a device whose clock runs ahead
       *   cannot keep re-pushing stale content that wins every time).
       * - Otherwise newest updatedAt wins.
       */
      function reconcileProfile(
        server: UserProfile | null,
        sent: UserProfile | null
      ): void {
        if (!server) return
        const profiles = useProfileStore.getState()
        const local = profiles.profile
        if (!local || !isLinked(local)) {
          const limitations = local
            ? union(server.limitations, local.limitations)
            : server.limitations
          const excludedExerciseIds = local
            ? union(server.excludedExerciseIds, local.excludedExerciseIds)
            : server.excludedExerciseIds
          const added =
            limitations.length !== server.limitations.length ||
            excludedExerciseIds.length !== server.excludedExerciseIds.length
          profiles.replaceProfile(
            added
              ? {
                  ...server,
                  limitations: limitations as UserProfile["limitations"],
                  excludedExerciseIds,
                  updatedAt: new Date().toISOString(),
                }
              : server
          )
        } else if (sent && local.updatedAt === sent.updatedAt) {
          if (JSON.stringify(server) !== JSON.stringify(local))
            profiles.replaceProfile(server)
        } else if (server.updatedAt > local.updatedAt) {
          profiles.replaceProfile(server)
        }
        set({ linkedProfileId: useProfileStore.getState().profile?.id ?? null })
      }

      /** Applies one sync round-trip's response to the local stores. */
      function applyResponse(
        res: SyncResponse,
        sentProfile: UserProfile | null,
        sentDeletes: readonly string[]
      ): void {
        const history = useHistoryStore.getState()
        // The server has these deletes now; anything still queued was deleted during the request.
        if (sentDeletes.length > 0) {
          const sent = new Set(sentDeletes)
          set({
            pendingDeletes: get().pendingDeletes.filter((id) => !sent.has(id)),
          })
        }
        history.markSynced(res.acceptedIds)
        // A workout deleted here while the request was in flight must not be merged back.
        const pending = new Set(get().pendingDeletes)
        history.mergeRemote(res.workouts.filter((w) => !pending.has(w.id)))
        history.dropRemote(res.deletedIds ?? [])
        reconcileProfile(res.profile, sentProfile)
      }

      async function runOnce(): Promise<SyncRejection[]> {
        let since = get().lastSyncedAt ?? undefined
        // The profile is pushed at most once per flush: in the first round when it is this
        // account's, or (an unlinked local profile) only once the server has shown it has none.
        let profileDone = false
        let serverHasProfile = true
        let batchSize = SYNC_BATCH_SIZE
        const rejected: SyncRejection[] = []
        // Push in batches until nothing unsynced remains and the pull has no more pages; each
        // round also pulls the next page of remote changes.
        for (let round = 0; round < SYNC_MAX_ROUNDS; round++) {
          const batch = pushable().slice(0, batchSize)
          const local = useProfileStore.getState().profile
          const sendProfile =
            !profileDone &&
            local != null &&
            (isLinked(local) || !serverHasProfile)
          const deletes = get().pendingDeletes.slice(0, SYNC_DELETE_BATCH_SIZE)
          let res: SyncResponse
          try {
            res = await api.syncWorkouts({
              workouts: batch,
              since,
              profile: sendProfile && local ? toPutMe(local) : undefined,
              deletedIds: deletes.length > 0 ? deletes : undefined,
            })
          } catch (error) {
            // Body over the server's cap: retry with half the batch. A single workout that is
            // still too large is set aside like any other rejected workout.
            if (isTooLarge(error) && batch.length > 1) {
              batchSize = Math.max(1, Math.floor(batch.length / 2))
              continue
            }
            if (isTooLarge(error) && batch.length === 1) {
              const id = batch[0]!.id
              rejectedIds.add(id)
              rejected.push({
                id,
                code: "payload_too_large",
                message: "This workout is too large to sync.",
              })
              continue
            }
            throw error
          }
          serverHasProfile = res.profile != null
          if (sendProfile || serverHasProfile || local == null)
            profileDone = true
          applyResponse(res, sendProfile ? local : null, deletes)
          since = res.serverTime
          set({ lastSyncedAt: res.serverTime })
          for (const r of res.rejected ?? []) {
            rejected.push(r)
            if (r.id) rejectedIds.add(r.id)
          }
          // The pull was truncated: keep paging (even with nothing left to push) before stopping.
          if (res.hasMore) continue
          if (!profileDone && useProfileStore.getState().profile != null)
            continue
          if (get().pendingDeletes.length > 0 && deletes.length > 0) continue
          const accepted = new Set(res.acceptedIds)
          const progressed = batch.some(
            (w) => accepted.has(w.id) || rejectedIds.has(w.id)
          )
          if (batch.length === 0 || !progressed || pushable().length === 0)
            break
        }
        return rejected
      }

      async function run(): Promise<void> {
        if (!get().signedIn) {
          set({ status: "signed_out", pendingCount: countPending() })
          return
        }
        if (!isOnline()) {
          set({ status: "offline", pendingCount: countPending() })
          return
        }
        set({ status: "syncing", lastError: null })
        // History loads from IndexedDB asynchronously. Pushing before it has loaded pushes
        // nothing, and merging a pull into the empty list lets the late read discard the pull
        // while the cursor has already moved past it.
        await Promise.all([
          whenHydrated(useHistoryStore),
          whenHydrated(useProfileStore),
        ])
        if (!get().signedIn) {
          set({ status: "signed_out", pendingCount: countPending() })
          return
        }
        if (!claimDevice()) {
          set({
            status: "error",
            lastError: FOREIGN_DATA_MESSAGE,
            pendingCount: countPending(),
          })
          return
        }
        for (let attempt = 0; attempt < SYNC_MAX_ATTEMPTS; attempt++) {
          try {
            const rejected = await runOnce()
            if (rejected.length > 0) {
              set({
                status: "error",
                lastError: rejectionMessage(rejected),
                pendingCount: countPending(),
              })
              return
            }
            set({
              status: "idle",
              lastError: null,
              lastCompletedAt: new Date().toISOString(),
              pendingCount: countPending(),
            })
            return
          } catch (error) {
            if (isApiClientError(error) && error.isUnauthorized) {
              set({
                status: "signed_out",
                signedIn: false,
                userId: null,
                lastError: error.message,
                pendingCount: countPending(),
              })
              return
            }
            if (!isOnline()) {
              set({
                status: "offline",
                lastError: null,
                pendingCount: countPending(),
              })
              return
            }
            const last = attempt === SYNC_MAX_ATTEMPTS - 1
            const retryable = !isApiClientError(error) || error.isRetryable
            if (last || !retryable) {
              set({
                status: "error",
                lastError: errorMessage(error),
                pendingCount: countPending(),
              })
              return
            }
            await sleep(SYNC_BACKOFF_BASE_MS * 2 ** attempt)
          }
        }
      }

      return {
        status: "signed_out",
        pendingCount: 0,
        lastSyncedAt: null,
        lastError: null,
        signedIn: false,
        userId: null,
        ownerUserId: null,
        linkedProfileId: null,
        lastCompletedAt: null,
        pendingDeletes: [],

        flush() {
          if (inFlight) {
            // The running flush built its batch before this call; anything saved since (a workout
            // finished mid-request) would wait for the next trigger. Run again when it settles.
            rerunRequested = true
            return inFlight
          }
          inFlight = (async () => {
            try {
              do {
                rerunRequested = false
                await run()
              } while (
                rerunRequested &&
                get().status === "idle" &&
                pushable().length > 0
              )
            } finally {
              rerunRequested = false
              inFlight = null
            }
          })()
          return inFlight
        },

        setSignedIn(signedIn, userId) {
          const nextUserId = signedIn
            ? userId === undefined
              ? get().userId
              : userId
            : null
          if (get().signedIn === signedIn && get().userId === nextUserId) return
          set({
            signedIn,
            userId: nextUserId,
            status: signedIn ? (isOnline() ? "idle" : "offline") : "signed_out",
            lastError: null,
            pendingCount: countPending(),
          })
        },

        resetCursor() {
          rejectedIds.clear()
          set({ lastSyncedAt: null })
        },

        adoptLocalData() {
          const userId = get().userId
          if (!get().signedIn || !userId) return Promise.resolve()
          takeOwnership(userId)
          // A run already in flight stopped at the ownership check; start a fresh one after it.
          return (inFlight ?? Promise.resolve()).then(() => get().flush())
        },
      }
    },
    {
      name: SYNC_STORAGE_KEY,
      version: 1,
      storage: createLocalStorage<PersistedSync>(),
      partialize: (state): PersistedSync => ({
        lastSyncedAt: state.lastSyncedAt,
        lastCompletedAt: state.lastCompletedAt,
        ownerUserId: state.ownerUserId,
        linkedProfileId: state.linkedProfileId,
        pendingDeletes: state.pendingDeletes,
      }),
      skipHydration: false,
    }
  )
)

useHistoryStore.subscribe((state, previous) => {
  if (state.workouts === previous.workouts) return
  // Local history was wiped (Reset local data, or another tab did it): the cursor no longer
  // describes what this device holds, so the next sync pulls the account's history again. (Deleting
  // the only remaining workout also lands here; a synced one then comes back from the account.)
  if (
    state.hydrated &&
    previous.workouts.length > 0 &&
    state.workouts.length === 0 &&
    useSyncStore.getState().lastSyncedAt != null
  )
    useSyncStore.setState({ lastSyncedAt: null })
  // Keep pendingCount live as history changes (client-only side effect, harmless on the server).
  const pendingCount = state.workouts.filter((w) => !w.synced).length
  if (pendingCount !== useSyncStore.getState().pendingCount)
    useSyncStore.setState({ pendingCount })
})

/**
 * True when a flush has something to send: unsynced workouts the server has not rejected in this
 * session, or queued deletes. Rejected workouts alone do not count, so a stuck workout cannot make
 * every history change trigger another request.
 */
export function hasPendingWork(): boolean {
  return (
    pushable().length > 0 || useSyncStore.getState().pendingDeletes.length > 0
  )
}

// A synced workout deleted on this device: queue the delete so the server and the account's other
// devices drop it too. Unsynced workouts never reached the server, so there is nothing to send.
onWorkoutRemoved((workout) => {
  if (!workout.synced) return
  const pending = useSyncStore.getState().pendingDeletes
  if (pending.includes(workout.id)) return
  useSyncStore.setState({ pendingDeletes: [...pending, workout.id] })
})

// Another tab synced or changed accounts: pick up its cursor and ownership before syncing here.
onLocalStorageKeyChange(SYNC_STORAGE_KEY, () => {
  void useSyncStore.persist.rehydrate()
})
