import type { ReactNode } from "react"

import { BottomNav } from "@/components/app/bottom-nav"
import { ProfileGate } from "@/components/app/profile-gate"
import { SyncProvider } from "@/components/app/sync-provider"

/**
 * Shell for every route under app/(app): page content padded for the bottom nav,
 * the nav itself, the background sync provider and the onboarding gate.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen-safe pb-nav">
      <main id="main" className="mx-auto w-full max-w-lg px-5 pt-safe">
        {children}
      </main>
      <BottomNav />
      <SyncProvider />
      <ProfileGate />
    </div>
  )
}
