"use client"

import Link from "next/link"
import {
  ArrowRightIcon,
  CloudOffIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useCoachStore, type CoachEntry } from "@/lib/coach/store"
import type { CoachIssue } from "@/lib/coach/schema"
import { useWorkoutStore } from "@/lib/store"
import { cn } from "@/lib/utils"

const SEVERITY_ORDER: Record<CoachIssue["severity"], number> = { critical: 0, high: 1, medium: 2, low: 3 }
const SEVERITY_TONE: Record<CoachIssue["severity"], string> = {
  critical: "bg-destructive/15 text-destructive",
  high: "bg-destructive/10 text-destructive",
  medium: "bg-replace/15 text-foreground dark:text-replace",
  low: "bg-surface-3 text-muted-foreground",
}

/**
 * The coach's verdict on today's plan, shown above "Start workout". It never implies approval
 * without a review: pending, offline, not configured and errors all read as "not reviewed".
 */
export function CoachPanel({ workoutId, className }: { workoutId: string; className?: string }) {
  const entry = useCoachStore((s) => s.entries[workoutId]) as CoachEntry | undefined
  const hydrated = useCoachStore((s) => s.hydrated)
  const status = useWorkoutStore((s) => s.active?.status)
  if (!hydrated) return null

  const retry = () => useCoachStore.getState().ensureReview(true)

  if (!entry || entry.status === "pending") {
    return (
      <Shell className={className} tone="neutral" icon={<Spinner className="size-5" />} title="Coach is reviewing this workout" live>
        <p className="text-sm text-muted-foreground">
          A senior-coach check of exercise choice, volume, rest and safety. It usually takes under a minute. You can start now; changes only apply before you start.
        </p>
      </Shell>
    )
  }

  if (entry.status !== "reviewed" || !entry.response) {
    const off = entry.status === "off"
    return (
      <Shell className={className} tone="neutral" icon={<CloudOffIcon />} title="Not reviewed by the coach">
        <p className="text-sm text-muted-foreground">{entry.reason ?? "The coach couldn't review this workout."} The plan below comes straight from FORGE&apos;s programming rules.</p>
        <div className="mt-3 flex gap-2">
          {off ? (
            <Button variant="outline" size="sm" className="h-9 rounded-xl" nativeButton={false} render={<Link href="/profile" />}>
              Coach settings
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={retry}>
              <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
              Try again
            </Button>
          )}
        </div>
      </Shell>
    )
  }

  const { review, rejectedChanges } = entry.response
  const issues = [...review.issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  const serious = issues.filter((i) => i.severity === "critical" || i.severity === "high")
  const rejected = review.review_status === "REJECTED"
  const changed = entry.changes.length > 0
  const canToggle = !!entry.original && status === "ready"

  const title = rejected
    ? "Coach flagged this workout"
    : changed && !entry.usingOriginal
      ? `Coach approved with ${entry.changes.length} ${entry.changes.length === 1 ? "change" : "changes"}`
      : review.review_status === "APPROVED"
        ? "Coach approved"
        : "Coach reviewed"

  return (
    <Shell
      className={className}
      tone={rejected ? "danger" : "volt"}
      icon={rejected ? <ShieldAlertIcon /> : changed ? <ShieldIcon /> : <ShieldCheckIcon />}
      title={title}
      score={review.overall_score}
    >
      <p className="text-sm leading-snug text-foreground/90">{review.summary}</p>

      {rejected && serious.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {serious.slice(0, 3).map((issue, i) => (
            <IssueRow key={i} issue={issue} />
          ))}
        </ul>
      ) : null}

      {changed && !entry.usingOriginal ? (
        <ul className="mt-3 flex flex-col gap-1.5" aria-label="Changes the coach made">
          {entry.changes.map((c) => (
            <li key={`${c.kind}-${c.slotId}`} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 rounded-md bg-surface-3 px-1.5 py-px text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{c.kind}</span>
              <span className="min-w-0 leading-snug">
                {c.kind === "replaced" ? (
                  <>
                    {c.from} <ArrowRightIcon className="inline size-3.5 align-[-2px] text-muted-foreground" aria-label="to" /> <span className="font-semibold">{c.to}</span>
                  </>
                ) : c.kind === "added" ? (
                  <span className="font-semibold">{c.to}</span>
                ) : (
                  <span className="font-semibold">{c.from}</span>
                )}
                {c.kind !== "removed" ? <span className="block text-xs text-muted-foreground">{c.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {entry.reason ? <p className="mt-3 text-xs text-muted-foreground">{entry.reason}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {rejected && status === "ready" ? (
          <Button size="sm" className="h-9 rounded-xl" onClick={() => useWorkoutStore.getState().regenerate()}>
            <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
            Build a different workout
          </Button>
        ) : null}
        {canToggle ? (
          <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={() => useCoachStore.getState().useOriginal(workoutId, !entry.usingOriginal)}>
            {entry.usingOriginal ? "Use the coach's plan" : "Use the original plan"}
          </Button>
        ) : null}
      </div>

      <details className="group mt-3 rounded-2xl bg-surface-2 px-3 py-2 open:pb-3">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          Coach notes
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">{issues.length} {issues.length === 1 ? "note" : "notes"}</span>
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          {issues.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {issues.map((issue, i) => (
                <IssueRow key={i} issue={issue} />
              ))}
            </ul>
          ) : null}
          <dl className="grid gap-2 text-sm">
            {(
              [
                ["Volume", review.programming_feedback.volume],
                ["Intensity", review.programming_feedback.intensity],
                ["Recovery", review.programming_feedback.recovery],
                ["Balance", review.programming_feedback.exercise_balance],
              ] as const
            ).map(([label, text]) => (
              <div key={label}>
                <dt className="text-label text-muted-foreground">{label}</dt>
                <dd className="leading-snug">{text}</dd>
              </div>
            ))}
          </dl>
          {review.final_recommendations.length > 0 ? (
            <ul className="list-disc pl-5 text-sm leading-snug">
              {review.final_recommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : null}
          {rejectedChanges.length > 0 ? (
            <p className="text-xs text-muted-foreground">Not applied: {rejectedChanges.join(" ")}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Reviewed by Claude as a coaching check, not medical advice. Stop and get medical help for chest pain, fainting or severe shortness of breath.
          </p>
        </div>
      </details>
    </Shell>
  )
}

function IssueRow({ issue }: { issue: CoachIssue }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className={cn("mt-0.5 shrink-0 rounded-md px-1.5 py-px text-[0.6875rem] font-semibold tracking-wide uppercase", SEVERITY_TONE[issue.severity])}>{issue.severity}</span>
      <span className="min-w-0 leading-snug">
        <span className="font-semibold">{issue.exercise_name}:</span> {issue.problem}{" "}
        <span className="text-muted-foreground">{issue.recommendation}</span>
      </span>
    </li>
  )
}

function Shell({
  tone,
  icon,
  title,
  score,
  live,
  className,
  children,
}: {
  tone: "neutral" | "volt" | "danger"
  icon: React.ReactNode
  title: string
  score?: number
  live?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      aria-live={live ? "polite" : undefined}
      aria-label="Coach review"
      className={cn(
        "rounded-3xl border p-4",
        tone === "volt" && "border-volt/25 bg-volt/6",
        tone === "danger" && "border-destructive/30 bg-destructive/8",
        tone === "neutral" && "border-border bg-surface",
        className,
      )}
    >
      <header className="mb-2 flex items-center gap-2.5">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-5",
            tone === "volt" && "bg-volt/15 text-volt-ink",
            tone === "danger" && "bg-destructive/15 text-destructive",
            tone === "neutral" && "bg-surface-3 text-muted-foreground",
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        <h2 className="min-w-0 flex-1 font-heading text-base leading-tight font-bold tracking-tight">{title}</h2>
        {score != null ? (
          <span className="text-stat rounded-full bg-surface-3 px-2.5 py-1 text-sm font-semibold" aria-label={`Coach score ${score} out of 100`}>
            {score}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  )
}
