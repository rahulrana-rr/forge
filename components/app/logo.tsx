import { cn } from "@/lib/utils"

type LogoSize = "sm" | "md" | "lg"

const SIZES: Record<LogoSize, { mark: string; text: string; gap: string }> = {
  sm: { mark: "size-5 rounded-[5px]", text: "text-base", gap: "gap-1.5" },
  md: { mark: "size-7 rounded-[8px]", text: "text-xl", gap: "gap-2" },
  lg: { mark: "size-10 rounded-[11px]", text: "text-3xl", gap: "gap-2.5" },
}

/** FORGE wordmark with the volt "F" mark. Pure markup; safe in server components. */
export function Logo({ size = "md", className }: { size?: LogoSize; className?: string }) {
  const s = SIZES[size]
  return (
    <span
      className={cn("inline-flex items-center font-heading font-black tracking-tight select-none", s.gap, className)}
      aria-label="FORGE"
      role="img"
    >
      <LogoMark className={s.mark} />
      <span className={cn("leading-none", s.text)}>FORGE</span>
    </span>
  )
}

/** The square volt mark on its own (bottom nav, loading states). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("shrink-0 bg-volt text-volt-foreground", className)}>
      <path fill="currentColor" d="M19 12h30v9H28v9h18v9H28v13h-9z" />
      <circle cx="44.5" cy="46.5" r="4.5" fill="currentColor" opacity="0.7" />
    </svg>
  )
}
