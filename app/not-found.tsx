import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { bigButtonVariants } from "@/components/app/big-button"
import { Logo } from "@/components/app/logo"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Not found" }

export default function NotFound() {
  return (
    <div className="flex min-h-screen-safe flex-col px-5 pt-safe pb-safe">
      <header className="mx-auto flex w-full max-w-lg pt-6">
        <Link href="/" aria-label="FORGE home" className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring">
          <Logo size="sm" />
        </Link>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-8 py-12">
        <div className="flex flex-col gap-3">
          <span className="text-stat text-7xl font-semibold text-volt-ink">404</span>
          <h1 className="font-heading text-4xl leading-[1.05] font-black tracking-tight">Nothing on this rack.</h1>
          <p className="max-w-sm text-base text-muted-foreground">
            That page doesn&apos;t exist or has moved. Today&apos;s workout is still where you left it.
          </p>
        </div>
        <div className="flex max-w-sm flex-col gap-3">
          <Link href="/today" className={cn(bigButtonVariants({ tone: "volt" }), "inline-flex items-center justify-center gap-2")}>
            Go to today
            <ArrowRight className="size-5" aria-hidden="true" />
          </Link>
          <Link href="/" className={cn(bigButtonVariants({ tone: "ghost" }), "inline-flex items-center justify-center")}>
            Back to home
          </Link>
        </div>
      </main>
    </div>
  )
}
