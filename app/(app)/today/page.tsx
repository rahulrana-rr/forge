import type { Metadata } from "next"

import { TodayScreen } from "@/components/workout/today-screen"

export const metadata: Metadata = {
  title: "Today",
  description: "Today's workout, programmed for you. Swipe right to finish an exercise, left to replace it.",
}

export default function TodayPage() {
  return <TodayScreen />
}
