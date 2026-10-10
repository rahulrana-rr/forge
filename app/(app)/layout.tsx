import type { ReactNode } from "react"

import { AppShell } from "@/components/app/app-shell"
import { TooltipProvider } from "@/components/ui/tooltip"

/** Tooltips are only used inside the app shell, so their provider (and floating-ui) lives here, not in the root layout. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <AppShell>{children}</AppShell>
    </TooltipProvider>
  )
}
