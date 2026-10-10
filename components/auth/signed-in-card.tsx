"use client"

import Link from "next/link"
import { ArrowRight, ShieldCheck } from "lucide-react"

import { bigButtonVariants } from "@/components/app/big-button"
import { cn } from "@/lib/utils"

export function SignedInCard({ email, name }: { email: string; name?: string | null }) {
  const who = name?.trim() ? `${name.trim()} (${email})` : email
  return (
    <section aria-labelledby="signed-in-title" className="surface-card flex flex-col gap-5 rounded-3xl p-6">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-volt/12 text-volt-ink">
        <ShieldCheck className="size-6" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 id="signed-in-title" className="font-heading text-2xl leading-tight font-black tracking-tight">
          You&apos;re signed in as
        </h2>
        <p className="text-base font-medium break-all text-muted-foreground">{who}</p>
      </div>
      <Link href="/today" className={cn(bigButtonVariants({ tone: "volt" }), "inline-flex items-center justify-center gap-2")}>
        Go to today&apos;s workout
        <ArrowRight className="size-5" aria-hidden="true" />
      </Link>
    </section>
  )
}
