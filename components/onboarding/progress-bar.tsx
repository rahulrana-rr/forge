import { cn } from "@/lib/utils"

/** Thin progress bar for the onboarding header. */
export function ProgressBar({ step, total, className }: { step: number; total: number; className?: string }) {
  const pct = Math.round((step / total) * 100)
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={step}
      aria-valuetext={`Step ${step} of ${total}`}
      className={cn("h-1 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <div
        className="h-full rounded-full bg-volt transition-[width] duration-500 ease-out-expo motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
