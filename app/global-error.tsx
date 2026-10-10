"use client"

import Link from "next/link"

import "./globals.css"

/**
 * Replaces the root layout when it fails. Must render its own <html>/<body>; fonts from the root
 * layout are not available here, so the font variables fall back to system stacks.
 */
export default function GlobalError({
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
    <html
      lang="en"
      className="dark antialiased"
      style={
        {
          "--font-sans": "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          "--font-mono": "ui-monospace, SFMono-Regular, Menlo, monospace",
        } as React.CSSProperties
      }
    >
      <head>
        <title>Something broke · FORGE</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className="min-h-screen-safe bg-background font-sans text-foreground">
        <div className="flex min-h-screen-safe flex-col px-5 pt-safe pb-safe">
          <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-8 py-12">
            <div className="flex flex-col gap-3">
              <span className="font-heading text-3xl font-black tracking-tight">FORGE</span>
              <span className="text-label text-destructive">Something broke</span>
              <h1 className="font-heading text-4xl leading-[1.05] font-black tracking-tight">The app hit a wall.</h1>
              <p className="max-w-sm text-base text-muted-foreground">
                Your workouts are saved on this device. Reload to pick up where you left off.
              </p>
              {error.digest ? <p className="text-stat text-xs text-muted-foreground/70">ref {error.digest}</p> : null}
            </div>
            <div className="flex max-w-sm flex-col gap-3">
              <button
                type="button"
                onClick={() => recover()}
                className="h-14 w-full rounded-2xl bg-volt px-6 text-base font-semibold tracking-tight text-volt-foreground outline-none hover:bg-volt/90 focus-visible:ring-3 focus-visible:ring-ring"
              >
                Try again
              </button>
              <Link
                href="/"
                className="flex h-14 w-full items-center justify-center rounded-2xl px-6 text-base font-semibold text-muted-foreground outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
              >
                Back to home
              </Link>
            </div>
          </main>
        </div>
      </body>
    </html>
  )
}
