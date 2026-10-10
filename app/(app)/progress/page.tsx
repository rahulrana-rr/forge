import type { Metadata } from "next"

import { ProgressScreen } from "@/components/progress/progress-screen"

export const metadata: Metadata = { title: "Progress" }

export default function ProgressPage() {
  return <ProgressScreen />
}
