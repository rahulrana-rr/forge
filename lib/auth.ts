/**
 * better-auth server instance. Server-only: never import this from client components
 * (use lib/auth-client.ts there).
 *
 * Methods: email + password, Google OAuth (only when GOOGLE_CLIENT_ID/SECRET are set) and
 * magic links. Auth emails (magic link, email verification, password reset) are delivered via the
 * Resend HTTP API when RESEND_API_KEY is set and logged to the server console in development
 * otherwise.
 *
 * Password accounts must verify their email before they can sign in. Without that, every
 * password user stays `emailVerified: false`, and better-auth treats such an account as
 * unproven: a magic-link sign-in for the same email deletes its password and sessions, and
 * Google refuses to link to it.
 */
import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { nextCookies } from "better-auth/next-js"
import { magicLink } from "better-auth/plugins"

import { prisma } from "@/lib/prisma"

const DAY_SECONDS = 60 * 60 * 24
const HOUR_SECONDS = 60 * 60
/** 15 minutes (better-auth's default is 5): long enough to fish the email out of a spam folder. The email quotes it. */
const MAGIC_LINK_TTL_SECONDS = 15 * 60
const VERIFY_EMAIL_TTL_SECONDS = HOUR_SECONDS
const RESET_PASSWORD_TTL_SECONDS = HOUR_SECONDS

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

interface AuthEmail {
  to: string
  subject: string
  heading: string
  /** One or two plain sentences above the button. */
  intro: string
  /** The call to action; omitted for purely informational emails. */
  action?: { label: string; url: string }
  /** What to do if the email was not expected. */
  footer: string
  /** Development-only console line used when no email provider is configured. */
  devLog: string
}

/**
 * Delivers an auth email. With RESEND_API_KEY set it posts to Resend's REST API; without it the
 * email is summarised on the server console in non-production so local sign-in still works.
 */
async function sendAuthEmail(email: AuthEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (apiKey) {
    const from = process.env.EMAIL_FROM ?? "FORGE <onboarding@resend.dev>"
    const action = email.action
    const safeUrl = action ? escapeHtml(action.url) : ""
    const text = [
      email.intro,
      action ? `${action.label}: ${action.url}` : null,
      email.footer,
    ]
      .filter((part): part is string => part !== null)
      .join("\n\n")
    const html = [
      '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#141518">',
      `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(email.heading)}</h1>`,
      `<p style="margin:0 0 20px">${escapeHtml(email.intro)}</p>`,
      action
        ? `<a href="${safeUrl}" style="display:inline-block;background:#c6ff3d;color:#141518;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:12px">${escapeHtml(action.label)}</a>`
        : "",
      action
        ? `<p style="margin:24px 0 0;font-size:12px;color:#6b7280">Or paste this link into your browser:<br><a href="${safeUrl}" style="color:#6b7280">${safeUrl}</a></p>`
        : "",
      `<p style="margin:16px 0 0;font-size:12px;color:#6b7280">${escapeHtml(email.footer)}</p>`,
      "</div>",
    ].join("")

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        text,
        html,
      }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      throw new Error(
        `Resend rejected the "${email.subject}" email (${response.status}): ${detail}`
      )
    }
    return
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "RESEND_API_KEY is not set: auth emails cannot be delivered in production."
    )
  }

  // Development fallback: surface the link on the server console so local sign-in works without email.
  console.log(`[auth] ${email.devLog}`)
}

/**
 * Absolute URL of an app page for emails, from configuration only. The request's Host header is
 * never used: it is caller-controlled and would let anyone point the link at another site.
 */
function appUrl(path: string): string | null {
  const base = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL
  if (!base) return null
  try {
    return new URL(path, base).toString()
  } catch {
    return null
  }
}

const IGNORE_FOOTER = "If you did not request this, you can ignore this email."

async function sendMagicLink({
  email,
  url,
}: {
  email: string
  url: string
}): Promise<void> {
  await sendAuthEmail({
    to: email,
    subject: "Your FORGE sign-in link",
    heading: "Sign in to FORGE",
    intro: "Tap the button to sign in. The link expires in 15 minutes and works once.",
    action: { label: "Sign in", url },
    footer: IGNORE_FOOTER,
    devLog: `Magic link for ${email}: ${url}`,
  })
}

async function sendVerificationEmail({
  user,
  url,
}: {
  user: { email: string }
  url: string
}): Promise<void> {
  await sendAuthEmail({
    to: user.email,
    subject: "Confirm your FORGE email",
    heading: "Confirm your email",
    intro:
      "Tap the button to confirm this address and sign in to FORGE. The link expires in 1 hour.",
    action: { label: "Confirm email", url },
    footer: "If you did not create a FORGE account, you can ignore this email.",
    devLog: `Email verification link for ${user.email}: ${url}`,
  })
}

async function sendResetPassword({
  user,
  url,
}: {
  user: { email: string }
  url: string
}): Promise<void> {
  await sendAuthEmail({
    to: user.email,
    subject: "Reset your FORGE password",
    heading: "Reset your password",
    intro:
      "Tap the button to choose a new password. The link expires in 1 hour. Setting a new password signs you out on every device.",
    action: { label: "Choose a new password", url },
    footer: `${IGNORE_FOOTER} Your password stays the same.`,
    devLog: `Password reset link for ${user.email}: ${url}`,
  })
}

/**
 * Sign-up with an email that already has an account. With email verification required,
 * better-auth answers such a sign-up exactly like a new one (so accounts cannot be probed), which
 * means this email is the only signal the person gets.
 */
async function notifyExistingUserSignUp({
  user,
}: {
  user: { email: string }
}): Promise<void> {
  const signInUrl = appUrl("/sign-in")
  await sendAuthEmail({
    to: user.email,
    subject: "You already have a FORGE account",
    heading: "You already have an account",
    intro:
      "Someone, probably you, tried to create a FORGE account with this email, but one already exists. Sign in instead, with your password or a one-time sign-in link by email.",
    action: signInUrl ? { label: "Sign in", url: signInUrl } : undefined,
    footer:
      "If this was not you, no action is needed: nothing about your account changed.",
    devLog: `Sign-up attempted for existing account ${user.email}`,
  })
}

/**
 * A completed password reset proves control of the mailbox, so the email counts as verified
 * (otherwise the user would reset and then be told to verify). Safe because the reset also
 * revokes every session (revokeSessionsOnPasswordReset), so nothing that predates the proof
 * keeps access.
 */
async function markEmailVerifiedAfterReset({
  user,
}: {
  user: { id: string; emailVerified: boolean }
}): Promise<void> {
  if (user.emailVerified) return
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true },
  })
}

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET
const google =
  googleClientId && googleClientSecret
    ? { clientId: googleClientId, clientSecret: googleClientSecret }
    : undefined

const trustedOrigins = [process.env.NEXT_PUBLIC_APP_URL].filter(
  (origin): origin is string => Boolean(origin)
)

/** Shortest secret accepted in production (`openssl rand -base64 32` gives 44 characters). */
const MIN_SECRET_LENGTH = 32
const PLACEHOLDER_SECRETS = new Set(["replace-me", "changeme", "secret"])

/**
 * better-auth only refuses an empty secret or its own default. With `cookieCache` on, anyone who
 * knows the secret can sign a session cookie for any user, so a template placeholder or a short
 * value must not reach production. Skipped while `next build` collects page data.
 */
function assertProductionSecret(secret: string | undefined): void {
  if (process.env.NODE_ENV !== "production") return
  if (process.env.NEXT_PHASE === "phase-production-build") return
  if (
    !secret ||
    secret.length < MIN_SECRET_LENGTH ||
    PLACEHOLDER_SECRETS.has(secret.trim().toLowerCase())
  ) {
    throw new Error(
      `BETTER_AUTH_SECRET must be set to a random value of at least ${MIN_SECRET_LENGTH} characters in production (openssl rand -base64 32).`
    )
  }
}

assertProductionSecret(process.env.BETTER_AUTH_SECRET)

export const auth = betterAuth({
  appName: "FORGE",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // Sign-up answers with `token: null` and no session until the emailed link is opened; a
    // password sign-in before that fails with EMAIL_NOT_VERIFIED and re-sends the link.
    requireEmailVerification: true,
    onExistingUserSignUp: notifyExistingUserSignUp,
    sendResetPassword,
    resetPasswordTokenExpiresIn: RESET_PASSWORD_TTL_SECONDS,
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: markEmailVerifiedAfterReset,
  },
  emailVerification: {
    sendVerificationEmail,
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: VERIFY_EMAIL_TTL_SECONDS,
  },
  socialProviders: google ? { google } : undefined,
  session: {
    expiresIn: 30 * DAY_SECONDS,
    updateAge: DAY_SECONDS,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  // nextCookies must stay the LAST plugin so it can set cookies from server actions / route handlers.
  plugins: [
    magicLink({ sendMagicLink, expiresIn: MAGIC_LINK_TTL_SECONDS }),
    nextCookies(),
  ],
})

export type ServerSession = typeof auth.$Infer.Session
