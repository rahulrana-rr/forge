/**
 * Server-side session helpers for route handlers and server components.
 * Never import from client components.
 */
import { headers } from "next/headers"

import { auth, type ServerSession } from "@/lib/auth"
import { ApiHttpError } from "@/lib/sync/server/errors"

export type { ServerSession }
export type SessionUser = ServerSession["user"]

/** The current better-auth session (from the request cookies), or null when signed out. */
export async function getSession(): Promise<ServerSession | null> {
  return auth.api.getSession({ headers: await headers() })
}

/**
 * Returns the signed-in user or throws an ApiError-shaped 401.
 * Route handlers wrapped in `withApiHandler` turn the throw into a JSON 401 response.
 */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession()
  if (!session)
    throw new ApiHttpError("unauthenticated", "Sign in to continue.", 401)
  return session.user
}
