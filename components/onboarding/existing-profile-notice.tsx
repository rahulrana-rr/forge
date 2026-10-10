"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { BigButton, bigButtonVariants } from "@/components/app/big-button"
import { cn } from "@/lib/utils"

/** Shown when a profile already exists so a stray visit to /onboarding never wipes it by accident. */
export function ExistingProfileNotice({ onStartOver }: { onStartOver: () => void }) {
  return (
    <section aria-labelledby="existing-title" className="surface-card flex flex-col gap-5 rounded-3xl p-6">
      <div className="flex flex-col gap-2">
        <span className="text-label text-volt-ink">Already set up</span>
        <h1 id="existing-title" className="font-heading text-3xl leading-[1.05] font-black tracking-tight">
          You already have a profile.
        </h1>
        <p className="text-base text-muted-foreground">
          Keep it and jump straight to today&apos;s workout, or start over with new answers.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <Link href="/today" className={cn(bigButtonVariants({ tone: "volt" }), "inline-flex items-center justify-center gap-2")}>
          Keep my profile
          <ArrowRight className="size-5" aria-hidden="true" />
        </Link>
        <BigButton tone="ghost" onClick={onStartOver}>
          Start over
        </BigButton>
      </div>
    </section>
  )
}
