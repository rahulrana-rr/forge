"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Download, Trash } from "lucide-react"
import { toast } from "sonner"

import { TIMER_SOUND_KEY } from "@/hooks/use-timer-sound"
import { ConfirmDialog } from "@/components/history/confirm-dialog"
import { todayKey } from "@/lib/dates"
import type { Units } from "@/lib/domain/types"
import { haptic } from "@/lib/haptics"
import { useHistoryStore, useProfileStore, useSyncStore, useWorkoutStore } from "@/lib/store"

import { SectionCard } from "./section-card"
import { SettingRow } from "./setting-row"

/** Export history as a JSON download; wipe everything local after confirmation. */
export function DataSection({
  workoutCount,
  units,
}: {
  workoutCount: number
  units: Units
}) {
  const router = useRouter()
  const [resetOpen, setResetOpen] = useState(false)

  function exportHistory() {
    const { workouts, progress } = useHistoryStore.getState()
    const payload = {
      app: "forge",
      format: 1,
      exportedAt: new Date().toISOString(),
      units,
      note: "Weights are in kilograms.",
      workouts,
      progress,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `forge-history-${todayKey()}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    haptic("success")
    toast.success("History exported", {
      description: `${workouts.length} ${workouts.length === 1 ? "workout" : "workouts"} as JSON.`,
    })
  }

  function resetLocalData() {
    useWorkoutStore.getState().discard()
    useHistoryStore.getState().clearAll()
    useProfileStore.getState().clearProfile()
    // Forget the sync cursor too, so the next sync pulls every workout already in the account
    // instead of only those changed since the last sync (which would leave history empty here).
    useSyncStore.getState().resetCursor()
    try {
      window.localStorage.removeItem(TIMER_SOUND_KEY)
    } catch {
      // Storage unavailable; nothing to clear.
    }
    haptic("warning")
    toast("Local data cleared")
    router.replace("/onboarding")
  }

  return (
    <SectionCard id="data" title="Data">
      <div className="flex flex-col divide-y divide-border">
        <SettingRow
          label="Export history (JSON)"
          hint={`${workoutCount} ${workoutCount === 1 ? "workout" : "workouts"} on this device`}
          onClick={exportHistory}
          trailing={
            <Download
              className="size-5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          }
        />
        <SettingRow
          label="Reset local data"
          hint="Profile, history and today's plan on this device"
          destructive
          onClick={() => setResetOpen(true)}
          trailing={
            <Trash
              className="size-5 shrink-0 text-destructive"
              aria-hidden="true"
            />
          }
        />
      </div>
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset local data?"
        description="This deletes your profile, workout history and today's plan from this device and takes you back to setup. Workouts already synced stay in your account and come back here on the next sync."
        confirmLabel="Reset"
        destructive
        onConfirm={resetLocalData}
      />
    </SectionCard>
  )
}
