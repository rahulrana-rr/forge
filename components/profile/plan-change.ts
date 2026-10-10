import { toast } from "sonner"

import { haptic } from "@/lib/haptics"
import { useWorkoutStore } from "@/lib/store"

/** One toast id so repeated edits update the same toast instead of stacking. */
export const PLAN_CHANGE_TOAST_ID = "forge-plan-change"

/** Regenerates today's workout if it has not been started; otherwise explains why not. */
export function regenerateToday(): void {
  const store = useWorkoutStore.getState()
  if (store.active?.status !== "ready") {
    toast("Today's workout is already under way", { id: PLAN_CHANGE_TOAST_ID })
    return
  }
  store.regenerate()
  haptic("success")
  toast.success("Today's workout regenerated", { id: PLAN_CHANGE_TOAST_ID })
}

/**
 * Tells the user a training change applies from tomorrow. Today's active workout is never
 * regenerated automatically; while it is still "ready" the toast offers a one-tap regenerate.
 */
export function notifyPlanChange(): void {
  const canRegenerate = useWorkoutStore.getState().active?.status === "ready"
  toast("Tomorrow's workout will use this", {
    id: PLAN_CHANGE_TOAST_ID,
    description: canRegenerate ? "Today's plan stays as it is unless you regenerate it." : undefined,
    action: canRegenerate ? { label: "Regenerate today", onClick: regenerateToday } : undefined,
  })
}
