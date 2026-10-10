"use client"

import { Switch } from "@/components/ui/switch"
import { useCoachStore } from "@/lib/coach/store"
import { haptic } from "@/lib/haptics"

import { SectionCard } from "./section-card"

/** Turn the coach review on or off, and say plainly what it sends. */
export function CoachSection() {
  const enabled = useCoachStore((s) => s.enabled)
  const hydrated = useCoachStore((s) => s.hydrated)

  return (
    <SectionCard id="coach" title="Coach review">
      <div className="flex flex-col divide-y divide-border">
        <label className="flex min-h-14 cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold">Review each workout before I start</span>
            <span className="text-xs text-muted-foreground">
              A senior-coach check of exercise choice, volume, rest and safety, with corrections applied before you start.
            </span>
          </span>
          <Switch
            checked={enabled}
            disabled={!hydrated}
            onCheckedChange={(checked) => {
              haptic("tick")
              useCoachStore.getState().setEnabled(checked)
            }}
            className="data-checked:bg-volt"
          />
        </label>
        <p className="px-5 py-4 text-xs leading-relaxed text-muted-foreground">
          The review is done by Claude, an AI model from Anthropic. FORGE sends today&apos;s plan and the training details it
          needs: goal, experience, body weight, gender, schedule, equipment, the areas you asked to protect, and a summary of the
          last week of training. Nothing is stored with the review. It is coaching guidance, not medical advice.
        </p>
      </div>
    </SectionCard>
  )
}
