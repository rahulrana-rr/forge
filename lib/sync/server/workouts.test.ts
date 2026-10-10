import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Workout as WorkoutRow } from "@/lib/generated/prisma/client"

/* ------------------------------------------------------------------ */
/* In-memory stand-in for the two prisma.workout.findMany shapes used  */
/* ------------------------------------------------------------------ */

const table: WorkoutRow[] = []

type DateFilter = Date | { gt?: Date; lt?: Date }

interface FindManyArgs {
  where: { userId: string; updatedAt?: DateFilter; completedAt?: DateFilter }
  orderBy: Record<string, "asc" | "desc">[]
  take?: number
}

function passes(value: Date, filter: DateFilter | undefined): boolean {
  if (!filter) return true
  if (filter instanceof Date) return value.getTime() === filter.getTime()
  if (filter.gt && !(value.getTime() > filter.gt.getTime())) return false
  if (filter.lt && !(value.getTime() < filter.lt.getTime())) return false
  return true
}

function findMany(args: FindManyArgs): Promise<WorkoutRow[]> {
  const { userId, updatedAt, completedAt } = args.where
  let rows = table.filter(
    (r) =>
      r.userId === userId &&
      passes(r.updatedAt, updatedAt) &&
      passes(r.completedAt, completedAt)
  )
  rows = rows.slice().sort((a, b) => {
    for (const order of args.orderBy) {
      const [key, dir] = Object.entries(order)[0]!
      const av = a[key as keyof WorkoutRow] as Date | string
      const bv = b[key as keyof WorkoutRow] as Date | string
      const cmp =
        av instanceof Date && bv instanceof Date
          ? av.getTime() - bv.getTime()
          : String(av).localeCompare(String(bv))
      if (cmp !== 0) return dir === "asc" ? cmp : -cmp
    }
    return 0
  })
  return Promise.resolve(
    args.take === undefined ? rows : rows.slice(0, args.take)
  )
}

vi.mock("@/lib/prisma", () => ({
  prisma: { workout: { findMany: (args: FindManyArgs) => findMany(args) } },
}))

const {
  listHistory,
  pageLength,
  pullCursor,
  pullWorkouts,
  SYNC_PULL_OVERLAP_MS,
} = await import("./workouts")

/* ------------------------------------------------------------------ */

const NOW = new Date("2026-10-07T12:00:00.000Z")
const at = (msBeforeNow: number) => new Date(NOW.getTime() - msBeforeNow)

function row(id: string, updatedAt: Date, completedAt = updatedAt): WorkoutRow {
  return {
    id,
    userId: "u1",
    date: "2026-10-01",
    title: "Push",
    split: "push",
    focus: ["chest"],
    goal: "strength",
    startedAt: completedAt,
    completedAt,
    durationSeconds: 3600,
    completed: true,
    engineVersion: 1,
    exercises: [],
    totals: {},
    personalRecords: [],
    createdAt: updatedAt,
    updatedAt,
    deletedAt: null,
  }
}

/** Pulls like a client that follows `hasMore`, returning every delivered id. */
async function pullAll(limit: number, since?: string): Promise<string[]> {
  const seen: string[] = []
  for (let i = 0; i < 50; i++) {
    const page = await pullWorkouts("u1", since, NOW, limit)
    seen.push(...page.workouts.map((w) => w.id))
    since = page.cursor.toISOString()
    if (!page.hasMore) return seen
  }
  throw new Error("pull did not terminate")
}

beforeEach(() => {
  table.length = 0
})

describe("pageLength", () => {
  const rows = (...ms: number[]) => ms.map((m) => new Date(m))
  const key = (d: Date) => d

  it("keeps everything when the fetch fits the limit", () => {
    expect(pageLength(rows(1, 2, 3), 3, key)).toBe(3)
  })

  it("cuts before a run of equal keys that crosses the limit", () => {
    expect(pageLength(rows(1, 2, 3, 4), 3, key)).toBe(3)
    expect(pageLength(rows(1, 2, 2, 2), 3, key)).toBe(1)
    expect(pageLength(rows(9, 8, 7, 7), 3, key)).toBe(2)
  })

  it("returns 0 when the whole fetch is one run", () => {
    expect(pageLength(rows(5, 5, 5, 5), 3, key)).toBe(0)
  })
})

describe("pullCursor", () => {
  const safe = at(SYNC_PULL_OVERLAP_MS)
  const page = (...dates: Date[]) => dates.map((updatedAt) => ({ updatedAt }))

  it("backs a complete pull off from server time by the overlap", () => {
    expect(pullCursor(page(at(1)), false, NOW)).toEqual(safe)
    expect(pullCursor([], false, NOW)).toEqual(safe)
  })

  it("continues a truncated pull from its last row when that is already safe", () => {
    expect(pullCursor(page(at(90_000), at(60_000)), true, NOW)).toEqual(
      at(60_000)
    )
  })

  it("backs off to the safe point when the page straddles it", () => {
    expect(pullCursor(page(at(60_000), at(1_000)), true, NOW)).toEqual(safe)
  })

  it("never hands back a cursor that would repeat the same page", () => {
    expect(pullCursor(page(at(2_000), at(1_000)), true, NOW)).toEqual(at(1_000))
  })
})

describe("pullWorkouts", () => {
  it("delivers every row across pages, including ties at page boundaries", async () => {
    const minute = 60_000
    table.push(
      row("a", at(10 * minute)),
      row("b", at(9 * minute)),
      row("c", at(8 * minute)),
      row("d", at(8 * minute)),
      row("e", at(8 * minute)),
      row("f", at(7 * minute)),
      row("g", at(6 * minute))
    )
    const seen = await pullAll(3)
    expect(new Set(seen)).toEqual(new Set(["a", "b", "c", "d", "e", "f", "g"]))
  })

  it("widens the page when more rows than the limit share one updatedAt", async () => {
    const t = at(5 * 60_000)
    for (const id of ["a", "b", "c", "d", "e"]) table.push(row(id, t))
    table.push(row("z", at(60_000)))

    const first = await pullWorkouts("u1", undefined, NOW, 2)
    expect(first.workouts.map((w) => w.id).sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ])
    expect(first.hasMore).toBe(true)
    expect(first.cursor).toEqual(t)

    const second = await pullWorkouts("u1", first.cursor.toISOString(), NOW, 2)
    expect(second.workouts.map((w) => w.id)).toEqual(["z"])
    expect(second.hasMore).toBe(false)
  })

  it("answers newest completedAt first and reports a complete pull", async () => {
    table.push(
      row("old", at(3_000_000), new Date("2026-09-01T10:00:00.000Z")),
      row("new", at(2_000_000), new Date("2026-10-01T10:00:00.000Z"))
    )
    const page = await pullWorkouts("u1", undefined, NOW)
    expect(page.workouts.map((w) => w.id)).toEqual(["new", "old"])
    expect(page.workouts[0]!.synced).toBe(true)
    expect(page.hasMore).toBe(false)
    expect(page.cursor).toEqual(at(SYNC_PULL_OVERLAP_MS))
  })

  it("re-offers a row stamped before the pull but committed after it", async () => {
    table.push(row("seen", at(60_000)))
    const first = await pullWorkouts("u1", undefined, NOW)
    expect(first.workouts.map((w) => w.id)).toEqual(["seen"])

    // Another device's transaction stamped this row 300 ms before NOW and committed afterwards.
    table.push(row("late", at(300)))
    const second = await pullWorkouts("u1", first.cursor.toISOString(), NOW)
    expect(second.workouts.map((w) => w.id)).toContain("late")
  })

  it("reports deleted workouts as deletedIds instead of delivering them", async () => {
    table.push(row("kept", at(60_000)), {
      ...row("gone", at(30_000)),
      deletedAt: at(30_000),
    })
    const page = await pullWorkouts("u1", undefined, NOW)
    expect(page.workouts.map((w) => w.id)).toEqual(["kept"])
    expect(page.deletedIds).toEqual(["gone"])
  })
})

describe("listHistory", () => {
  /** Pages like the client's backfill, returning every delivered id. */
  async function listAll(limit: number): Promise<string[]> {
    const seen: string[] = []
    let cursor: string | undefined
    for (let i = 0; i < 50; i++) {
      const page = await listHistory("u1", cursor, limit)
      seen.push(...page.workouts.map((w) => w.id))
      if (!page.nextCursor) return seen
      cursor = page.nextCursor
    }
    throw new Error("history paging did not terminate")
  }

  it("never skips workouts that share a completedAt at a page boundary", async () => {
    const day = (d: number) => new Date(`2026-10-0${d}T10:00:00.000Z`)
    table.push(
      row("a", NOW, day(5)),
      row("b", NOW, day(4)),
      row("c", NOW, day(3)),
      row("d", NOW, day(3)),
      row("e", NOW, day(2)),
      row("f", NOW, day(1))
    )
    const seen = await listAll(3)
    expect(seen.slice().sort()).toEqual(["a", "b", "c", "d", "e", "f"])
    expect(new Set(seen).size).toBe(seen.length)
  })

  it("returns a whole run of equal completedAt when it exceeds the page", async () => {
    const t = new Date("2026-10-03T10:00:00.000Z")
    for (const id of ["a", "b", "c", "d"]) table.push(row(id, NOW, t))
    table.push(row("old", NOW, new Date("2026-10-01T10:00:00.000Z")))
    expect((await listAll(2)).sort()).toEqual(["a", "b", "c", "d", "old"])
  })
})
