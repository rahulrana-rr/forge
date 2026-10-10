import type { Metadata } from "next"

import { OnboardingFlow } from "@/components/onboarding/onboarding-flow"

export const metadata: Metadata = {
  title: "Set up",
  description: "Six quick questions and your first workout is ready.",
}

export default function OnboardingPage() {
  return <OnboardingFlow />
}
