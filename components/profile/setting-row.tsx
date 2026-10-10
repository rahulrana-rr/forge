"use client"

import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

const BASE =
  "flex min-h-14 w-full items-center gap-3 px-5 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset"

/** One settings row: label (+hint) on the left, current value and a chevron or custom control on the right. */
export function SettingRow({
  label,
  labelId,
  hint,
  value,
  onClick,
  trailing,
  destructive = false,
  className,
}: {
  label: string
  labelId?: string
  hint?: string
  value?: string
  onClick?: () => void
  /** Replaces the chevron, e.g. an icon or a Switch. */
  trailing?: ReactNode
  destructive?: boolean
  className?: string
}) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={labelId} className={cn("text-sm font-semibold", destructive ? "text-destructive" : "text-foreground")}>
          {label}
        </span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      {value ? <span className="max-w-[45%] truncate text-sm text-muted-foreground">{value}</span> : null}
      {trailing ??
        (onClick ? <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null)}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(BASE, "text-left transition-colors hover:bg-surface-2 active:bg-surface-2", className)}
      >
        {body}
      </button>
    )
  }
  return <div className={cn(BASE, className)}>{body}</div>
}
