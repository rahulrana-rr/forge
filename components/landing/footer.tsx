import Link from "next/link"

import { Logo } from "@/components/app/logo"

export function Footer() {
  return (
    <footer className="mx-auto mt-16 w-full max-w-lg px-5 pb-[calc(env(safe-area-inset-bottom,0px)+2.5rem)]">
      <div className="flex flex-col gap-4 border-t border-border pt-6">
        <div className="flex items-center justify-between">
          <Logo size="sm" className="text-muted-foreground" />
          <nav aria-label="Footer" className="flex gap-4 text-sm font-medium text-muted-foreground">
            <Link href="/onboarding" className="rounded-md outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring">
              Get started
            </Link>
            <Link href="/sign-in" className="rounded-md outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring">
              Sign in
            </Link>
          </nav>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Not medical advice. FORGE suggests training based on what you tell it; check with a professional before
          starting a new program, especially with an injury or condition.
        </p>
      </div>
    </footer>
  )
}
