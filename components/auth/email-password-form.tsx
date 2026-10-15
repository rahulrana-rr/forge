"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, MailCheck } from "lucide-react"

import { requestPasswordReset, sendVerificationEmail, signIn, signUp } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"

import { BigButton } from "@/components/app/big-button"
import { AuthField } from "@/components/auth/auth-field"
import { describeAuthError, describeThrown, isValidEmail, PASSWORD_MIN } from "@/components/auth/auth-utils"
import { Spinner } from "@/components/ui/spinner"

export type AuthMode = "sign-in" | "sign-up"

/** Where email links (verification) land once opened. */
const AFTER_AUTH_URL = "/today"

interface FieldErrors {
  name?: string
  email?: string
  password?: string
}

export function EmailPasswordForm({ mode }: { mode: AuthMode }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Sign-up succeeded but the email must be confirmed first: the address the link went to. */
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  /** Sign-in failed in a way a one-time email link gets past (wrong password, unverified email). */
  const [offerLink, setOfferLink] = useState(false)

  function validate(): boolean {
    const next: FieldErrors = {}
    if (mode === "sign-up" && name.trim().length === 0) next.name = "Tell us what to call you."
    if (!isValidEmail(email)) next.email = "Enter a valid email address."
    if (password.length < PASSWORD_MIN) next.password = `Use at least ${PASSWORD_MIN} characters.`
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    setNotice(null)
    setOfferLink(false)
    if (!validate()) {
      haptic("warning")
      return
    }
    setBusy(true)
    try {
      const trimmedEmail = email.trim()
      if (mode === "sign-in") {
        const result = await signIn.email({ email: trimmedEmail, password, callbackURL: AFTER_AUTH_URL })
        if (result.error) {
          // An unverified account: better-auth has just re-sent the confirmation link.
          setFormError(
            result.error.code === "EMAIL_NOT_VERIFIED"
              ? `Confirm your email first. We sent a new link to ${trimmedEmail} (check spam too).`
              : describeAuthError(result.error, "Couldn't sign you in.")
          )
          // A forgotten password or an unconfirmed address is the usual cause: a sign-in link fixes
          // both, because opening it proves the mailbox and confirms the email.
          const code = result.error.code
          setOfferLink(code === "EMAIL_NOT_VERIFIED" || code === "INVALID_EMAIL_OR_PASSWORD" || code === "INVALID_PASSWORD")
          haptic("warning")
          return
        }
        haptic("success")
        router.replace(AFTER_AUTH_URL)
        return
      }
      const result = await signUp.email({
        name: name.trim(),
        email: trimmedEmail,
        password,
        callbackURL: AFTER_AUTH_URL,
      })
      if (result.error) {
        setFormError(describeAuthError(result.error, "Couldn't create your account."))
        haptic("warning")
        return
      }
      // Email verification is required: no session until the emailed link is opened. (An address
      // that already has an account gets the same answer and a "you already have an account" email.)
      if (!result.data?.token) {
        haptic("success")
        setVerifyEmail(trimmedEmail)
        return
      }
      haptic("success")
      router.replace(AFTER_AUTH_URL)
    } catch (err) {
      setFormError(describeThrown(err))
    } finally {
      setBusy(false)
    }
  }

  async function onForgotPassword() {
    setFormError(null)
    setNotice(null)
    if (!isValidEmail(email)) {
      setErrors({ email: "Enter your email address first, then tap Forgot password." })
      haptic("warning")
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const trimmedEmail = email.trim()
      const result = await requestPasswordReset({ email: trimmedEmail, redirectTo: "/reset-password" })
      if (result.error) {
        setFormError(describeAuthError(result.error, "Couldn't send a reset link."))
        haptic("warning")
        return
      }
      setNotice(`If ${trimmedEmail} has a FORGE account, a link to choose a new password is on its way.`)
    } catch (err) {
      setFormError(describeThrown(err))
    } finally {
      setBusy(false)
    }
  }

  async function onSendLink() {
    const trimmedEmail = email.trim()
    if (!isValidEmail(trimmedEmail)) return
    setBusy(true)
    setFormError(null)
    try {
      const result = await signIn.magicLink({ email: trimmedEmail, callbackURL: AFTER_AUTH_URL, errorCallbackURL: "/sign-in" })
      if (result.error) {
        setFormError(describeAuthError(result.error, "Couldn't send a sign-in link."))
        haptic("warning")
        return
      }
      haptic("success")
      setOfferLink(false)
      setNotice(`Sign-in link sent to ${trimmedEmail}. Open it on this device within 15 minutes. Not there? Check spam.`)
    } catch (err) {
      setFormError(describeThrown(err))
    } finally {
      setBusy(false)
    }
  }

  async function onResend() {
    if (!verifyEmail) return
    setResending(true)
    setFormError(null)
    try {
      const result = await sendVerificationEmail({ email: verifyEmail, callbackURL: AFTER_AUTH_URL })
      if (result.error) setFormError(describeAuthError(result.error, "Couldn't resend the link."))
      else setNotice("Sent again. Check your inbox and spam folder.")
    } catch (err) {
      setFormError(describeThrown(err))
    } finally {
      setResending(false)
    }
  }

  if (verifyEmail) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-live="polite">
        <div className="flex items-start gap-3 rounded-2xl bg-surface-2 p-4">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-volt-ink" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="font-heading text-lg leading-tight font-bold tracking-tight">Check your inbox</p>
            <p className="text-sm text-muted-foreground">
              We sent a link to <span className="font-semibold text-foreground">{verifyEmail}</span>. Open it to confirm your
              account and sign in. Until then you can keep training as a guest.
            </p>
          </div>
        </div>
        {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
        {formError ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
            {formError}
          </p>
        ) : null}
        <BigButton type="button" tone="neutral" onClick={onResend} disabled={resending}>
          {resending ? <Spinner className="size-5" /> : null}
          Resend the link
        </BigButton>
        <button
          type="button"
          onClick={() => {
            setVerifyEmail(null)
            setNotice(null)
            setFormError(null)
          }}
          className="h-11 rounded-xl text-sm font-semibold text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring"
        >
          Use a different email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-busy={busy || undefined}>
      {mode === "sign-up" ? (
        <AuthField
          label="Name"
          name="name"
          autoComplete="name"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
      ) : null}
      <AuthField
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
      />
      <AuthField
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        placeholder={mode === "sign-in" ? "Your password" : `At least ${PASSWORD_MIN} characters`}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
      />
      {mode === "sign-in" ? (
        <button
          type="button"
          onClick={onForgotPassword}
          disabled={busy}
          className="-mt-1 h-11 w-fit rounded-xl px-1 text-sm font-semibold text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-60"
        >
          Forgot password?
        </button>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {formError ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {formError}
        </p>
      ) : null}
      {offerLink ? (
        <BigButton type="button" tone="neutral" onClick={onSendLink} disabled={busy}>
          Email me a sign-in link instead
        </BigButton>
      ) : null}
      <BigButton type="submit" disabled={busy} className="mt-2">
        {busy ? <Spinner className="size-5" /> : null}
        {mode === "sign-in" ? "Sign in" : "Create account"}
        {!busy ? <ArrowRight aria-hidden="true" /> : null}
      </BigButton>
    </form>
  )
}
