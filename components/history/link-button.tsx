import type { ReactNode } from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"

/** Thumb-sized volt call to action rendered as a link (for empty states and detail pages). */
export function LinkButton({
  href,
  children,
  tone = "volt",
  className,
}: {
  href: string
  children: ReactNode
  tone?: "volt" | "neutral"
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold tracking-tight transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring active:translate-y-px [&_svg]:size-5",
        tone === "volt" ? "bg-volt text-volt-foreground hover:bg-volt/90" : "bg-surface-3 text-foreground hover:bg-surface-3/80",
        className,
      )}
    >
      {children}
    </Link>
  )
}
