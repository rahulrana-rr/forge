/**
 * Asks the browser to keep this origin's storage when it evicts data under storage pressure.
 *
 * Guest data (profile, history) exists only in localStorage and IndexedDB, so eviction would lose
 * it for good. Chromium and Firefox honour a granted `persist()`; Safari applies its own policy
 * (a Home Screen web app keeps its data, a browser tab may still be cleared after seven days of
 * use without a visit), so on iOS signing in or installing the app is the reliable protection.
 */
let requested = false

/** Fire-and-forget; runs at most once per page load and never throws. */
export function requestPersistentStorage(): void {
  if (requested) return
  requested = true
  if (typeof navigator === "undefined") return
  const storage = (navigator as Navigator & { storage?: StorageManager })
    .storage
  if (
    !storage ||
    typeof storage.persist !== "function" ||
    typeof storage.persisted !== "function"
  )
    return
  storage
    .persisted()
    .then((already) => (already ? true : storage.persist()))
    .catch(() => {
      // Not granted or not supported: data stays best-effort, as before.
    })
}

/** Test hook: lets the next call ask again. */
export function resetPersistentStorageRequest(): void {
  requested = false
}
