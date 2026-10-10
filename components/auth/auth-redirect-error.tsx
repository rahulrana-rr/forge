"use client"

import { useSearchParams } from "next/navigation"

import { useSession } from "@/lib/auth-client"

import { describeAuthRedirectError } from "@/components/auth/auth-utils"

/**
 * Explains a failed magic link or Google sign-in. better-auth redirects those failures to
 * /sign-in?error=<code> (see errorCallbackURL in the forms). Hidden once a session exists.
 * Render inside <Suspense>: it reads search params on a static page.
 */
export function AuthRedirectError() {
  const code = useSearchParams().get("error")
  const { data } = useSession()
  if (!code || data?.user) return null
  return (
    <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
      {describeAuthRedirectError(code)}
    </p>
  )
}
