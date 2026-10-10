import { cva, type VariantProps } from "class-variance-authority"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Thumb-sized action button (56px) for primary flows: onboarding, auth, workout actions.
 * Wraps the shadcn Button so all Base UI props (`render`, `nativeButton`) still work.
 */
export const bigButtonVariants = cva(
  "h-14 w-full rounded-2xl px-6 text-base font-semibold tracking-tight [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      tone: {
        volt: "bg-volt text-volt-foreground hover:bg-volt/90 active:bg-volt/85",
        neutral: "bg-surface-3 text-foreground hover:bg-surface-3/80",
        outline: "border-border bg-transparent text-foreground hover:bg-surface-2 dark:bg-transparent dark:hover:bg-surface-2",
        ghost: "bg-transparent text-muted-foreground hover:bg-surface-2 hover:text-foreground",
      },
    },
    defaultVariants: { tone: "volt" },
  }
)

type BigButtonProps = React.ComponentProps<typeof Button> & VariantProps<typeof bigButtonVariants>

export function BigButton({ className, tone, ...props }: BigButtonProps) {
  const variant = tone === "outline" ? "outline" : tone === "ghost" ? "ghost" : "default"
  return <Button variant={variant} className={cn(bigButtonVariants({ tone }), className)} {...props} />
}
