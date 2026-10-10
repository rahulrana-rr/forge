/**
 * Shared hydration plumbing for persisted stores. Each store exposes `hydrated` (contract) and
 * an internal `setHydrated` action that the persist middleware flips once storage has been read.
 * zustand renders the pre-hydration initial state on the server and during React hydration, so
 * the flag only turns true on the client after mount.
 */
export interface Hydratable {
  hydrated: boolean
  /** Internal: flipped by the persist middleware. */
  setHydrated(hydrated: boolean): void
}

/** `onRehydrateStorage` option: marks the store hydrated after storage has been read (even on error). */
export function onRehydrate<S extends Hydratable>(): (
  pre: S
) => (state?: S, error?: unknown) => void {
  return (pre) => (state) => {
    ;(state ?? pre).setHydrated(true)
  }
}

/** The parts of a zustand store created with `persist` that {@link whenHydrated} needs. */
export interface HydratingStore<S extends Hydratable> {
  getState(): S
  subscribe(listener: (state: S, previous: S) => void): () => void
  persist: {
    hasHydrated(): boolean
    onFinishHydration(listener: (state: S) => void): () => void
  }
}

/** Upper bound on waiting for storage, so a read that never settles cannot stall callers forever. */
export const HYDRATION_WAIT_MS = 15_000

/**
 * Resolves once the store's persisted state has been read, including a re-read triggered by
 * another tab. Writing before then is unsafe: the pending read would replace the write in memory
 * when it lands. A failed read never "finishes" in zustand, but `hydrated` still flips, so that
 * also counts.
 */
export function whenHydrated<S extends Hydratable>(
  store: HydratingStore<S>,
  timeoutMs = HYDRATION_WAIT_MS
): Promise<void> {
  if (store.persist.hasHydrated()) return Promise.resolve()
  return new Promise((resolve) => {
    const cleanups: Array<() => void> = []
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      for (const cleanup of cleanups) cleanup()
      resolve()
    }
    cleanups.push(store.persist.onFinishHydration(done))
    cleanups.push(
      store.subscribe((state, previous) => {
        if (state.hydrated && !previous.hydrated) done()
      })
    )
    const timer = setTimeout(done, timeoutMs)
    cleanups.push(() => clearTimeout(timer))
    if (store.persist.hasHydrated()) done()
  })
}
