import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Small uppercase label that introduces a group of content.
 * `text-label` is kept outside cn(): tailwind-merge treats unknown `text-*` classes as colours
 * and would drop it when a colour is merged in.
 */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={`text-label ${cn("text-muted-foreground", className)}`}>{children}</p>
}
