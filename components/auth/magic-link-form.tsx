"use client"

import { useState, type FormEvent } from "react"
import { Mail } from "lucide-react"

import { signIn } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"

import { BigButton } from "@/components/app/big-button"
import { AuthField } from "@/components/auth/auth-field"
import { describeAuthError, describeThrown, isValidEmail } from "@/components/auth/auth-utils"
import { Spinner } from "@/components/ui/spinner"

/** Passwordless alternative: one email field, one button, a "check your inbox" state. */
export function MagicLinkForm() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    if (!isValidEmail(email)) {
      setFieldError("Enter a valid email address.")
      haptic("warning")
      return
    }
    setFieldError(null)
    setBusy(true)
    try {
      const trimmed = email.trim()
      // Expired, reused or scanner-consumed links come back to /sign-in?error=… instead of
      // landing on /today as a guest with no explanation.
      const result = await signIn.magicLink({ email: trimmed, callbackURL: "/today", errorCallbackURL: "/sign-in" })
      if (result.error) {
        setFormError(describeAuthError(result.error, "Couldn't send the link."))
        return
      }
      haptic("success")
      setSentTo(trimmed)
    } catch (err) {
      setFormError(describeThrown(err))
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <div role="status" className="surface-card flex items-start gap-4 rounded-3xl p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-volt/12 text-volt-ink">
          <Mail className="size-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-heading text-lg font-bold tracking-tight">Check your inbox</p>
          <p className="text-sm text-muted-foreground">
            We sent a sign-in link to <span className="font-semibold text-foreground">{sentTo}</span>. It works on this
            device or any other.
          </p>
          <button
            type="button"
            onClick={() => setSentTo(null)}
            className="mt-1 w-fit text-sm font-semibold text-volt-ink underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
          >
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  if (!open) {
    return (
      <BigButton tone="outline" onClick={() => setOpen(true)} aria-expanded={false} aria-controls="magic-link-form">
        <Mail aria-hidden="true" />
        Email me a magic link
      </BigButton>
    )
  }

  return (
    <form id="magic-link-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-busy={busy || undefined}>
      <AuthField
        label="Email for the link"
        name="magic-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldError}
        autoFocus
      />
      {formError ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {formError}
        </p>
      ) : null}
      <BigButton type="submit" tone="neutral" disabled={busy}>
        {busy ? <Spinner className="size-5" /> : <Mail aria-hidden="true" />}
        Send magic link
      </BigButton>
    </form>
  )
}
