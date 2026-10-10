import { Logo } from "@/components/app/logo"
import { ExerciseCardMock } from "@/components/landing/exercise-card-mock"
import { AccountLink } from "@/components/landing/account-link"
import { LandingCta } from "@/components/landing/landing-cta"

export function Hero() {
  return (
    <section className="relative flex flex-col items-center px-5 pt-safe">
      <div className="flex w-full max-w-lg items-center justify-between pt-6">
        <Logo size="md" />
        <AccountLink className="inline-flex h-10 items-center rounded-xl px-3 text-sm font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring" />
      </div>

      <div className="mt-12 flex w-full max-w-lg flex-col items-center text-center sm:mt-16">
        <h1 className="animate-rise font-heading text-[2.75rem] leading-[0.95] font-black tracking-tighter sm:text-6xl">
          Your workout is <span className="text-volt-ink">already</span> planned.
        </h1>
        <p className="mt-5 max-w-xs text-lg text-balance text-muted-foreground sm:max-w-sm">
          Open the app, see the exercise, swipe right when you&apos;re done. Nothing to set up.
        </p>
        <div className="mt-8 flex w-full justify-center">
          <LandingCta />
        </div>
      </div>

      <div className="mt-14 w-full px-2 sm:mt-16">
        <ExerciseCardMock />
      </div>
    </section>
  )
}
