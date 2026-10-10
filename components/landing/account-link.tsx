"use client"

import Link from "next/link"

import { useSession } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

/** "Sign in" for guests, "Profile" once signed in. Renders the guest label until the session resolves. */
export function AccountLink({ className }: { className?: string }) {
  const { data } = useSession()
  const signedIn = Boolean(data?.user)
  return (
    <Link href={signedIn ? "/profile" : "/sign-in"} className={cn(className)}>
      {signedIn ? "Profile" : "Sign in"}
    </Link>
  )
}
