import { Suspense } from "react"
import type { Metadata } from "next"

import { HistoryLoading, HistoryRoute } from "@/components/history/history-screen"

export const metadata: Metadata = { title: "History" }

export default function HistoryPage() {
  return (
    <Suspense fallback={<HistoryLoading />}>
      <HistoryRoute />
    </Suspense>
  )
}
