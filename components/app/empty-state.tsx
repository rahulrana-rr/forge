import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** Centered placeholder for lists and pages that have nothing to show yet. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("surface-card flex flex-col items-center gap-4 rounded-3xl px-6 py-10 text-center", className)}>
      {icon ? (
        <div className="flex size-14 items-center justify-center rounded-2xl bg-volt/12 text-volt-ink [&_svg]:size-7" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <h2 className="font-heading text-xl font-bold tracking-tight">{title}</h2>
        {description ? <p className="max-w-xs text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex w-full max-w-xs flex-col">{action}</div> : null}
    </div>
  )
}
