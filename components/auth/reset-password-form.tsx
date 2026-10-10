"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

import { BigButton } from "@/components/app/big-button"
import { AuthField } from "@/components/auth/auth-field"
import {
  describeAuthError,
  describeThrown,
  PASSWORD_MIN,
} from "@/components/auth/auth-utils"
import { Spinner } from "@/components/ui/spinner"
import { resetPassword } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"

const EXPIRED =
  "This reset link has expired or was already used. Request a new one from Sign in › Forgot password."

/** Sets a new password from the emailed reset link (`?token=…`, or `?error=INVALID_TOKEN`). */
export function ResetPasswordForm() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get("token")
  const linkError = params.get("error")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>(
    {}
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!token || linkError) {
    return (
      <div className="flex flex-col gap-4">
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
        >
          {EXPIRED}
        </p>
        <BigButton nativeButton={false} render={<Link href="/sign-in" />}>
          Back to sign in
        </BigButton>
      </div>
    )
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    const next: { password?: string; confirm?: string } = {}
    if (password.length < PASSWORD_MIN)
      next.password = `Use at least ${PASSWORD_MIN} characters.`
    if (confirm !== password) next.confirm = "The two passwords don't match."
    setErrors(next)
    if (Object.keys(next).length > 0) {
      haptic("warning")
      return
    }
    setBusy(true)
    try {
      const result = await resetPassword({
        newPassword: password,
        token: token ?? "",
      })
      if (result.error) {
        setFormError(
          result.error.code === "INVALID_TOKEN"
            ? EXPIRED
            : describeAuthError(result.error, "Couldn't set the new password.")
        )
        haptic("warning")
        return
      }
      haptic("success")
      toast.success("Password updated", {
        description: "Sign in with your new password.",
      })
      router.replace("/sign-in")
    } catch (err) {
      setFormError(describeThrown(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
      aria-busy={busy || undefined}
    >
      <AuthField
        label="New password"
        name="new-password"
        type="password"
        autoComplete="new-password"
        placeholder={`At least ${PASSWORD_MIN} characters`}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
      />
      <AuthField
        label="Repeat it"
        name="confirm-password"
        type="password"
        autoComplete="new-password"
        placeholder="Same password again"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={errors.confirm}
      />
      {formError ? (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
        >
          {formError}
        </p>
      ) : null}
      <BigButton type="submit" disabled={busy} className="mt-2">
        {busy ? <Spinner className="size-5" /> : null}
        Save new password
      </BigButton>
    </form>
  )
}
