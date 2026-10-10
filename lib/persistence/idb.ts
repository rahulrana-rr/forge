/**
 * IndexedDB-backed `StateStorage` for zustand's persist middleware (via idb-keyval).
 *
 * All FORGE keys live in one database ("forge") and one object store ("keyval"); the zustand
 * `name` is the key. Reads resolve to null and writes are no-ops on the server or when
 * IndexedDB is unavailable, so persisted stores can still be created at module scope.
 *
 * Every committed write or delete is announced on a BroadcastChannel so other tabs and installed
 * app windows on the same origin can re-read the key (see {@link onIdbKeyChange}). Without that,
 * a tab that loaded earlier would overwrite the key with its stale in-memory copy on its next write.
 */
import { createStore, del, get, set, type UseStore } from "idb-keyval"
import type { StateStorage } from "zustand/middleware"

export const IDB_DATABASE = "forge"
export const IDB_OBJECT_STORE = "keyval"
export const IDB_CHANNEL = "forge:idb"

let store: UseStore | null = null
let unavailable = false

function getStore(): UseStore | null {
  if (store) return store
  if (unavailable) return null
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return null
  }
  try {
    store = createStore(IDB_DATABASE, IDB_OBJECT_STORE)
    return store
  } catch {
    unavailable = true
    return null
  }
}

interface KeyChangeMessage {
  key: string
}

let channel: BroadcastChannel | null | undefined

/** One channel per tab: a BroadcastChannel never receives its own messages, only other tabs'. */
function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel
  channel = null
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined")
    return channel
  try {
    channel = new BroadcastChannel(IDB_CHANNEL)
  } catch {
    channel = null
  }
  return channel
}

function announce(key: string): void {
  try {
    getChannel()?.postMessage({ key } satisfies KeyChangeMessage)
  } catch {
    // Best effort: other tabs pick the change up on their next load.
  }
}

/**
 * Calls `listener` when another tab or window writes or deletes `key`. Returns an unsubscribe
 * function. A no-op on the server or where BroadcastChannel is unavailable.
 */
export function onIdbKeyChange(key: string, listener: () => void): () => void {
  const ch = getChannel()
  if (!ch) return () => {}
  const handler = (event: MessageEvent<unknown>) => {
    const data = event.data as Partial<KeyChangeMessage> | null
    if (data && data.key === key) listener()
  }
  ch.addEventListener("message", handler)
  return () => ch.removeEventListener("message", handler)
}

export const idbStorage: StateStorage = {
  async getItem(name) {
    const s = getStore()
    if (!s) return null
    try {
      const value = await get<string>(name, s)
      return typeof value === "string" ? value : null
    } catch {
      return null
    }
  },
  async setItem(name, value) {
    const s = getStore()
    if (!s) return
    try {
      await set(name, value, s)
      announce(name)
    } catch {
      // Storage failure (quota, private mode): state stays in memory for this session.
    }
  },
  async removeItem(name) {
    const s = getStore()
    if (!s) return
    try {
      await del(name, s)
      announce(name)
    } catch {
      // ignore
    }
  },
}
