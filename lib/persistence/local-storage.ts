/**
 * Safe localStorage helpers.
 *
 * Every access is wrapped in try/catch (private mode, quota, disabled storage) and is a no-op
 * on the server, so modules can create stores at module scope without touching `window`.
 */
import {
  createJSONStorage,
  type PersistStorage,
  type StateStorage,
} from "zustand/middleware"

export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

function storage(): Storage | null {
  if (!isBrowser()) return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Read and parse a JSON value. Returns `fallback` when missing, unparsable or unavailable. */
export function readJSON<T>(key: string, fallback: T): T {
  const s = storage()
  if (!s) return fallback
  try {
    const raw = s.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Serialise and write a JSON value. Returns false when the write could not be performed. */
export function writeJSON(key: string, value: unknown): boolean {
  const s = storage()
  if (!s) return false
  try {
    s.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeKey(key: string): boolean {
  const s = storage()
  if (!s) return false
  try {
    s.removeItem(key)
    return true
  } catch {
    return false
  }
}

/** A zustand `StateStorage` over localStorage that never throws and is inert on the server. */
export const safeLocalStorage: StateStorage = {
  getItem(name) {
    const s = storage()
    if (!s) return null
    try {
      return s.getItem(name)
    } catch {
      return null
    }
  },
  setItem(name, value) {
    const s = storage()
    if (!s) return
    try {
      s.setItem(name, value)
    } catch {
      // Quota exceeded or storage disabled: state stays in memory for this session.
    }
  },
  removeItem(name) {
    const s = storage()
    if (!s) return
    try {
      s.removeItem(name)
    } catch {
      // ignore
    }
  },
}

/** `persist` storage option backed by {@link safeLocalStorage}. */
export function createLocalStorage<S>(): PersistStorage<S> | undefined {
  return createJSONStorage<S>(() => safeLocalStorage)
}

/**
 * Calls `listener` when another tab or window changes `key` (or clears localStorage). The
 * browser fires `storage` only in the *other* tabs, so a store can re-read its key before its
 * next write instead of overwriting the other tab's data with a stale copy. Returns an
 * unsubscribe function; a no-op on the server.
 */
export function onLocalStorageKeyChange(
  key: string,
  listener: () => void
): () => void {
  if (!isBrowser() || typeof window.addEventListener !== "function")
    return () => {}
  const handler = (event: StorageEvent) => {
    if (event.key !== null && event.key !== key) return
    if (event.storageArea && event.storageArea !== storage()) return
    listener()
  }
  window.addEventListener("storage", handler)
  return () => window.removeEventListener("storage", handler)
}
