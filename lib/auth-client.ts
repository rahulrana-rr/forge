/**
 * better-auth browser client. Import this from client components only.
 *
 * The named exports below are a contract used by the UI and sync layers:
 *   useSession(), signIn.email / signIn.social / signIn.magicLink, signOut(), signUp.email
 *
 * Email verification and password recovery (lib/auth.ts requires a verified email for password
 * sign-in):
 *   requestPasswordReset({ email, redirectTo }) emails a link to `redirectTo?token=…`;
 *   resetPassword({ newPassword, token }) sets the password and signs out every device;
 *   sendVerificationEmail({ email, callbackURL }) re-sends the confirmation link.
 */
import { magicLinkClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [magicLinkClient()],
  // SyncProvider already flushes on visibilitychange for signed-in users and a 401 moves the sync
  // store to signed_out, so a session refetch on every tab focus only costs guests a request.
  sessionOptions: { refetchOnWindowFocus: false },
})

export const {
  useSession,
  signIn,
  signOut,
  signUp,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
} = authClient
