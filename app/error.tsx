"use client"

import Link from "next/link"
import { RefreshCw } from "lucide-react"

import { BigButton, bigButtonVariants } from "@/components/app/big-button"
import { Logo } from "@/components/app/logo"
import { cn } from "@/lib/utils"

/** Route-level error boundary. `retry` re-fetches and re-renders; `reset` only clears the boundary. */
export default function RouteError({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string }
  reset: () => void
  retry?: () => void
}) {
  const recover = retry ?? reset
  return (
    <div className="flex min-h-screen-safe flex-col px-5 pt-safe pb-safe">
      <header className="mx-auto flex w-full max-w-lg pt-6">
        <Link href="/" aria-label="FORGE home" className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring">
          <Logo size="sm" />
        </Link>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-8 py-12">
        <div className="flex flex-col gap-3">
          <span className="text-label text-destructive">Something broke</span>
          <h1 className="font-heading text-4xl leading-[1.05] font-black tracking-tight">That rep didn&apos;t count.</h1>
          <p className="max-w-sm text-base text-muted-foreground">
            The page hit an error. Your workout and history are saved on this device, so nothing is lost.
          </p>
          {error.digest ? (
            <p className="text-stat text-xs text-muted-foreground/70">ref {error.digest}</p>
          ) : null}
        </div>
        <div className="flex max-w-sm flex-col gap-3">
          <BigButton onClick={() => recover()}>
            <RefreshCw aria-hidden="true" />
            Try again
          </BigButton>
          <Link href="/today" className={cn(bigButtonVariants({ tone: "ghost" }), "inline-flex items-center justify-center")}>
            Go to today
          </Link>
        </div>
      </main>
    </div>
  )
}
