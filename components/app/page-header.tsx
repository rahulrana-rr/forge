import type { ReactNode } from "react"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { cn } from "@/lib/utils"

/** Big page heading with optional back link, subtitle and right-side action. */
export function PageHeader({
  title,
  subtitle,
  action,
  back,
  className,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  back?: string
  className?: string
}) {
  return (
    <header className={cn("flex flex-col gap-3 pt-6 pb-4", className)}>
      {back ? (
        <Link
          href={back}
          className="-ml-2 inline-flex h-10 w-fit items-center gap-0.5 rounded-xl pr-3 pl-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
          Back
        </Link>
      ) : null}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-3xl leading-[1.05] font-bold tracking-tight sm:text-4xl">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-base text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  )
}
