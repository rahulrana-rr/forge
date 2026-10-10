import { Features } from "@/components/landing/features"
import { Footer } from "@/components/landing/footer"
import { Hero } from "@/components/landing/hero"

export default function LandingPage() {
  return (
    <div className="relative min-h-screen-safe overflow-x-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(ellipse_at_top,var(--volt)_0%,transparent_60%)] opacity-[0.07]"
        aria-hidden="true"
      />
      <main id="main">
        <Hero />
        <Features />
      </main>
      <Footer />
    </div>
  )
}
