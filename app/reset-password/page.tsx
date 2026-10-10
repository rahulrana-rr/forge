import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { Logo } from "@/components/app/logo"
import { CardSkeleton } from "@/components/app/skeletons"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Set a new password for your FORGE account.",
  robots: { index: false },
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen-safe">
      <header className="pt-safe">
        <div className="mx-auto flex w-full max-w-lg items-center justify-between px-5 pt-5">
          <Link
            href="/sign-in"
            className="-ml-2 inline-flex h-10 items-center gap-0.5 rounded-xl pr-3 pl-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
            Sign in
          </Link>
          <Link
            href="/"
            aria-label="FORGE home"
            className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring"
          >
            <Logo size="sm" />
          </Link>
        </div>
      </header>

      <main
        id="main"
        className="mx-auto flex w-full max-w-lg flex-col gap-8 px-5 pt-8 pb-[calc(env(safe-area-inset-bottom,0px)+4rem)]"
      >
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-[2rem] leading-[1.05] font-black tracking-tight sm:text-4xl">
            New password
          </h1>
          <p className="text-base text-muted-foreground">
            Choose a new password. Saving it signs you out on every device, then
            you sign in again here.
          </p>
        </div>
        {/* The token arrives as a search param, read on the client so the page stays static. */}
        <Suspense fallback={<CardSkeleton />}>
          <ResetPasswordForm />
        </Suspense>
      </main>
    </div>
  )
}
