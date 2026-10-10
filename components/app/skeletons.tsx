import { Skeleton } from "@/components/ui/skeleton"
import { LogoMark } from "@/components/app/logo"
import { cn } from "@/lib/utils"

/** A card-shaped placeholder: title line, two body lines. */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("surface-card flex flex-col gap-3 rounded-3xl p-5", className)} aria-hidden="true">
      <Skeleton className="h-3 w-20 rounded-full" />
      <Skeleton className="h-7 w-3/5 rounded-lg" />
      <Skeleton className="h-4 w-4/5 rounded-full" />
      <Skeleton className="h-4 w-2/5 rounded-full" />
    </div>
  )
}

/** A list of rows, each with a leading square and two lines. */
export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="surface-card flex items-center gap-4 rounded-2xl p-4">
          <Skeleton className="size-12 shrink-0 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/2 rounded-full" />
            <Skeleton className="h-3 w-1/3 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** A row of stats: small label over a big number. */
export function StatRowSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-3", className)} style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="surface-card flex flex-col gap-2 rounded-2xl p-4">
          <Skeleton className="h-3 w-12 rounded-full" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      ))}
    </div>
  )
}

/** Page-level placeholder: a heading block, a stat row and a card. */
export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-6 pt-8", className)} aria-hidden="true">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24 rounded-full" />
        <Skeleton className="h-9 w-2/3 rounded-lg" />
      </div>
      <StatRowSkeleton />
      <CardSkeleton />
    </div>
  )
}

/** Covers the viewport while persisted state loads. Announces loading to assistive tech. */
export function FullScreenSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background px-5 pt-safe"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col">
        <div className="flex items-center justify-between pt-6">
          <LogoMark className="size-7 animate-pulse-soft rounded-[8px]" />
          <Skeleton className="size-9 rounded-full" />
        </div>
        <PageSkeleton />
      </div>
    </div>
  )
}
