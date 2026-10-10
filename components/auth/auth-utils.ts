const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}

export const PASSWORD_MIN = 8

interface AuthErrorLike {
  code?: string | undefined
  message?: string | undefined
  status?: number | undefined
}

/** Turns a better-auth error into one plain sentence a person can act on. */
export function describeAuthError(error: AuthErrorLike | null | undefined, fallback: string): string {
  if (!error) return fallback
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
      return "That email and password don't match."
    case "USER_NOT_FOUND":
      return "No account with that email. Create one instead."
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account with that email already exists. Sign in instead."
    case "PASSWORD_TOO_SHORT":
      return `Use at least ${PASSWORD_MIN} characters.`
    case "EMAIL_NOT_VERIFIED":
      return "Check your inbox and verify your email first."
    default:
      break
  }
  if (error.status === 429) return "Too many attempts. Wait a minute and try again."
  if (error.status !== undefined && error.status >= 500) return "The server had a problem. Try again in a moment."
  return error.message?.trim() || fallback
}

/** Network-level failures (offline, DNS) surface as thrown errors rather than `{ error }`. */
export function describeThrown(err: unknown): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You're offline. Your workouts still work; sign in when you're back online."
  }
  if (err instanceof Error && err.message) return err.message
  return "Something went wrong. Try again."
}

/**
 * Message for the `?error=` code better-auth appends when a magic link or Google sign-in fails and
 * redirects back to /sign-in. The code comes from the URL, so only known codes map to text and the
 * raw value is never shown.
 */
export function describeAuthRedirectError(code: string): string {
  switch (code) {
    case "INVALID_TOKEN":
    case "EXPIRED_TOKEN":
    case "ATTEMPTS_EXCEEDED":
      return "That sign-in link has expired or was already used. Each link works once and only for a few minutes. Send a new one."
    case "access_denied":
      return "Google sign-in was cancelled. You're still training as a guest."
    case "account_already_linked_to_different_user":
    case "email_does_not_match":
    case "unable_to_link_account":
      return "That Google account is linked to a different FORGE account."
    case "email_not_found":
      return "Google didn't share an email address, so it can't be used to sign in."
    case "EMAIL_NOT_VERIFIED":
    case "email_not_verified":
      return "Check your inbox and verify your email first."
    case "new_user_signup_disabled":
    case "signup_disabled":
      return "New accounts can't be created right now."
    default:
      return "Sign-in didn't finish. Try again."
  }
}
