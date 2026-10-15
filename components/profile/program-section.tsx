"use client"

import { formatDateKey, todayKey } from "@/lib/dates"
import { getProgram } from "@/lib/programs"
import { programWeek } from "@/lib/programs/build"
import { useActiveAssignment } from "@/lib/programs/store"

import { SectionCard } from "./section-card"
import { SettingRow } from "./setting-row"

/**
 * Read-only view of the user's assigned program: title, current week, start date, the block rules
 * and habits. Assignments
 * are made by the coach on the server; there is nothing to edit here. Renders nothing without one.
 */
export function ProgramSection() {
  const assignment = useActiveAssignment()
  const program = assignment ? getProgram(assignment.programId) : undefined
  if (!assignment || !program) return null

  const week = programWeek(assignment.startDate, todayKey(), program)
  const weekLabel = week === null ? "Not started" : `Week ${week} of ${program.weeks}`

  return (
    <SectionCard id="program" title="Program" description="Coach-approved. Today's workout follows it.">
      <div className="flex flex-col divide-y divide-border">
        <SettingRow label={program.title} hint={`Started ${formatDateKey(assignment.startDate)}`} value={weekLabel} />
        <RuleList title="Block rules" items={program.blockRules} />
        {program.habits?.length ? <RuleList title="Habits" items={program.habits} /> : null}
      </div>
    </SectionCard>
  )
}

/** A collapsible list of the program's rules or habits (closed by default to keep Profile short). */
function RuleList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <details className="group px-5 py-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {title}
        <span className="text-xs font-normal text-muted-foreground group-open:hidden">{items.length}</span>
      </summary>
      <ul className="mt-1 flex flex-col gap-2 pb-1">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-snug text-foreground/90">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-volt" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
