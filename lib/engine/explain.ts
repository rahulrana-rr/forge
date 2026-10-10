/**
 * Human-readable reasons for the workout the engine produced.
 */
import { muscleGroupOf } from "@/lib/exercises"
import { DEFAULT_LIBRARY, type Library } from "./library"
import { MUSCLE_GROUP_LABELS, type MuscleGroup } from "@/lib/exercises/types"
import type { EngineInput, Workout } from "./types"
import { GOAL_PRESCRIPTIONS } from "./prescriptions"
import { daysBetween } from "@/lib/dates"
import { cappedGroupsOf, computeRecovery, isFresh, weeklyCap } from "./recovery"
import { rotationFor } from "./splits"
import { budgetSessionsFor, chooseTemplate, ROTATION_LOOKBACK_DAYS, sortedHistory } from "./generate"

function listGroups(groups: readonly MuscleGroup[]): string {
  const labels = groups.map((g) => MUSCLE_GROUP_LABELS[g].toLowerCase())
  if (labels.length <= 1) return labels.join("")
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
}

function formatReps([lo, hi]: [number, number]): string {
  return lo === hi ? String(lo) : `${lo}–${hi}`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

export function explainWorkout(workout: Workout, input: EngineInput, lib: Library = DEFAULT_LIBRARY): string[] {
  const { profile } = input
  const lines: string[] = []
  // The same week the generator capped against: the plan's other sessions, not every session in 7 days.
  const recovery = computeRecovery(input.history, workout.date, lib, budgetSessionsFor(profile))
  const focus = workout.focus.filter((g) => g !== "full_body")

  // 1. Why this day.
  const untrained = focus.filter((g) => recovery[g].daysSinceHeavy === null)
  const rested = focus.filter((g) => recovery[g].daysSinceHeavy !== null)
  if (focus.length === 0 || untrained.length === focus.length) {
    lines.push(`${workout.title}: ${focus.length ? listGroups(focus) : "everything"} ${focus.length === 1 ? "is" : "are"} fresh, no recent heavy sessions.`)
  } else {
    const minDays = Math.min(...rested.map((g) => recovery[g].daysSinceHeavy ?? 0))
    const when = minDays === 0 ? "already trained today" : minDays === 1 ? "1 day rested" : `${minDays} days rested`
    lines.push(`${workout.title}: ${listGroups(rested)} ${rested.length === 1 ? "is" : "are"} ${when}${untrained.length ? `; ${listGroups(untrained)} untouched this week` : ""}.`)
  }

  // 2. Where we are in the rotation: the same choice the generator made, never a recomputed guess.
  const rotation = rotationFor(profile.trainingDaysPerWeek, profile.experience, profile.goal)
  const days = profile.trainingDaysPerWeek
  const choice = chooseTemplate(rotation, input.history, recovery, workout.date)
  const last = sortedHistory(input.history).find((w) => daysBetween(w.date, workout.date) >= 0)
  if (choice.template.title !== workout.title) {
    // History changed since the workout was generated; do not invent a reason.
    lines.push(`${workout.title} in your ${days}-day rotation.`)
  } else if (choice.reason === "freshness") {
    const tired = choice.natural.heavyGroups.filter((g) => !isFresh(recovery, g))
    lines.push(`Swapped ${choice.natural.title} for ${workout.title}: ${listGroups(tired)} trained heavy in the last 48h.`)
  } else if (choice.reason === "rotation") {
    const previous = rotation[(rotation.indexOf(choice.natural) - 1 + rotation.length) % rotation.length]
    lines.push(`Next in your ${days}-day rotation after ${previous?.title ?? "your last session"}.`)
  } else if (last && daysBetween(last.date, workout.date) > ROTATION_LOOKBACK_DAYS) {
    lines.push(`Restarting your ${days}-day rotation after ${daysBetween(last.date, workout.date)} days off.`)
  } else {
    lines.push(`Day 1 of your ${days}-day rotation.`)
  }

  // 3. The goal block.
  const main = workout.exercises.filter((e) => e.phase === "main")
  const primary = main.find((e) => e.role === "primary_compound")
  const rx = GOAL_PRESCRIPTIONS[workout.goal]
  if (primary) {
    const scheme = primary.reps ? `${primary.sets}×${formatReps(primary.reps)}` : `${primary.sets}×${primary.durationSeconds ?? 0}s`
    const restWord = primary.restSeconds >= 150 ? "long rests" : primary.restSeconds >= 90 ? "moderate rests" : "short rests"
    lines.push(`${rx.label}: ${scheme} on the main lift with ${restWord} (${primary.restSeconds}s).`)
  } else {
    lines.push(`${rx.label}: ${rx.sets[0]}–${rx.sets[1]} sets of ${rx.reps[0]}–${rx.reps[1]}.`)
  }
  const finisher = main.find((e) => e.role === "finisher")
  if (finisher) {
    const ex = lib.get(finisher.exerciseId)
    const name = ex ? ` (${ex.name.toLowerCase()})` : ""
    // Coach round 2 (R17): on a conditioning-led day the block is the main work, not a finisher.
    lines.push(
      workout.split === "conditioning"
        ? `Conditioning day: a short full-body circuit at minimum sets, then the conditioning block${name} as the main work.`
        : `Conditioning finisher${name} to close out the session.`,
    )
  }

  // 4. Weekly caps.
  const cap = weeklyCap(profile.experience)
  const planned = new Map<MuscleGroup, number>()
  for (const e of main) {
    const ex = lib.get(e.exerciseId)
    // Conditioning finishers are not direct volume and whole-body/cardio work has no cap.
    if (!ex || e.role === "finisher") continue
    for (const g of cappedGroupsOf(ex, muscleGroupOf(ex))) {
      if (g === "full_body" || g === "cardio") continue
      planned.set(g, (planned.get(g) ?? 0) + e.sets)
    }
  }
  const trimmedGroups = new Set<MuscleGroup>()
  for (const e of main) {
    const ex = lib.get(e.exerciseId)
    if (ex && e.note?.startsWith("Capped")) trimmedGroups.add(muscleGroupOf(ex))
  }
  const done = (g: MuscleGroup) => recovery[g].setsBudget
  const atCap = [...planned.entries()].filter(([g, sets]) => done(g) + sets >= cap && done(g) > 0)
  for (const [g] of atCap.slice(0, 2)) {
    const label = MUSCLE_GROUP_LABELS[g].toLowerCase()
    lines.push(
      trimmedGroups.has(g)
        ? `Capped ${label} at ${cap} sets this week (${done(g)} already done).`
        : `${MUSCLE_GROUP_LABELS[g]} reaches its ${cap}-set weekly cap with today's session (${done(g)} already done).`,
    )
  }

  // 5. Time budget and progression.
  lines.push(`${plural(main.length, "main exercise")} to fit about ${profile.durationPreferenceMinutes} minutes (estimated ${workout.estimatedMinutes}).`)
  const fromHistory = main.filter((e) => e.recommendedWeightKg !== null && e.weightSource !== "estimate").length
  if (fromHistory > 0) lines.push(`Weights suggested on ${plural(fromHistory, "exercise")} from your recent sessions.`)
  const estimated = main.filter((e) => e.recommendedWeightKg !== null && e.weightSource === "estimate").length
  if (estimated > 0) {
    lines.push(
      `Starting loads on ${plural(estimated, "exercise")} are light first guesses from your body weight and experience. Log what you lift and they adjust.`,
    )
  }
  const swapped = main.filter((e) => e.replacedFromExerciseId !== null).length
  if (swapped > 0) lines.push(`${plural(swapped, "exercise")} swapped by you.`)
  for (const note of workout.notes ?? []) lines.push(note)
  return lines
}
