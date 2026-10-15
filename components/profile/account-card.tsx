"use client"

import { useState } from "react"
import { CloudOff, HardDriveUpload, LogOut, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { StorageNotice } from "@/components/app/storage-notice"
import { LinkButton } from "@/components/history/link-button"
import { isoToDateKey } from "@/components/progress/format"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { signOut, useSession } from "@/lib/auth-client"
import { formatDateKey } from "@/lib/dates"
import { haptic } from "@/lib/haptics"
import { useProgramStore } from "@/lib/programs/store"
import {
  useHistoryStore,
  useProfileStore,
  useSyncStore,
  useWorkoutStore,
  type SyncStatus,
} from "@/lib/store"
import { FOREIGN_DATA_MESSAGE } from "@/lib/sync/sync-store"
import { cn } from "@/lib/utils"

import { useNow } from "./use-now"

type Tone = "ok" | "busy" | "muted" | "bad"

const TONE_DOT: Record<Tone, string> = {
  ok: "bg-success",
  busy: "bg-info animate-pulse-soft",
  muted: "bg-muted-foreground/50",
  bad: "bg-destructive",
}

function relativeTime(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso))
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `on ${formatDateKey(isoToDateKey(iso))}`
}

function describeSync(
  status: SyncStatus,
  pendingCount: number,
  lastCompletedAt: string | null,
  lastError: string | null,
  now: number,
): { text: string; tone: Tone } {
  switch (status) {
    case "syncing":
      return { text: "Syncing…", tone: "busy" }
    case "offline":
      return { text: pendingCount ? `Offline · ${pendingCount} waiting to sync` : "Offline", tone: "muted" }
    case "error":
      return { text: lastError ?? "Sync failed", tone: "bad" }
    case "signed_out":
      return { text: "Not syncing", tone: "muted" }
    case "idle":
      if (pendingCount) return { text: `${pendingCount} waiting to sync`, tone: "busy" }
      return { text: lastCompletedAt ? `Synced ${relativeTime(lastCompletedAt, now)}` : "Up to date", tone: "ok" }
  }
}

function initialsOf(name: string, email: string): string {
  const source = name.trim() || email
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ""
  const second = parts.length > 1 ? (parts[1]?.[0] ?? "") : ""
  return (first + second).toUpperCase() || "?"
}

/** Signed-in: avatar, identity, sync state, Sync now / Sign out. Signed-out: invitation to sign in. */
export function AccountCard() {
  const { data, isPending } = useSession()
  const status = useSyncStore((s) => s.status)
  const pendingCount = useSyncStore((s) => s.pendingCount)
  // Wall-clock time of the last completed sync; lastSyncedAt is the server's pull cursor.
  const lastCompletedAt = useSyncStore((s) => s.lastCompletedAt)
  const lastError = useSyncStore((s) => s.lastError)
  const flush = useSyncStore((s) => s.flush)
  const setSignedIn = useSyncStore((s) => s.setSignedIn)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [adopting, setAdopting] = useState(false)
  const now = useNow()

  if (isPending) {
    return (
      <div className="surface-card flex items-center gap-4 rounded-3xl p-5" role="status" aria-label="Checking sign-in">
        <Skeleton className="size-12 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-1/2 rounded-full" />
          <Skeleton className="h-3 w-2/3 rounded-full" />
        </div>
      </div>
    )
  }

  const user = data?.user
  if (!user) {
    return (
      <div className="surface-card flex flex-col gap-4 rounded-3xl p-5">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-volt/12 text-volt-ink" aria-hidden="true">
            <CloudOff className="size-6" />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-lg leading-tight font-bold tracking-tight">Sign in to sync across devices</h2>
            <p className="text-sm text-muted-foreground">
              Everything works as a guest. Signing in backs up your history and profile to your account.
            </p>
          </div>
        </div>
        <LinkButton href="/sign-in">Sign in</LinkButton>
        <StorageNotice />
      </div>
    )
  }

  const displayName = user.name?.trim() || user.email
  const sync = describeSync(status, pendingCount, lastCompletedAt, lastError, now)
  const foreignData = status === "error" && lastError === FOREIGN_DATA_MESSAGE

  function handleSync() {
    haptic("tap")
    flush().catch(() => {
      // Failures surface through the sync store's status.
    })
  }

  function handleAdopt() {
    setAdopting(true)
    haptic("tap")
    useSyncStore
      .getState()
      .adoptLocalData()
      .catch(() => {
        // Failures surface through the sync store's status.
      })
      .finally(() => setAdopting(false))
  }

  async function handleSignOut(removeData: boolean) {
    setSignOutOpen(false)
    setSigningOut(true)
    try {
      // better-auth reports HTTP failures as `{ error }` and only throws on network errors.
      const { error } = await signOut()
      if (error) {
        toast.error("Could not sign out. You are still signed in; try again.")
        return
      }
      // The sync store keeps the cursor with the account that owns the local data: signing back in
      // to the same account resumes it, and a different account starts over with a full pull.
      setSignedIn(false)
      useProgramStore.getState().clear()
      if (removeData) {
        useWorkoutStore.getState().discard()
        useHistoryStore.getState().clearAll()
        useProfileStore.getState().clearProfile()
        toast("Signed out", { description: "This account's data was removed from this device." })
      } else {
        toast("Signed out", { description: "Your workouts stay on this device." })
      }
    } catch {
      toast.error("Could not sign out. Check your connection and try again.")
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="surface-card flex flex-col gap-4 rounded-3xl p-5">
      <div className="flex items-center gap-4">
        <Avatar size="lg" className="size-12">
          <AvatarImage src={user.image ?? undefined} alt="" />
          <AvatarFallback className="bg-volt/12 text-base font-bold text-volt-ink">{initialsOf(user.name ?? "", user.email)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-lg font-bold tracking-tight">{displayName}</p>
          {displayName !== user.email ? <p className="truncate text-sm text-muted-foreground">{user.email}</p> : null}
        </div>
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
        <span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[sync.tone])} aria-hidden="true" />
        <span className={cn(!foreignData && "truncate")}>{sync.text}</span>
      </p>
      {foreignData ? (
        <div className="flex flex-col gap-2">
          <Button className="h-11 rounded-xl" onClick={handleAdopt} disabled={adopting}>
            <HardDriveUpload />
            Use this device&apos;s data for this account
          </Button>
          <a
            href="#data"
            className="rounded-md text-center text-sm font-medium text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
          >
            Or reset local data in Profile › Data
          </a>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11 rounded-xl" onClick={handleSync} disabled={status === "syncing"}>
          <RefreshCw className={cn(status === "syncing" && "animate-spin")} />
          {status === "syncing" ? "Syncing…" : "Sync now"}
        </Button>
        <Button variant="ghost" className="h-11 rounded-xl" onClick={() => setSignOutOpen(true)} disabled={signingOut}>
          <LogOut />
          Sign out
        </Button>
      </div>
      <Dialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <DialogContent showCloseButton={false} className="rounded-3xl p-5">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl font-bold tracking-tight">Sign out?</DialogTitle>
            <DialogDescription>
              Your workouts and profile stay on this device unless you remove them. Removing is right for a shared device.
              {pendingCount > 0
                ? ` ${pendingCount} ${pendingCount === 1 ? "workout has" : "workouts have"} not synced yet and would be lost.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="-mx-5 -mb-5 flex-col gap-2 rounded-b-3xl p-4 sm:flex-col">
            <Button className="h-11 w-full rounded-xl" onClick={() => void handleSignOut(false)}>
              Sign out
            </Button>
            <Button variant="destructive" className="h-11 w-full rounded-xl" onClick={() => void handleSignOut(true)}>
              Sign out and remove data from this device
            </Button>
            <DialogClose render={<Button variant="outline" className="h-11 w-full rounded-xl" />}>Cancel</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
