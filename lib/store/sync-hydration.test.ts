/**
 * History hydrates from IndexedDB asynchronously. These tests hold the IndexedDB read open to
 * check that sync waits for it, and that a write from another tab is re-read before this tab
 * writes again.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CompletedWorkout } from "@/lib/domain/types"
import type { SyncRequest, SyncResponse } from "@/lib/sync/types"

const idb = vi.hoisted(() => {
  const workout = (id: string, synced: boolean, minute: number) => ({
    id,
    date: "2026-10-05",
    title: "Full body A",
    split: "full_body",
    focus: ["full_body"],
    goal: "strength",
    startedAt: "2026-10-05T09:00:00.000Z",
    completedAt: `2026-10-05T10:${String(minute).padStart(2, "0")}:00.000Z`,
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
    synced,
  })
  const data = new Map<string, string>()
  const stored = (workouts: unknown[]) =>
    JSON.stringify({ state: { workouts, progress: {} }, version: 2 })
  data.set(
    "forge:history",
    stored([
      workout("local-unsynced", false, 2),
      workout("local-synced", true, 1),
    ])
  )
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    workout,
    stored,
    data,
    gate,
    release: () => release(),
    listeners: new Map<string, () => void>(),
  }
})

vi.mock("@/lib/persistence/idb", () => ({
  idbStorage: {
    async getItem(name: string) {
      // Read-before-write ordering, as IndexedDB transactions give: the value is taken when the
      // read is issued, then delivered once the gate opens.
      const value = idb.data.get(name) ?? null
      await idb.gate
      return value
    },
    async setItem(name: string, value: string) {
      idb.data.set(name, value)
    },
    async removeItem(name: string) {
      idb.data.delete(name)
    },
  },
  onIdbKeyChange(key: string, listener: () => void) {
    idb.listeners.set(key, listener)
    return () => idb.listeners.delete(key)
  },
}))

import { useHistoryStore } from "./history-store"
import { useSyncStore } from "@/lib/sync/sync-store"

const requests: SyncRequest[] = []

afterEach(() => {
  vi.unstubAllGlobals()
})

function storedIds(): string[] {
  const raw = idb.data.get("forge:history")
  const parsed = JSON.parse(raw ?? "{}") as {
    state?: { workouts?: CompletedWorkout[] }
  }
  return (parsed.state?.workouts ?? []).map((w) => w.id)
}

describe("sync and IndexedDB hydration", () => {
  it("waits for history to load before pushing or merging a pull", async () => {
    vi.stubGlobal("navigator", { onLine: true })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const req = JSON.parse(String(init?.body)) as SyncRequest
        requests.push(req)
        const res: SyncResponse = {
          acceptedIds: req.workouts.map((w) => w.id),
          workouts: [idb.workout("remote-1", true, 30) as CompletedWorkout],
          profile: null,
          serverTime: "2026-10-07T10:00:00.000Z",
        }
        return new Response(JSON.stringify(res), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      })
    )
    expect(useHistoryStore.persist.hasHydrated()).toBe(false)

    useSyncStore.getState().setSignedIn(true)
    const done = useSyncStore.getState().flush()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(requests).toHaveLength(0)

    idb.release()
    await done

    expect(requests).toHaveLength(1)
    expect(requests[0].workouts.map((w) => w.id)).toEqual(["local-unsynced"])
    const ids = useHistoryStore.getState().workouts.map((w) => w.id)
    expect(ids).toEqual(["remote-1", "local-unsynced", "local-synced"])
    expect(storedIds()).toEqual(ids)
    expect(useHistoryStore.getState().workouts.every((w) => w.synced)).toBe(
      true
    )
  })

  it("re-reads history written by another tab before writing again", async () => {
    await vi.waitFor(() =>
      expect(useHistoryStore.persist.hasHydrated()).toBe(true)
    )
    const before = useHistoryStore.getState().workouts
    // Another tab saves W: storage now holds W plus everything this tab holds.
    const other = idb.workout("other-tab", false, 45) as CompletedWorkout
    idb.data.set("forge:history", idb.stored([other, ...before]))
    idb.listeners.get("forge:history")?.()
    await vi.waitFor(() =>
      expect(useHistoryStore.getState().getWorkout("other-tab")).toBeDefined()
    )

    // This tab then deletes an old workout; the other tab's save survives.
    useHistoryStore.getState().removeWorkout("local-synced")
    await vi.waitFor(() => expect(storedIds()).toContain("other-tab"))
    expect(storedIds()).not.toContain("local-synced")
  })
})
