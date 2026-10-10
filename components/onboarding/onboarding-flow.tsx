"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ArrowRight, ChevronLeft } from "lucide-react"

import { EQUIPMENT_PRESETS } from "@/lib/domain/types"
import { haptic } from "@/lib/haptics"
// Imported directly, not from the "@/lib/store" barrel: the barrel pulls in the workout engine and
// the whole exercise library, which onboarding does not need.
import { useProfileStore } from "@/lib/store/profile-store"
import { cn } from "@/lib/utils"

import { BigButton } from "@/components/app/big-button"
import { Logo } from "@/components/app/logo"
import { FullScreenSkeleton } from "@/components/app/skeletons"
import { ExistingProfileNotice } from "@/components/onboarding/existing-profile-notice"
import { ProgressBar } from "@/components/onboarding/progress-bar"
import { DaysStep } from "@/components/onboarding/steps/days-step"
import { EquipmentStep } from "@/components/onboarding/steps/equipment-step"
import { ExperienceStep } from "@/components/onboarding/steps/experience-step"
import { GenderStep } from "@/components/onboarding/steps/gender-step"
import { GoalStep } from "@/components/onboarding/steps/goal-step"
import { ProtectStep } from "@/components/onboarding/steps/protect-step"
import { isWeightValid, parseWeightKg, WeightStep } from "@/components/onboarding/steps/weight-step"
import { EMPTY_DRAFT, ONBOARDING_STEPS, type OnboardingDraft, type OnboardingStepId } from "@/components/onboarding/types"

const TOTAL = ONBOARDING_STEPS.length

const variants = {
  enter: (dir: number) => ({ x: dir > 0 ? 48 : -48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -48 : 48, opacity: 0 }),
}

const reducedVariants = {
  enter: { x: 0, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exit: { x: 0, opacity: 0 },
}

/**
 * After "Start over" replaces an existing profile, today's workout may still be the one built from
 * the old answers (equipment, limitations). Drop it if it has not started so /today builds a fresh
 * one; if it is under way, say the new settings apply from tomorrow. The workout store and the
 * toast are loaded on demand so first-time onboarding never downloads the engine.
 */
async function refreshTodaysPlan(): Promise<void> {
  try {
    const { useWorkoutStore } = await import("@/lib/store/workout-store")
    const { active, discard } = useWorkoutStore.getState()
    if (active?.status === "ready") {
      discard()
    } else if (active?.status === "active" || active?.status === "paused") {
      const { toast } = await import("sonner")
      toast("Your new settings apply from tomorrow", {
        description: "Today's workout is already under way, so it stays as it is.",
      })
    }
  } catch {
    // Chunk failed to load (offline): /today still opens; the old plan only lasts until tomorrow.
  }
}

export function OnboardingFlow() {
  const router = useRouter()
  const reduceMotion = useReducedMotion()
  const hydrated = useProfileStore((s) => s.hydrated)
  const hasProfile = useProfileStore((s) => s.profile !== null)
  const createProfile = useProfileStore((s) => s.createProfile)

  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const [draft, setDraft] = useState<OnboardingDraft>(EMPTY_DRAFT)
  const [attempted, setAttempted] = useState(false)
  const [startOver, setStartOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const step: OnboardingStepId = ONBOARDING_STEPS[index] ?? "goal"
  const isLast = index === TOTAL - 1

  const patch = useCallback((p: Partial<OnboardingDraft>) => setDraft((d) => ({ ...d, ...p })), [])

  const weightKg = useMemo(() => parseWeightKg(draft.weightInput, draft.units), [draft.weightInput, draft.units])

  const canContinue = useMemo(() => {
    switch (step) {
      case "goal":
        return draft.goal !== null
      case "experience":
        return draft.experience !== null
      case "gender":
        return draft.gender !== null
      case "weight":
        return draft.weightInput.trim().length > 0
      case "days":
        return draft.trainingDaysPerWeek !== null
      case "equipment":
        return draft.equipmentPreset !== null && (draft.equipmentPreset !== "custom" || draft.customEquipment.some((e) => e !== "bodyweight"))
      case "protect":
        return true
    }
  }, [step, draft])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" })
  }, [index])

  function go(next: number) {
    setDirection(next > index ? 1 : -1)
    setAttempted(false)
    setIndex(Math.max(0, Math.min(TOTAL - 1, next)))
  }

  function back() {
    haptic("tick")
    go(index - 1)
  }

  function next() {
    if (step === "weight" && !isWeightValid(weightKg)) {
      setAttempted(true)
      haptic("warning")
      return
    }
    if (!canContinue) return
    haptic("tap")
    go(index + 1)
  }

  async function finish(skipProtect: boolean) {
    const { goal, experience, gender, trainingDaysPerWeek, equipmentPreset } = draft
    if (!goal || !experience || !gender || !trainingDaysPerWeek || !equipmentPreset || !isWeightValid(weightKg)) {
      // A required answer is missing: send the user back to the first incomplete step.
      const firstIncomplete = ONBOARDING_STEPS.findIndex((s) => {
        if (s === "goal") return !goal
        if (s === "experience") return !experience
        if (s === "gender") return !gender
        if (s === "weight") return !isWeightValid(weightKg)
        if (s === "days") return !trainingDaysPerWeek
        if (s === "equipment") return !equipmentPreset
        return false
      })
      go(firstIncomplete === -1 ? 0 : firstIncomplete)
      setAttempted(true)
      return
    }
    setSubmitting(true)
    haptic("success")
    const equipment = equipmentPreset === "custom" ? draft.customEquipment : EQUIPMENT_PRESETS[equipmentPreset]
    createProfile({
      goal,
      gender,
      // Already rounded to 0.1 in the user's units by parseWeightKg.
      weightKg,
      experience,
      trainingDaysPerWeek,
      equipmentPreset,
      equipment,
      durationPreferenceMinutes: skipProtect ? 45 : draft.durationPreferenceMinutes,
      units: draft.units,
      limitations: skipProtect ? [] : draft.limitations,
      excludedExerciseIds: [],
      preferredExerciseIds: [],
    })
    // The today page generates the workout on mount; only a replaced profile needs extra care.
    if (startOver) await refreshTodaysPlan()
    router.replace("/today")
  }

  if (!hydrated) return <FullScreenSkeleton label="Loading" />

  // `submitting` keeps the notice away while a first-time Finish navigates: createProfile sets
  // the profile before the /today navigation commits.
  const showNotice = hasProfile && !startOver && !submitting

  return (
    <div className="flex min-h-screen-safe flex-col">
      <header className="sticky top-0 z-30 glass pt-safe">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-3 px-5 pt-4 pb-3">
          <div className="flex items-center justify-between">
            <Logo size="sm" />
            {!showNotice ? (
              <span className="text-label text-muted-foreground" aria-hidden="true">
                {index + 1} / {TOTAL}
              </span>
            ) : null}
          </div>
          {!showNotice ? <ProgressBar step={index + 1} total={TOTAL} /> : null}
        </div>
      </header>

      <div className="mx-auto w-full max-w-lg flex-1 px-5 pt-6 pb-40">
        {showNotice ? (
          <ExistingProfileNotice onStartOver={() => setStartOver(true)} />
        ) : (
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={step}
              custom={direction}
              variants={reduceMotion ? reducedVariants : variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: reduceMotion ? 0.15 : 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              {step === "goal" ? <GoalStep value={draft.goal} onChange={(goal) => patch({ goal })} /> : null}
              {step === "experience" ? (
                <ExperienceStep value={draft.experience} onChange={(experience) => patch({ experience })} />
              ) : null}
              {step === "gender" ? <GenderStep value={draft.gender} onChange={(gender) => patch({ gender })} /> : null}
              {step === "weight" ? (
                <WeightStep
                  value={draft.weightInput}
                  units={draft.units}
                  showError={attempted}
                  onChange={(weightInput) => patch({ weightInput })}
                  onUnitsChange={(units) => patch({ units })}
                />
              ) : null}
              {step === "days" ? (
                <DaysStep value={draft.trainingDaysPerWeek} onChange={(trainingDaysPerWeek) => patch({ trainingDaysPerWeek })} />
              ) : null}
              {step === "equipment" ? (
                <EquipmentStep
                  preset={draft.equipmentPreset}
                  custom={draft.customEquipment}
                  onPresetChange={(equipmentPreset) => patch({ equipmentPreset })}
                  onCustomChange={(customEquipment) => patch({ customEquipment })}
                />
              ) : null}
              {step === "protect" ? (
                <ProtectStep
                  limitations={draft.limitations}
                  duration={draft.durationPreferenceMinutes}
                  onLimitationsChange={(limitations) => patch({ limitations })}
                  onDurationChange={(durationPreferenceMinutes) => patch({ durationPreferenceMinutes })}
                />
              ) : null}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {!showNotice ? (
        <div className="glass fixed inset-x-0 bottom-0 z-30 border-t border-border pb-safe">
          <div className="mx-auto flex w-full max-w-lg items-center gap-3 px-5 py-3">
            {index === 0 ? (
              <Link
                href="/"
                aria-label="Back to home"
                className="flex size-14 shrink-0 items-center justify-center rounded-2xl text-muted-foreground transition-colors outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
              >
                <ChevronLeft className="size-6" aria-hidden="true" />
              </Link>
            ) : (
              <BigButton tone="outline" onClick={back} aria-label="Back" className="w-14 shrink-0 px-0">
                <ChevronLeft className="size-6" aria-hidden="true" />
              </BigButton>
            )}
            {isLast ? (
              <>
                <BigButton tone="ghost" onClick={() => void finish(true)} disabled={submitting} className="flex-1">
                  Skip
                </BigButton>
                <BigButton onClick={() => void finish(false)} disabled={submitting} className="flex-1">
                  {submitting ? "Building your plan…" : "Finish"}
                  {!submitting ? <ArrowRight aria-hidden="true" /> : null}
                </BigButton>
              </>
            ) : (
              <BigButton
                onClick={next}
                aria-disabled={!canContinue || undefined}
                className={cn("flex-1", !canContinue && "opacity-60")}
              >
                Continue
                <ArrowRight aria-hidden="true" />
              </BigButton>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
