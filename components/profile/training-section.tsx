"use client"

import { useState } from "react"
import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { UserProfile } from "@/lib/domain/types"
import { DIFFICULTY_LABELS, GOAL_LABELS } from "@/lib/exercises/types"
import { haptic } from "@/lib/haptics"
import { useProfileStore, useWorkoutStore } from "@/lib/store"
import { formatWeight } from "@/lib/units"

import { OptionDrawer } from "./option-drawer"
import {
  DAYS_HINTS,
  DAYS_OPTIONS,
  DURATION_OPTIONS,
  EXPERIENCE_OPTIONS,
  GENDER_LABELS,
  GENDER_OPTIONS,
  GOAL_OPTIONS,
} from "./options"
import { notifyPlanChange, regenerateToday } from "./plan-change"
import { SectionCard } from "./section-card"
import { Segmented } from "./segmented"
import { SettingRow } from "./setting-row"
import { WeightDrawer } from "./weight-drawer"

type Editing = "goal" | "experience" | "gender" | "weight" | null

type ProfilePatch = Partial<Omit<UserProfile, "id" | "createdAt">>

/** Goal, experience, days, length, gender and body weight. Plan-affecting edits apply from tomorrow. */
export function TrainingSection({ profile }: { profile: UserProfile }) {
  const updateProfile = useProfileStore((s) => s.updateProfile)
  const workoutStatus = useWorkoutStore((s) => s.active?.status)
  const [editing, setEditing] = useState<Editing>(null)
  // Bumped each time the weight editor opens so its input starts from the saved value.
  const [weightSession, setWeightSession] = useState(0)

  function save(patch: ProfilePatch, affectsPlan: boolean) {
    updateProfile(patch)
    haptic("success")
    if (affectsPlan) notifyPlanChange()
  }

  function closeIfClosing(open: boolean) {
    if (!open) setEditing(null)
  }

  return (
    <SectionCard id="training" title="Training">
      <div className="flex flex-col divide-y divide-border">
        <SettingRow label="Goal" value={GOAL_LABELS[profile.goal]} onClick={() => setEditing("goal")} />
        <SettingRow label="Experience" value={DIFFICULTY_LABELS[profile.experience]} onClick={() => setEditing("experience")} />

        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">Days per week</span>
            <span className="text-xs text-muted-foreground">{DAYS_HINTS[profile.trainingDaysPerWeek]}</span>
          </div>
          <Segmented
            label="Days per week"
            options={DAYS_OPTIONS}
            value={profile.trainingDaysPerWeek}
            onChange={(trainingDaysPerWeek) => save({ trainingDaysPerWeek }, true)}
          />
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">Workout length</span>
            <span className="text-xs text-muted-foreground">minutes</span>
          </div>
          <Segmented
            label="Workout length in minutes"
            options={DURATION_OPTIONS}
            value={profile.durationPreferenceMinutes}
            onChange={(durationPreferenceMinutes) => save({ durationPreferenceMinutes }, true)}
          />
        </div>

        <SettingRow label="Gender" value={GENDER_LABELS[profile.gender]} onClick={() => setEditing("gender")} />
        <SettingRow
          label="Body weight"
          value={formatWeight(profile.weightKg, profile.units)}
          onClick={() => {
            setWeightSession((n) => n + 1)
            setEditing("weight")
          }}
        />

        {workoutStatus === "ready" ? (
          <div className="flex flex-col gap-2 px-5 py-4">
            <Button variant="outline" className="h-11 w-full rounded-xl" onClick={regenerateToday}>
              <RefreshCw />
              Regenerate today&apos;s workout
            </Button>
            <p className="text-xs text-muted-foreground">
              Changes here apply from tomorrow. Regenerate to apply them to today&apos;s plan now.
            </p>
          </div>
        ) : null}
      </div>

      <OptionDrawer
        open={editing === "goal"}
        onOpenChange={closeIfClosing}
        title="Goal"
        description="Sets rep ranges, rest and volume."
        options={GOAL_OPTIONS}
        value={profile.goal}
        onSelect={(goal) => save({ goal }, true)}
      />
      <OptionDrawer
        open={editing === "experience"}
        onOpenChange={closeIfClosing}
        title="Experience"
        description="Sets exercise difficulty and weekly set caps."
        options={EXPERIENCE_OPTIONS}
        value={profile.experience}
        onSelect={(experience) => save({ experience }, true)}
      />
      <OptionDrawer
        open={editing === "gender"}
        onOpenChange={closeIfClosing}
        title="Gender"
        options={GENDER_OPTIONS}
        value={profile.gender}
        onSelect={(gender) => save({ gender }, false)}
      />
      <WeightDrawer
        key={weightSession}
        open={editing === "weight"}
        onOpenChange={closeIfClosing}
        weightKg={profile.weightKg}
        units={profile.units}
        onSave={(weightKg) => save({ weightKg }, false)}
      />
    </SectionCard>
  )
}
