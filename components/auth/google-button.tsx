"use client"

import { useState } from "react"

import { signIn } from "@/lib/auth-client"

import { BigButton } from "@/components/app/big-button"
import { describeAuthError, describeThrown } from "@/components/auth/auth-utils"
import { Spinner } from "@/components/ui/spinner"

/** Rendered only when NEXT_PUBLIC_AUTH_GOOGLE === "1" (see .env.example). */
export function GoogleButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setBusy(true)
    setError(null)
    try {
      // Cancelled consent and other OAuth failures come back to /sign-in?error=… (not better-auth's own page).
      const result = await signIn.social({ provider: "google", callbackURL: "/today", errorCallbackURL: "/sign-in" })
      if (result.error) {
        setError(describeAuthError(result.error, "Google sign-in didn't start."))
        setBusy(false)
      }
      // On success the browser is redirected to Google; leave the spinner running.
    } catch (err) {
      setError(describeThrown(err))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <BigButton tone="outline" onClick={onClick} disabled={busy}>
        {busy ? <Spinner className="size-5" /> : <GoogleGlyph />}
        Continue with Google
      </BigButton>
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.6 12.23c0-.68-.06-1.33-.17-1.96H12v3.7h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.32 2.98-7.26Z"
        opacity="0.9"
      />
      <path
        fill="currentColor"
        d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.5c-.9.6-2.04.95-3.38.95-2.6 0-4.8-1.75-5.58-4.1H3.07v2.58A10 10 0 0 0 12 22Z"
        opacity="0.75"
      />
      <path
        fill="currentColor"
        d="M6.42 13.92A6 6 0 0 1 6.1 12c0-.67.12-1.31.32-1.92V7.5H3.07a10 10 0 0 0 0 8.99l3.35-2.58Z"
        opacity="0.6"
      />
      <path
        fill="currentColor"
        d="M12 5.98c1.47 0 2.78.5 3.82 1.5l2.86-2.86A10 10 0 0 0 3.07 7.5l3.35 2.58C7.2 7.73 9.4 5.98 12 5.98Z"
        opacity="0.85"
      />
    </svg>
  )
}
