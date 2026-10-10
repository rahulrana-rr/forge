import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CompletedWorkout, UserProfile } from "@/lib/domain/types"
import {
  type SyncRequest,
  type SyncResponse,
} from "@/lib/sync/types"
import {
  FOREIGN_DATA_MESSAGE,
  useSyncStore,
  SYNC_BATCH_SIZE,
} from "@/lib/sync/sync-store"
import { useHistoryStore } from "./history-store"
import { useProfileStore } from "./profile-store"

const profile: UserProfile = {
  id: "local",
  goal: "strength",
  gender: "unspecified",
  weightKg: 80,
  experience: "beginner",
  trainingDaysPerWeek: 3,
  equipmentPreset: "dumbbells",
  equipment: ["dumbbell", "bodyweight", "bench"],
  durationPreferenceMinutes: 45,
  units: "kg",
  limitations: [],
  excludedExerciseIds: [],
  preferredExerciseIds: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
}

function workout(id: string, synced = false): CompletedWorkout {
  return {
    id,
    date: "2026-10-05",
    title: "Full body A",
    split: "full_body",
    focus: ["full_body"],
    goal: "strength",
    startedAt: "2026-10-05T09:00:00.000Z",
    completedAt: `2026-10-05T10:00:${id.padStart(2, "0").slice(-2)}.000Z`,
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
  }
}

type FetchMock = ReturnType<typeof vi.fn>
let fetchMock: FetchMock
const requests: SyncRequest[] = []

function ok(body: SyncResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

function fail(status: number, code = "boom"): Response {
  return new Response(
    JSON.stringify({ error: { code, message: `failed ${status}` } }),
    { status }
  )
}

beforeEach(() => {
  requests.length = 0
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as SyncRequest)
    const ids = requests[requests.length - 1].workouts.map((w) => w.id)
    return ok({
      acceptedIds: ids,
      workouts: [],
      profile: null,
      serverTime: `2026-10-07T10:00:0${requests.length}.000Z`,
    })
  })
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("navigator", { onLine: true })
  useProfileStore.setState({ profile })
  useHistoryStore.setState({ workouts: [], progress: {} })
  // Steady state: the local profile was already reconciled with the account.
  useSyncStore.setState({
    signedIn: false,
    status: "signed_out",
    lastSyncedAt: null,
    lastError: null,
    pendingCount: 0,
    userId: null,
    ownerUserId: null,
    linkedProfileId: profile.id,
    lastCompletedAt: null,
    pendingDeletes: [],
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("useSyncStore", () => {
  it("no-ops when signed out or offline", async () => {
    useHistoryStore.getState().addWorkout(workout("1"))
    await useSyncStore.getState().flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useSyncStore.getState().status).toBe("signed_out")
    expect(useSyncStore.getState().pendingCount).toBe(1)

    useSyncStore.getState().setSignedIn(true)
    vi.stubGlobal("navigator", { onLine: false })
    await useSyncStore.getState().flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useSyncStore.getState().status).toBe("offline")
  })

  it("pushes unsynced workouts with since + profile, marks them synced and stores serverTime", async () => {
    useHistoryStore.getState().addWorkout(workout("1"))
    useHistoryStore.getState().addWorkout(workout("2", true))
    useSyncStore.setState({ lastSyncedAt: "2026-10-06T00:00:00.000Z" })
    useSyncStore.getState().setSignedIn(true)

    await useSyncStore.getState().flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/workouts/sync")
    expect(init.credentials).toBe("include")
    expect(requests[0].workouts.map((w) => w.id)).toEqual(["1"])
    expect(requests[0].since).toBe("2026-10-06T00:00:00.000Z")
    expect(requests[0].profile).toMatchObject({
      goal: "strength",
      updatedAt: profile.updatedAt,
    })
    expect(requests[0].profile).not.toHaveProperty("id")

    const state = useSyncStore.getState()
    expect(state.status).toBe("idle")
    expect(state.lastSyncedAt).toBe("2026-10-07T10:00:01.000Z")
    expect(state.pendingCount).toBe(0)
    expect(useHistoryStore.getState().workouts.every((w) => w.synced)).toBe(
      true
    )
  })

  it("batches in groups of 25 and merges remote workouts + a newer server profile", async () => {
    for (let i = 1; i <= 30; i++)
      useHistoryStore.getState().addWorkout(workout(String(i)))
    const serverProfile: UserProfile = {
      ...profile,
      id: "server",
      goal: "fat_loss",
      updatedAt: "2026-10-06T00:00:00.000Z",
    }
    fetchMock.mockImplementationOnce(
      async (_url: string, init?: RequestInit) => {
        const req = JSON.parse(String(init?.body)) as SyncRequest
        requests.push(req)
        return ok({
          acceptedIds: req.workouts.map((w) => w.id),
          workouts: [workout("remote-1", true)],
          profile: serverProfile,
          serverTime: "2026-10-07T10:00:00.000Z",
        })
      }
    )
    useSyncStore.getState().setSignedIn(true)

    await useSyncStore.getState().flush()

    expect(requests).toHaveLength(2)
    expect(requests[0].workouts).toHaveLength(SYNC_BATCH_SIZE)
    expect(requests[1].workouts).toHaveLength(5)
    expect(requests[1].since).toBe("2026-10-07T10:00:00.000Z")
    expect(requests[1].profile).toBeUndefined()
    const history = useHistoryStore.getState()
    expect(history.workouts).toHaveLength(31)
    expect(history.getWorkout("remote-1")?.synced).toBe(true)
    expect(useProfileStore.getState().profile?.goal).toBe("fat_loss")
    expect(useSyncStore.getState().pendingCount).toBe(0)
  })

  it("keeps a local edit made during the request when the server copy is older", async () => {
    fetchMock.mockImplementationOnce(async () => {
      // The user edits the profile while the push is in flight.
      useProfileStore.setState({
        profile: {
          ...profile,
          goal: "muscle_gain",
          updatedAt: "2026-10-07T09:59:00.000Z",
        },
      })
      return ok({
        acceptedIds: [],
        workouts: [],
        profile: {
          ...profile,
          goal: "fat_loss",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
        serverTime: "2026-10-07T10:00:00.000Z",
      })
    })
    useSyncStore.getState().setSignedIn(true)
    await useSyncStore.getState().flush()
    expect(useProfileStore.getState().profile?.goal).toBe("muscle_gain")
  })

  it("coalesces concurrent flushes", async () => {
    useSyncStore.getState().setSignedIn(true)
    const a = useSyncStore.getState().flush()
    const b = useSyncStore.getState().flush()
    expect(a).toBe(b)
    await Promise.all([a, b])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retries with backoff up to three attempts then reports error", async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async () => fail(500))
    useSyncStore.getState().setSignedIn(true)
    const done = useSyncStore.getState().flush()
    expect(useSyncStore.getState().status).toBe("syncing")
    await vi.runAllTimersAsync()
    await done
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(useSyncStore.getState().status).toBe("error")
    expect(useSyncStore.getState().lastError).toBe("failed 500")
  })

  it("keeps rejected workouts local, stops re-pushing them and surfaces the reason", async () => {
    useHistoryStore.getState().addWorkout(workout("1"))
    useHistoryStore.getState().addWorkout(workout("2"))
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as SyncRequest)
      const ids = requests[requests.length - 1].workouts.map((w) => w.id)
      return ok({
        acceptedIds: ids.filter((id) => id !== "2"),
        workouts: [],
        profile: null,
        serverTime: `2026-10-07T10:00:0${requests.length}.000Z`,
        rejected: ids.includes("2")
          ? [{ id: "2", code: "validation_error", message: "bad totals" }]
          : [],
      })
    })
    useSyncStore.getState().setSignedIn(true)

    await useSyncStore.getState().flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const byId = new Map(
      useHistoryStore.getState().workouts.map((w) => [w.id, w.synced])
    )
    expect(byId.get("1")).toBe(true)
    expect(byId.get("2")).toBe(false)
    const state = useSyncStore.getState()
    expect(state.status).toBe("error")
    expect(state.lastError).toContain("1 workout could not be synced")
    expect(state.lastError).toContain("bad totals")
    expect(state.pendingCount).toBe(1)

    // A later flush leaves the rejected workout alone instead of re-sending it.
    await useSyncStore.getState().flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requests[1].workouts).toEqual([])
    expect(useSyncStore.getState().status).toBe("idle")
  })

  it("stops and signs out on 401", async () => {
    fetchMock.mockImplementation(async () => fail(401, "unauthorized"))
    useSyncStore.getState().setSignedIn(true)
    await useSyncStore.getState().flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useSyncStore.getState().status).toBe("signed_out")
  })

  it("runs again when a flush is asked for while one is in flight and new work arrived", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    fetchMock.mockImplementationOnce(
      async (_url: string, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)) as SyncRequest)
        await gate
        return ok({
          acceptedIds: [],
          workouts: [],
          profile: null,
          serverTime: "2026-10-07T10:00:00.000Z",
        })
      }
    )
    useSyncStore.getState().setSignedIn(true)
    const first = useSyncStore.getState().flush()
    await vi.waitFor(() => expect(requests).toHaveLength(1))

    // Saved while the (empty) request is still out: finish() asks for a flush.
    useHistoryStore.getState().addWorkout(workout("w"))
    const second = useSyncStore.getState().flush()
    expect(second).toBe(first)
    release()
    await first

    expect(requests).toHaveLength(2)
    expect(requests[0].workouts).toEqual([])
    expect(requests[1].workouts.map((w) => w.id)).toEqual(["w"])
    expect(useHistoryStore.getState().getWorkout("w")?.synced).toBe(true)
    expect(useSyncStore.getState().pendingCount).toBe(0)
  })

  it("keeps pulling while the server reports more pages, then stores the final cursor", async () => {
    const server: CompletedWorkout[] = Array.from({ length: 650 }, (_, i) => ({
      ...workout("x", true),
      id: `s${i}`,
      completedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    }))
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const req = JSON.parse(String(init?.body)) as SyncRequest
      requests.push(req)
      // The cursor is the index of the next row to deliver; pages are shorter than the limit.
      const from = req.since ? Number(req.since.slice(-4, -1)) : 0
      const page = server.slice(from, from + 300)
      const next = from + page.length
      const hasMore = next < server.length
      return ok({
        acceptedIds: [],
        workouts: page,
        profile: null,
        serverTime: hasMore
          ? `2026-01-01T00:00:00.${String(next).padStart(3, "0")}Z`
          : "2026-10-07T10:00:00.000Z",
        hasMore,
      })
    })
    useSyncStore.getState().setSignedIn(true)

    await useSyncStore.getState().flush()

    expect(requests).toHaveLength(3)
    expect(requests[0].since).toBeUndefined()
    expect(useHistoryStore.getState().workouts).toHaveLength(650)
    expect(useSyncStore.getState().lastSyncedAt).toBe(
      "2026-10-07T10:00:00.000Z"
    )
    expect(useSyncStore.getState().lastCompletedAt).not.toBeNull()
    expect(useSyncStore.getState().status).toBe("idle")
  })

  it("halves the push batch when the server answers 413", async () => {
    for (let i = 0; i < 4; i++) useHistoryStore.getState().addWorkout(workout(`b${i}`))
    let calls = 0
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      calls++
      const req = JSON.parse(String(init?.body)) as SyncRequest
      if (req.workouts.length > 2) return fail(413, "payload_too_large")
      requests.push(req)
      return ok({
        acceptedIds: req.workouts.map((w) => w.id),
        workouts: [],
        profile: null,
        serverTime: "2026-10-07T10:00:00.000Z",
      })
    })
    useSyncStore.getState().setSignedIn(true)

    await useSyncStore.getState().flush()

    expect(calls).toBeGreaterThan(1)
    expect(requests.every((r) => r.workouts.length <= 2)).toBe(true)
    expect(useHistoryStore.getState().workouts.every((w) => w.synced)).toBe(true)
    expect(useSyncStore.getState().status).toBe("idle")
  })
})

describe("workout deletes", () => {
  it("queues a deleted synced workout, sends it once and clears the queue", async () => {
    useHistoryStore.getState().addWorkout(workout("d1", true))
    useHistoryStore.getState().addWorkout(workout("d2"))
    useHistoryStore.getState().removeWorkout("d1")
    // An unsynced workout never reached the server: nothing to send for it.
    useHistoryStore.getState().removeWorkout("d2")
    expect(useSyncStore.getState().pendingDeletes).toEqual(["d1"])

    useSyncStore.getState().setSignedIn(true)
    await useSyncStore.getState().flush()

    expect(requests[0].deletedIds).toEqual(["d1"])
    expect(useSyncStore.getState().pendingDeletes).toEqual([])
    await useSyncStore.getState().flush()
    expect(requests.at(-1)?.deletedIds).toBeUndefined()
  })

  it("drops workouts the server reports deleted and never merges back one deleted mid-request", async () => {
    useHistoryStore.getState().addWorkout(workout("r1", true))
    useHistoryStore.getState().addWorkout(workout("r2", true))
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as SyncRequest)
      // The user deletes r2 here while the request is out; the response still carries it.
      useHistoryStore.getState().removeWorkout("r2")
      return ok({
        acceptedIds: [],
        workouts: [workout("r2", true)],
        profile: null,
        serverTime: "2026-10-07T10:00:00.000Z",
        deletedIds: ["r1"],
      })
    })
    useSyncStore.getState().setSignedIn(true)
    await useSyncStore.getState().flush()

    expect(useHistoryStore.getState().workouts.map((w) => w.id)).toEqual([])
    // r1 was dropped because the server said so: it is not queued to be sent back.
    expect(useSyncStore.getState().pendingDeletes).toEqual(["r2"])
  })

  it("does not rewrite history when a pull re-delivers rows it already has", async () => {
    useHistoryStore.getState().addWorkout(workout("same", true))
    const before = useHistoryStore.getState().workouts
    useHistoryStore.getState().mergeRemote([workout("same", true)])
    expect(useHistoryStore.getState().workouts).toBe(before)
  })
})

describe("account scoping", () => {
  const serverProfile: UserProfile = {
    ...profile,
    id: "user-a",
    goal: "fat_loss",
    limitations: ["knee"],
    excludedExerciseIds: ["barbell-back-squat"],
    // Older than the local profile: on first link the timestamp must not decide.
    updatedAt: "2026-09-01T00:00:00.000Z",
  }

  function serve(
    reply: (req: SyncRequest) => Partial<SyncResponse> = () => ({})
  ): void {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const req = JSON.parse(String(init?.body)) as SyncRequest
      requests.push(req)
      return ok({
        acceptedIds: req.workouts.map((w) => w.id),
        workouts: [],
        profile: null,
        serverTime: `2026-10-07T11:00:0${requests.length}.000Z`,
        ...reply(req),
      })
    })
  }

  it("first sync with an account: full pull, guest workouts pushed, the account's profile wins", async () => {
    useSyncStore.setState({
      linkedProfileId: null,
      lastSyncedAt: "2026-10-06T00:00:00.000Z",
    })
    useHistoryStore.getState().addWorkout(workout("g1"))
    serve(() => ({ profile: serverProfile }))

    useSyncStore.getState().setSignedIn(true, "user-a")
    await useSyncStore.getState().flush()

    expect(requests).toHaveLength(1)
    expect(requests[0].since).toBeUndefined()
    expect(requests[0].profile).toBeUndefined()
    expect(requests[0].workouts.map((w) => w.id)).toEqual(["g1"])
    const local = useProfileStore.getState().profile
    expect(local?.goal).toBe("fat_loss")
    expect(local?.limitations).toEqual(["knee"])
    expect(local?.excludedExerciseIds).toEqual(["barbell-back-squat"])
    const state = useSyncStore.getState()
    expect(state.ownerUserId).toBe("user-a")
    expect(state.linkedProfileId).toBe("user-a")
  })

  it("a profile re-created by onboarding does not overwrite the account's profile", async () => {
    useSyncStore.setState({
      ownerUserId: "user-a",
      linkedProfileId: "user-a",
      lastSyncedAt: "2026-10-06T00:00:00.000Z",
    })
    // Reset local data + onboarding again: a new local profile with a fresh id and timestamp.
    useProfileStore.setState({
      profile: {
        ...profile,
        id: "fresh",
        updatedAt: "2026-10-07T09:00:00.000Z",
      },
    })
    serve(() => ({ profile: serverProfile }))

    useSyncStore.getState().setSignedIn(true, "user-a")
    await useSyncStore.getState().flush()

    expect(requests[0].profile).toBeUndefined()
    expect(useProfileStore.getState().profile?.limitations).toEqual(["knee"])
  })

  it("pushes an unlinked local profile once the server shows it has none", async () => {
    useSyncStore.setState({ linkedProfileId: null })
    serve((req) => ({
      profile: req.profile
        ? ({
            ...req.profile,
            id: "user-a",
            createdAt: "2026-10-07T11:00:00.000Z",
            updatedAt: req.profile.updatedAt ?? profile.updatedAt,
          } as UserProfile)
        : null,
    }))

    useSyncStore.getState().setSignedIn(true, "user-a")
    await useSyncStore.getState().flush()

    expect(requests).toHaveLength(2)
    expect(requests[0].profile).toBeUndefined()
    expect(requests[1].profile).toMatchObject({ goal: "strength" })
    expect(useSyncStore.getState().linkedProfileId).toBe(
      useProfileStore.getState().profile?.id
    )
    expect(useProfileStore.getState().profile?.goal).toBe("strength")
  })

  it("never pushes or pulls another account's local data; adoptLocalData resolves it", async () => {
    useSyncStore.setState({
      ownerUserId: "user-a",
      lastSyncedAt: "2026-10-06T00:00:00.000Z",
    })
    useHistoryStore.getState().addWorkout(workout("a1", true))
    useHistoryStore.getState().addWorkout(workout("a2"))
    serve()

    useSyncStore.getState().setSignedIn(false)
    useSyncStore.getState().setSignedIn(true, "user-b")
    await useSyncStore.getState().flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(useSyncStore.getState().status).toBe("error")
    expect(useSyncStore.getState().lastError).toBe(FOREIGN_DATA_MESSAGE)
    expect(useSyncStore.getState().ownerUserId).toBe("user-a")

    await useSyncStore.getState().adoptLocalData()
    expect(requests[0].since).toBeUndefined()
    expect(requests[0].workouts.map((w) => w.id)).toEqual(["a2"])
    expect(useSyncStore.getState().ownerUserId).toBe("user-b")
    expect(useSyncStore.getState().status).toBe("idle")
  })

  it("a different account on a device with no local workouts starts over with a full pull", async () => {
    useSyncStore.setState({
      ownerUserId: "user-a",
      lastSyncedAt: "2026-10-06T00:00:00.000Z",
    })
    serve()

    useSyncStore.getState().setSignedIn(true, "user-b")
    await useSyncStore.getState().flush()

    expect(requests[0].since).toBeUndefined()
    expect(useSyncStore.getState().ownerUserId).toBe("user-b")
  })

  it("keeps the cursor for the same account across sign-out and sign-in", async () => {
    useSyncStore.setState({
      ownerUserId: "user-a",
      lastSyncedAt: "2026-10-06T00:00:00.000Z",
    })
    useHistoryStore.getState().addWorkout(workout("a1", true))
    serve()

    useSyncStore.getState().setSignedIn(true, "user-a")
    useSyncStore.getState().setSignedIn(false)
    useSyncStore.getState().setSignedIn(true, "user-a")
    await useSyncStore.getState().flush()

    expect(requests[0].since).toBe("2026-10-06T00:00:00.000Z")
    expect(requests[0].profile).toMatchObject({ goal: "strength" })
  })

  it("adopts the server's answer for a linked profile it just pushed (clock running ahead)", async () => {
    useSyncStore.setState({ ownerUserId: "user-a", lastSyncedAt: "2026-10-06T00:00:00.000Z" })
    useProfileStore.setState({
      profile: { ...profile, updatedAt: "2099-01-01T00:00:00.000Z" },
    })
    // The server kept another device's newer edit and clamps timestamps to its own clock.
    serve(() => ({
      profile: { ...profile, goal: "muscle_gain", updatedAt: "2026-10-07T11:00:00.000Z" },
    }))

    useSyncStore.getState().setSignedIn(true, "user-a")
    await useSyncStore.getState().flush()

    expect(requests[0].profile).toMatchObject({ goal: "strength" })
    expect(useProfileStore.getState().profile?.goal).toBe("muscle_gain")
    expect(useProfileStore.getState().profile?.updatedAt).toBe("2026-10-07T11:00:00.000Z")
  })

  it("keeps local limitations when the account's profile replaces an unlinked one", async () => {
    useSyncStore.setState({ linkedProfileId: null })
    useProfileStore.setState({
      profile: { ...profile, id: "guest", limitations: ["lower_back"] },
    })
    serve(() => ({ profile: serverProfile }))

    useSyncStore.getState().setSignedIn(true, "user-a")
    await useSyncStore.getState().flush()

    const local = useProfileStore.getState().profile
    expect(local?.goal).toBe("fat_loss")
    expect(local?.limitations).toEqual(["knee", "lower_back"])
    expect(useSyncStore.getState().linkedProfileId).toBe("user-a")
  })

  it("resetCursor forgets the cursor so the next sync is a full pull", async () => {
    useSyncStore.setState({ lastSyncedAt: "2026-10-06T00:00:00.000Z" })
    useSyncStore.getState().resetCursor()
    serve()
    useSyncStore.getState().setSignedIn(true, "user-a")
    await useSyncStore.getState().flush()
    expect(requests[0].since).toBeUndefined()
  })

  it("clearing local history resets the cursor so synced workouts come back", () => {
    useHistoryStore.getState().addWorkout(workout("1", true))
    useSyncStore.setState({ lastSyncedAt: "2026-10-06T00:00:00.000Z" })
    useHistoryStore.getState().clearAll()
    expect(useSyncStore.getState().lastSyncedAt).toBeNull()
  })
})
