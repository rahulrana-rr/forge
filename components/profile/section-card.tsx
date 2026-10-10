import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** A labelled settings group: uppercase heading, optional description, then a surface card. */
export function SectionCard({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  const headingId = `${id}-heading`
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-label text-muted-foreground">
          {title}
        </h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className={cn("surface-card overflow-hidden rounded-3xl", className)}>{children}</div>
    </section>
  )
}
