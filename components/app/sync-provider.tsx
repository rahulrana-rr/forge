"use client"

/**
 * Headless component that keeps the sync store in step with the auth session and triggers
 * background flushes: on sign-in, when the browser comes back online, when history changes,
 * and every five minutes while the tab is visible. Also keeps the account's program assignment
 * (lib/programs/store.ts) in step with /api/me. Renders nothing.
 */
import { useEffect } from "react"
import { useSession } from "@/lib/auth-client"
import { useProgramStore } from "@/lib/programs/store"
import { useHistoryStore, useSyncStore } from "@/lib/store"
import { api } from "@/lib/sync/client"
import { hasPendingWork } from "@/lib/sync/sync-store"

const PERIODIC_FLUSH_MS = 5 * 60 * 1000
const HISTORY_FLUSH_DEBOUNCE_MS = 1_500

function flush(): void {
  void useSyncStore
    .getState()
    .flush()
    .catch(() => {
      // Failures are reported through the sync store's status.
    })
}

export function SyncProvider(): null {
  const { data, isPending } = useSession()
  const signedIn = Boolean(data?.user)
  // The account id scopes local data: the sync store never pushes one account's data into another.
  const userId = data?.user?.id ?? null

  useEffect(() => {
    if (isPending) return
    useSyncStore.getState().setSignedIn(signedIn, userId)
    if (signedIn) flush()
  }, [signedIn, userId, isPending])

  // The program assignment follows the account: fetched on sign-in, kept while offline (so the
  // program still works without a connection), dropped once the device is online and signed out.
  useEffect(() => {
    if (isPending) return
    const programs = useProgramStore.getState()
    if (!userId) {
      if (typeof navigator === "undefined" || navigator.onLine !== false) programs.clear()
      return
    }
    if (programs.userId && programs.userId !== userId) programs.clear()
    const controller = new AbortController()
    api
      .getMe(controller.signal)
      .then((me) => useProgramStore.getState().setAssignment(userId, me.program ?? null))
      .catch(() => {
        // Offline or a server error: keep the assignment this device already has.
      })
    return () => controller.abort()
  }, [userId, isPending])

  useEffect(() => {
    if (!signedIn) return

    const onOnline = () => flush()
    const onVisibility = () => {
      if (document.visibilityState === "visible") flush()
    }
    window.addEventListener("online", onOnline)
    document.addEventListener("visibilitychange", onVisibility)

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") flush()
    }, PERIODIC_FLUSH_MS)

    let debounce: number | null = null
    const schedule = () => {
      // Only when there is something to send: a workout the server rejected stays unsynced, and
      // re-delivered pulls must not turn it into a flush every 1.5 s.
      if (!hasPendingWork()) return
      if (debounce != null) window.clearTimeout(debounce)
      debounce = window.setTimeout(() => {
        debounce = null
        flush()
      }, HISTORY_FLUSH_DEBOUNCE_MS)
    }
    const unsubscribeHistory = useHistoryStore.subscribe((state, previous) => {
      if (state.workouts !== previous.workouts) schedule()
    })
    // A workout deleted on this device queues a delete for the server.
    const unsubscribeSync = useSyncStore.subscribe((state, previous) => {
      if (state.pendingDeletes.length > previous.pendingDeletes.length) schedule()
    })
    const unsubscribe = () => {
      unsubscribeHistory()
      unsubscribeSync()
    }

    return () => {
      window.removeEventListener("online", onOnline)
      document.removeEventListener("visibilitychange", onVisibility)
      window.clearInterval(interval)
      if (debounce != null) window.clearTimeout(debounce)
      unsubscribe()
    }
  }, [signedIn])

  return null
}

export default SyncProvider
