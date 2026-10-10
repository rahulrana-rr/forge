/**
 * Link to one workout's detail. It is a search param on the static /history page rather than a
 * dynamic /history/[id] route, so the detail prefetches, caches and opens offline.
 */
export function workoutHref(id: string): string {
  return `/history?w=${encodeURIComponent(id)}`
}
