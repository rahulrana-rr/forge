"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { FullScreenSkeleton } from "@/components/app/skeletons"
import { useSession } from "@/lib/auth-client"
import { useProfileStore } from "@/lib/store"
import { api } from "@/lib/sync/client"

/**
 * Keeps app routes behind onboarding. Shows a full-screen skeleton until the profile store has
 * hydrated and renders nothing once a profile exists.
 *
 * With no local profile it waits for the session first. A signed-in user (new device, cleared
 * storage) gets the account's profile restored from the server; only when there is none on either
 * side do they go to /onboarding. Redirecting straight away would ask a returning user the
 * questions again, and the new answers would then overwrite the account's profile on sync.
 */
export function ProfileGate() {
  const router = useRouter()
  const hydrated = useProfileStore((s) => s.hydrated)
  const hasProfile = useProfileStore((s) => s.profile !== null)
  const { data: session, isPending } = useSession()
  const userId = session?.user?.id ?? null
  /** The user whose server profile has been looked up on this page. */
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null)
  /** A profile seen and then cleared here (Reset local data) is never restored behind the user's back. */
  const hadProfile = useRef(false)

  useEffect(() => {
    if (hasProfile) {
      hadProfile.current = true
      return
    }
    if (!hydrated || isPending) return
    if (userId && checkedUserId !== userId && !hadProfile.current) {
      const controller = new AbortController()
      api
        .getMe(controller.signal)
        .then((me) => {
          const store = useProfileStore.getState()
          if (me.profile && !store.profile) store.replaceProfile(me.profile)
        })
        .catch(() => {
          // Offline or a server error: fall through to onboarding below.
        })
        .finally(() => {
          if (!controller.signal.aborted) setCheckedUserId(userId)
        })
      return () => controller.abort()
    }
    router.replace("/onboarding")
  }, [hydrated, hasProfile, isPending, userId, checkedUserId, router])

  if (hydrated && hasProfile) return null
  const loading = !hydrated || isPending || (userId !== null && checkedUserId !== userId)
  return <FullScreenSkeleton label={loading ? "Loading your profile" : "Opening setup"} />
}
