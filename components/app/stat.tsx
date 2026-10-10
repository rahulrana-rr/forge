import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type StatSize = "sm" | "md" | "lg"
type StatAlign = "left" | "center"

const VALUE_SIZE: Record<StatSize, string> = {
  sm: "text-xl",
  md: "text-3xl",
  lg: "text-5xl",
}

const UNIT_SIZE: Record<StatSize, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
}

/** Label-over-number block. Label uses text-label, value uses text-stat (mono, tabular). */
export function Stat({
  label,
  value,
  unit,
  size = "md",
  align = "left",
  className,
}: {
  label: string
  value: ReactNode
  unit?: string
  size?: StatSize
  align?: StatAlign
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", align === "center" && "items-center text-center", className)}>
      <span className="text-label text-muted-foreground">{label}</span>
      <span className={cn("flex items-baseline gap-1 leading-none", align === "center" && "justify-center")}>
        <span className={`text-stat ${cn("font-semibold text-foreground", VALUE_SIZE[size])}`}>{value}</span>
        {unit ? <span className={cn("font-medium text-muted-foreground", UNIT_SIZE[size])}>{unit}</span> : null}
      </span>
    </div>
  )
}
