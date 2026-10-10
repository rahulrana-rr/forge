"use client"

import { useEffect, useRef, type ReactNode } from "react"

/**
 * Heading block shared by every step. Moves focus to the heading on mount so screen readers
 * announce the new question after a transition.
 */
export function StepShell({
  id,
  title,
  subtitle,
  optional,
  children,
}: {
  id: string
  title: string
  subtitle?: string
  optional?: boolean
  children: ReactNode
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {optional ? <span className="text-label text-volt-ink">Optional</span> : null}
        <h1
          id={`${id}-title`}
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-[2rem] leading-[1.05] font-black tracking-tight outline-none sm:text-4xl"
        >
          {title}
        </h1>
        {subtitle ? <p className="text-base text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  )
}
