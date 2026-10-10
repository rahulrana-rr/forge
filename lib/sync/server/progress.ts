/**
 * GET /api/progress: per-exercise bests from `user_progress`, the last 5 sessions per exercise
 * from `exercise_performance`, and lifetime totals from the stored WorkoutTotals.
 */
import { prisma } from "@/lib/prisma"
import type { ProgressResponse } from "@/lib/sync/types"

import { progressRowToDomain } from "./mappers"
import { groupRecentSessions, type SessionSetRow } from "./stats"

interface TotalsRow {
  workouts: number
  sets: number
  reps: number
  volumeKg: number
}

const RECENT_SESSIONS = 5

export async function buildProgressResponse(
  userId: string
): Promise<ProgressResponse> {
  const [progressRows, sessionRows, totalsRows] = await Promise.all([
    prisma.userProgress.findMany({
      where: { userId },
      orderBy: { exerciseId: "asc" },
    }),
    // Last N workouts per exercise (a "session" = all logged sets of one exercise in one workout).
    prisma.$queryRaw<SessionSetRow[]>`
      WITH sessions AS (
        SELECT "exerciseId", "workoutId", MAX("completedAt") AS "completedAt"
        FROM "exercise_performance"
        WHERE "userId" = ${userId}
        GROUP BY "exerciseId", "workoutId"
      ),
      ranked AS (
        SELECT "exerciseId", "workoutId", "completedAt",
               ROW_NUMBER() OVER (PARTITION BY "exerciseId" ORDER BY "completedAt" DESC, "workoutId" DESC) AS "rn"
        FROM sessions
      )
      SELECT p."exerciseId", p."workoutId", w."date", p."setNumber", p."weightKg", p."reps", p."durationSeconds", p."rpe"
      FROM "exercise_performance" p
      JOIN ranked r ON r."exerciseId" = p."exerciseId" AND r."workoutId" = p."workoutId"
      JOIN "workout" w ON w."id" = p."workoutId"
      WHERE p."userId" = ${userId} AND r."rn" <= ${RECENT_SESSIONS}
      ORDER BY p."exerciseId" ASC, r."rn" ASC, p."setNumber" ASC
    `,
    // Lifetime totals from the client-computed WorkoutTotals, so they match what the history UI shows.
    prisma.$queryRaw<TotalsRow[]>`
      SELECT COUNT(*)::int AS "workouts",
             COALESCE(SUM(("totals"->>'sets')::float8), 0)::int AS "sets",
             COALESCE(SUM(("totals"->>'reps')::float8), 0)::int AS "reps",
             COALESCE(SUM(("totals"->>'volumeKg')::float8), 0)::float8 AS "volumeKg"
      FROM "workout"
      WHERE "userId" = ${userId} AND "deletedAt" IS NULL
    `,
  ])

  const sessions = groupRecentSessions(sessionRows, RECENT_SESSIONS)
  const progress: ProgressResponse["progress"] = {}
  for (const row of progressRows) {
    progress[row.exerciseId] = progressRowToDomain(
      row,
      sessions.get(row.exerciseId) ?? []
    )
  }

  const totals = totalsRows[0]
  return {
    progress,
    totals: {
      workouts: Number(totals?.workouts ?? 0),
      sets: Number(totals?.sets ?? 0),
      reps: Number(totals?.reps ?? 0),
      volumeKg: Number(totals?.volumeKg ?? 0),
    },
  }
}
