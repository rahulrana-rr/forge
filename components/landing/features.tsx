import { CloudOff, Hand, ListChecks, type LucideIcon } from "lucide-react"

interface Feature {
  icon: LucideIcon
  title: string
  body: string
}

const FEATURES: Feature[] = [
  {
    icon: ListChecks,
    title: "Programmed daily",
    body: "Splits, rep ranges, rest and progression follow the rules a coach would use.",
  },
  {
    icon: Hand,
    title: "One exercise at a time",
    body: "A single card. Swipe right to finish, left to replace. No spreadsheet.",
  },
  {
    icon: CloudOff,
    title: "Works offline",
    body: "After your first visit the app and your workouts stay on your phone, so no signal in the gym is fine. Sign in only to sync history across devices.",
  },
]

export function Features() {
  return (
    <section className="mx-auto mt-20 w-full max-w-lg px-5" aria-labelledby="features-heading">
      <h2 id="features-heading" className="sr-only">
        How FORGE works
      </h2>
      <ul className="flex flex-col gap-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="surface-card flex items-start gap-4 rounded-3xl p-5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-volt/12 text-volt-ink">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="font-heading text-lg leading-tight font-bold tracking-tight">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
