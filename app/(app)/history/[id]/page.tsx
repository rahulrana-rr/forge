import { redirect } from "next/navigation"

/**
 * Old workout-detail URL. The detail now lives on the static /history page (?w=<id>) so it works
 * offline and prefetches; this keeps existing links working. Offline, public/sw.js does the same
 * redirect without a round trip.
 */
export default async function WorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/history?w=${encodeURIComponent(id)}`)
}
