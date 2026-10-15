/**
 * The signed-in user's program assignment on this device, persisted to localStorage
 * ("forge:program") so the program keeps working offline. Set from /api/me by SyncProvider,
 * cleared on sign-out. Client state only; the assignment itself lives in the server environment.

 *
 * Development only: NEXT_PUBLIC_DEV_PROGRAM_ASSIGNMENT (one assignment as JSON,
 * {"programId":"…","startDate":"YYYY-MM-DD"}) lets a guest preview a program locally. It is
 * ignored in production builds and never overrides a server assignment.
 */
import { create } from "zustand"
import { persist } from "zustand/middleware"

import { createLocalStorage } from "@/lib/persistence/local-storage"
import { onRehydrate, type Hydratable } from "@/lib/store/hydration"
import { parseAssignment } from "./index"
import type { ProgramAssignment } from "./types"

export const PROGRAM_STORAGE_KEY = "forge:program"

interface ProgramState extends Hydratable {
  /** The server assignment for `userId`, or null. */
  assignment: ProgramAssignment | null
  /** The account the assignment belongs to. */
  userId: string | null
  /** Store the account's assignment (null = none). */
  setAssignment(userId: string, assignment: ProgramAssignment | null): void
  /** Forget the assignment (sign-out, or a different account signing in). */
  clear(): void
}

type PersistedProgram = Pick<ProgramState, "assignment" | "userId">

function readDevAssignment(): ProgramAssignment | null {
  if (process.env.NODE_ENV === "production") return null
  const raw = process.env.NEXT_PUBLIC_DEV_PROGRAM_ASSIGNMENT
  if (!raw) return null
  try {
    return parseAssignment(JSON.parse(raw))
  } catch {
    return null
  }
}

/** The development preview assignment, or null (always null in production builds). */
export const DEV_PROGRAM_ASSIGNMENT: ProgramAssignment | null = readDevAssignment()

export const useProgramStore = create<ProgramState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      assignment: null,
      userId: null,
      setHydrated: (hydrated) => {
        if (get().hydrated !== hydrated) set({ hydrated })
      },
      setAssignment(userId, assignment) {
        const next = assignment ? parseAssignment(assignment) : null
        const current = get()
        if (current.userId === userId && sameAssignment(current.assignment, next)) return
        set({ userId, assignment: next })
      },
      clear() {
        if (get().assignment === null && get().userId === null) return
        set({ assignment: null, userId: null })
      },
    }),
    {
      name: PROGRAM_STORAGE_KEY,
      version: 2,
      storage: createLocalStorage<PersistedProgram>(),
      partialize: (state): PersistedProgram => ({ assignment: state.assignment, userId: state.userId }),
      // Version 2 briefly stored plan revisions as well; migrating keeps only the assignment.
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<PersistedProgram>
        return { assignment: parseAssignment(p.assignment), userId: typeof p.userId === "string" ? p.userId : null }
      },
      onRehydrateStorage: onRehydrate<ProgramState>(),
    },
  ),
)

function sameAssignment(a: ProgramAssignment | null, b: ProgramAssignment | null): boolean {
  return a?.programId === b?.programId && a?.startDate === b?.startDate
}

/** The assignment in effect on this device: the account's, else the development preview. */
export function activeAssignment(): ProgramAssignment | null {
  return useProgramStore.getState().assignment ?? DEV_PROGRAM_ASSIGNMENT
}

/** activeAssignment as a hook for components. */
export function useActiveAssignment(): ProgramAssignment | null {
  return useProgramStore((s) => s.assignment) ?? DEV_PROGRAM_ASSIGNMENT
}
