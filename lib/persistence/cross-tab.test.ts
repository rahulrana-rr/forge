/**
 * Cross-tab safety: a store must re-read its key when another tab or app window writes it, so its
 * own next write does not overwrite that tab's data with a stale copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mem = vi.hoisted(() => new Map<string, unknown>())

vi.mock("idb-keyval", () => ({
  createStore: () => "forge-store",
  get: async (key: string) => mem.get(key),
  set: async (key: string, value: unknown) => {
    mem.set(key, value)
  },
  del: async (key: string) => {
    mem.delete(key)
  },
}))

/** Minimal BroadcastChannel: delivers to every other open channel with the same name. */
class FakeChannel {
  static open = new Set<FakeChannel>()
  private listeners = new Set<(event: MessageEvent<unknown>) => void>()
  constructor(readonly name: string) {
    FakeChannel.open.add(this)
  }
  postMessage(data: unknown): void {
    for (const other of FakeChannel.open) {
      if (other === this || other.name !== this.name) continue
      for (const listener of other.listeners)
        listener({ data } as MessageEvent<unknown>)
    }
  }
  addEventListener(
    _type: string,
    listener: (e: MessageEvent<unknown>) => void
  ) {
    this.listeners.add(listener)
  }
  removeEventListener(
    _type: string,
    listener: (e: MessageEvent<unknown>) => void
  ) {
    this.listeners.delete(listener)
  }
  close(): void {
    FakeChannel.open.delete(this)
  }
}

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
}

let win: EventTarget & { localStorage: MemoryStorage }

/** What the browser does in this tab when another tab changes localStorage. */
function storageEventFromOtherTab(key: string | null): void {
  const event = Object.assign(new Event("storage"), {
    key,
    storageArea: win.localStorage,
  })
  win.dispatchEvent(event)
}

beforeEach(() => {
  vi.resetModules()
  mem.clear()
  FakeChannel.open.clear()
  win = Object.assign(new EventTarget(), { localStorage: new MemoryStorage() })
  vi.stubGlobal("window", win)
  vi.stubGlobal("document", {})
  vi.stubGlobal("indexedDB", {})
  vi.stubGlobal("BroadcastChannel", FakeChannel)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("onLocalStorageKeyChange", () => {
  it("fires for the key or a full clear from another tab, not for other keys", async () => {
    const { onLocalStorageKeyChange } = await import("./local-storage")
    const listener = vi.fn()
    const off = onLocalStorageKeyChange("forge:profile", listener)
    storageEventFromOtherTab("forge:other")
    expect(listener).not.toHaveBeenCalled()
    storageEventFromOtherTab("forge:profile")
    storageEventFromOtherTab(null)
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    storageEventFromOtherTab("forge:profile")
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe("IndexedDB key changes", () => {
  it("announces committed writes to other tabs and hears theirs", async () => {
    const { idbStorage, onIdbKeyChange, IDB_CHANNEL } = await import("./idb")
    const otherTab = new FakeChannel(IDB_CHANNEL)
    const heard: unknown[] = []
    otherTab.addEventListener("message", (e) => heard.push(e.data))

    await idbStorage.setItem("forge:history", "{}")
    expect(heard).toEqual([{ key: "forge:history" }])

    const listener = vi.fn()
    onIdbKeyChange("forge:history", listener)
    otherTab.postMessage({ key: "forge:other" })
    expect(listener).not.toHaveBeenCalled()
    otherTab.postMessage({ key: "forge:history" })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe("stores follow other tabs", () => {
  it("the active workout is re-read before a stale tab writes again", async () => {
    const { useWorkoutStore, WORKOUT_STORAGE_KEY, IDLE_TIMER } =
      await import("@/lib/store/workout-store")
    await vi.waitFor(() =>
      expect(useWorkoutStore.persist.hasHydrated()).toBe(true)
    )
    type Active = NonNullable<
      ReturnType<typeof useWorkoutStore.getState>["active"]
    >
    const mine = {
      status: "active",
      currentIndex: 1,
      undoStack: [],
    } as unknown as Active
    useWorkoutStore.setState({ active: mine })

    // The other tab logs a set: its active workout moves on and it starts a rest.
    const theirs = { status: "active", currentIndex: 2, undoStack: [] }
    const theirTimer = {
      ...IDLE_TIMER,
      totalSeconds: 90,
      endsAt: 1,
      running: true,
    }
    win.localStorage.setItem(
      WORKOUT_STORAGE_KEY,
      JSON.stringify({
        state: { active: theirs, timer: theirTimer },
        version: 1,
      })
    )
    storageEventFromOtherTab(WORKOUT_STORAGE_KEY)
    expect(useWorkoutStore.getState().active?.currentIndex).toBe(2)

    // This tab's rest timer ends on its own; the other tab's progress survives the write.
    useWorkoutStore.getState().skipRest()
    const stored = JSON.parse(
      win.localStorage.getItem(WORKOUT_STORAGE_KEY) ?? "{}"
    ) as { state: { active: { currentIndex: number } } }
    expect(stored.state.active.currentIndex).toBe(2)
  })

  it("history is re-read when another tab saves, so a delete here keeps that save", async () => {
    const { useHistoryStore, HISTORY_STORAGE_KEY, HISTORY_SCHEMA_VERSION } =
      await import("@/lib/store/history-store")
    const { IDB_CHANNEL } = await import("./idb")
    await vi.waitFor(() =>
      expect(useHistoryStore.persist.hasHydrated()).toBe(true)
    )
    const workout = (id: string, minute: number) => ({
      id,
      date: "2026-10-05",
      title: "Push",
      split: "push",
      focus: ["chest"],
      goal: "strength",
      startedAt: "2026-10-05T09:00:00.000Z",
      completedAt: `2026-10-05T10:${String(minute).padStart(2, "0")}:00.000Z`,
      durationSeconds: 600,
      exercises: [],
      totals: {
        exercisesCompleted: 1,
        exercisesSkipped: 0,
        sets: 0,
        reps: 0,
        volumeKg: 0,
        caloriesEstimate: null,
      },
      personalRecords: [],
      engineVersion: 1,
      synced: false,
    })
    useHistoryStore.setState({
      workouts: [workout("b", 2), workout("a", 1)] as never,
    })

    // Another tab saves W and announces it.
    mem.set(
      HISTORY_STORAGE_KEY,
      JSON.stringify({
        state: {
          workouts: [workout("w", 3), workout("b", 2), workout("a", 1)],
          progress: {},
        },
        version: HISTORY_SCHEMA_VERSION,
      })
    )
    new FakeChannel(IDB_CHANNEL).postMessage({ key: HISTORY_STORAGE_KEY })
    await vi.waitFor(() =>
      expect(useHistoryStore.getState().getWorkout("w")).toBeDefined()
    )

    useHistoryStore.getState().removeWorkout("a")
    await vi.waitFor(() => {
      const stored = JSON.parse(String(mem.get(HISTORY_STORAGE_KEY))) as {
        state: { workouts: { id: string }[] }
      }
      expect(stored.state.workouts.map((w) => w.id)).toEqual(["w", "b"])
    })
  })
})
