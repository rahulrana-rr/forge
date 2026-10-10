"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { bigButtonVariants } from "@/components/app/big-button"
import { useSession } from "@/lib/auth-client"
// Direct import: the "@/lib/store" barrel would ship the engine and exercise library to the landing page.
import { useProfileStore } from "@/lib/store/profile-store"
import { cn } from "@/lib/utils"

/**
 * Primary landing action. Reads the profile store: with a profile, continue today's workout;
 * without one, start onboarding. Sign-in stays secondary because guest mode is first-class.
 */
export function LandingCta() {
  const hydrated = useProfileStore((s) => s.hydrated)
  const hasProfile = useProfileStore((s) => s.profile !== null)
  const ready = hydrated && hasProfile
  const signedIn = Boolean(useSession().data?.user)

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-3" aria-busy={!hydrated || undefined}>
      <Link
        href={ready ? "/today" : "/onboarding"}
        className={cn(bigButtonVariants({ tone: "volt" }), "inline-flex items-center justify-center gap-2 shadow-volt")}
      >
        {ready ? "Continue today's workout" : "Start in 60 seconds"}
        <ArrowRight className="size-5" aria-hidden="true" />
      </Link>
      {signedIn ? null : (
        <Link
          href="/sign-in"
          className="inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
        >
          Sign in
        </Link>
      )}
    </div>
  )
}
