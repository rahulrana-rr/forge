/**
 * Profile persistence with last-write-wins on the client-supplied `updatedAt`, clamped to server
 * time so a device whose clock runs ahead cannot pin its copy.
 */
import type { SessionUser } from "@/lib/auth-server"
import type { UserProfile } from "@/lib/domain/types"
import { prisma } from "@/lib/prisma"
import type { MeResponse } from "@/lib/sync/types"

import { isUniqueViolation } from "./errors"
import { profileInputToColumns, profileRowToDomain } from "./mappers"
import { MAX_PROFILE_EXERCISE_IDS, type PutMeInput } from "./validation"

export function toMeUser(user: SessionUser): MeResponse["user"] {
  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
    image: user.image ?? null,
  }
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const row = await prisma.userProfile.findUnique({ where: { userId } })
  return row ? profileRowToDomain(row) : null
}

/** The client's `updatedAt`, never later than server time (absent means now). */
export function clampUpdatedAt(updatedAt: string | undefined, now: Date): Date {
  if (!updatedAt) return now
  const ms = Date.parse(updatedAt)
  return new Date(Math.min(ms, now.getTime()))
}

/** `base` followed by the members of `extra` it lacks, in order. */
export function unionInOrder<T>(base: readonly T[], extra: readonly T[]): T[] {
  const out = [...base]
  for (const value of extra) if (!out.includes(value)) out.push(value)
  return out
}

export interface UpsertProfileOptions {
  /**
   * The pushing device has never synced with this account. When the account already has a
   * profile, keep it rather than comparing timestamps (the device's copy is typically a fresh
   * onboarding default and always looks newer). Safety lists are unioned so a limitation or
   * exclusion entered on the new device is not dropped, and `updatedAt` is re-stamped to now so
   * the device's newer-wins check adopts the result.
   */
  keepExisting?: boolean
  /** Server time; injectable for tests. */
  now?: Date
}

/** Compare-and-set attempts for the keepExisting merge before settling for the stored copy. */
const MERGE_ATTEMPTS = 3

/**
 * Merges the device's limitations and exclusions into the stored profile and re-stamps it.
 * Returns null when the account has no profile yet.
 */
async function keepExistingProfile(
  userId: string,
  input: PutMeInput,
  now: Date
): Promise<UserProfile | null> {
  for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt++) {
    const existing = await prisma.userProfile.findUnique({ where: { userId } })
    if (!existing) return null
    // Conditional on the row we read, so a concurrent write from another device is never lost.
    const updated = await prisma.userProfile.updateMany({
      where: { userId, updatedAt: existing.updatedAt },
      data: {
        limitations: unionInOrder(existing.limitations, input.limitations),
        // Capped so the merged profile still passes putMeSchema when the device pushes it back.
        excludedExerciseIds: unionInOrder(
          existing.excludedExerciseIds,
          input.excludedExerciseIds
        ).slice(0, MAX_PROFILE_EXERCISE_IDS),
        updatedAt: now,
      },
    })
    if (updated.count > 0) break
  }
  const row = await prisma.userProfile.findUnique({ where: { userId } })
  return row ? profileRowToDomain(row) : null
}

/**
 * Upserts the profile unless the stored copy is newer. Always resolves to the winning profile
 * (200), so a stale client simply reconciles against the response.
 *
 * The conditional `updateMany` makes the comparison atomic: two devices pushing at once cannot
 * overwrite each other's newer copy.
 */
export async function upsertProfile(
  userId: string,
  input: PutMeInput,
  options: UpsertProfileOptions = {}
): Promise<UserProfile> {
  const now = options.now ?? new Date()

  if (options.keepExisting) {
    const kept = await keepExistingProfile(userId, input, now)
    if (kept) return kept
  }

  const incomingUpdatedAt = clampUpdatedAt(input.updatedAt, now)
  const columns = profileInputToColumns(input, incomingUpdatedAt)

  const updated = await prisma.userProfile.updateMany({
    where: { userId, updatedAt: { lte: incomingUpdatedAt } },
    data: columns,
  })

  if (updated.count === 0) {
    const existing = await prisma.userProfile.findUnique({ where: { userId } })
    if (existing) return profileRowToDomain(existing) // server copy is newer: server wins
    try {
      const created = await prisma.userProfile.create({
        data: { userId, ...columns },
      })
      return profileRowToDomain(created)
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      // Lost a create race with another device; fall through and return whatever won.
    }
  }

  const row = await prisma.userProfile.findUniqueOrThrow({ where: { userId } })
  return profileRowToDomain(row)
}
