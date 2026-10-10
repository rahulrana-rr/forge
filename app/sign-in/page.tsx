import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { Logo } from "@/components/app/logo"
import { AuthPanel } from "@/components/auth/auth-panel"
import { AuthRedirectError } from "@/components/auth/auth-redirect-error"

export const metadata: Metadata = {
  title: "Sign in",
  description: "Optional. Sign in only to sync your workout history across devices.",
}

export default function SignInPage() {
  return (
    <div className="min-h-screen-safe">
      <header className="pt-safe">
        <div className="mx-auto flex w-full max-w-lg items-center justify-between px-5 pt-5">
          <Link
            href="/today"
            className="-ml-2 inline-flex h-10 items-center gap-0.5 rounded-xl pr-3 pl-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
            Today
          </Link>
          <Link href="/" aria-label="FORGE home" className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring">
            <Logo size="sm" />
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-lg flex-col gap-8 px-5 pt-8 pb-[calc(env(safe-area-inset-bottom,0px)+4rem)]">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-[2rem] leading-[1.05] font-black tracking-tight sm:text-4xl">Sync across devices</h1>
          <p className="text-base text-muted-foreground">
            Signing in is optional. It&apos;s only used to keep your history in step on every device you train with.
          </p>
        </div>

        <Suspense fallback={null}>
          <AuthRedirectError />
        </Suspense>

        <AuthPanel />

        <p className="text-center text-sm text-muted-foreground">
          Not now?{" "}
          <Link href="/today" className="font-semibold text-foreground underline-offset-4 hover:underline">
            Keep training as a guest
          </Link>
        </p>
      </main>
    </div>
  )
}
