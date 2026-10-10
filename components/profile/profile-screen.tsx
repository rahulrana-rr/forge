"use client"

import { PageHeader } from "@/components/app/page-header"
import { CardSkeleton } from "@/components/app/skeletons"
import { useHistoryStore, useProfileStore } from "@/lib/store"

import { AboutSection } from "./about-section"
import { AccountCard } from "./account-card"
import { AppearanceSection } from "./appearance-section"
import { CoachSection } from "./coach-section"
import { DataSection } from "./data-section"
import { EquipmentSection } from "./equipment-section"
import { FavouritesSection } from "./favourites-section"
import { LimitationsSection } from "./limitations-section"
import { TrainingSection } from "./training-section"

export function ProfileScreen({ version }: { version: string }) {
  const hydrated = useProfileStore((s) => s.hydrated)
  const profile = useProfileStore((s) => s.profile)
  const workoutCount = useHistoryStore((s) => s.workouts.length)

  // ProfileGate sends users without a profile to onboarding; until then show the page shape.
  if (!hydrated || !profile) {
    return (
      <>
        <PageHeader title="Profile" />
        <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-label="Loading profile">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Profile" subtitle={profile.name?.trim() || undefined} />
      <div className="flex flex-col gap-8 animate-rise">
        <AccountCard />
        <TrainingSection profile={profile} />
        <EquipmentSection profile={profile} />
        <LimitationsSection profile={profile} />
        <FavouritesSection profile={profile} />
        <CoachSection />
        <AppearanceSection profile={profile} />
        <DataSection workoutCount={workoutCount} units={profile.units} />
        <AboutSection version={version} />
      </div>
    </>
  )
}
