"use client"

import { useId, type ComponentProps } from "react"

import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** Labelled input with an inline error, sized for thumbs. */
export function AuthField({
  label,
  error,
  className,
  ...inputProps
}: { label: string; error?: string | null } & Omit<ComponentProps<typeof Input>, "id" | "aria-invalid" | "aria-describedby">) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id} className="text-[0.6875rem] leading-4 font-semibold tracking-[0.12em] uppercase text-muted-foreground">
        {label}
      </FieldLabel>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "h-14 rounded-2xl border-border bg-surface px-4 text-base font-medium shadow-none focus-visible:border-volt focus-visible:ring-volt/30 dark:bg-surface md:text-base",
          className
        )}
        {...inputProps}
      />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  )
}
