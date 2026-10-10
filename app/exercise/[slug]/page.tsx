import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"

import { ExerciseDetailsContent, type ExerciseAlternative } from "@/components/workout/exercise-details-content"
import { EXERCISES, getExercise, getExerciseBySlug } from "@/lib/exercises"
import { MUSCLE_LABELS } from "@/lib/exercises/types"

type Params = Promise<{ slug: string }>

export function generateStaticParams(): { slug: string }[] {
  return EXERCISES.map((e) => ({ slug: e.slug }))
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const exercise = getExerciseBySlug(slug)
  if (!exercise) return { title: "Exercise not found" }
  return {
    title: exercise.name,
    description: `${exercise.name}: how to do it, muscles worked (${MUSCLE_LABELS[exercise.primaryMuscle]}), coach tips, common mistakes and your history.`,
  }
}

export default async function ExercisePage({ params }: { params: Params }) {
  const { slug } = await params
  const exercise = getExerciseBySlug(slug)
  if (!exercise) notFound()

  // Resolved here so the client bundle never needs the exercise library to show one exercise.
  const alternatives: ExerciseAlternative[] = exercise.alternativeExercises.flatMap((id) => {
    const alt = getExercise(id)
    return alt ? [{ id: alt.id, slug: alt.slug, name: alt.name, primaryMuscle: alt.primaryMuscle, equipment: alt.equipment }] : []
  })

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col px-5 pt-safe pb-safe">
      <header className="flex items-center py-3">
        <Link
          href="/today"
          className="-ml-2 inline-flex h-11 items-center gap-0.5 rounded-xl pr-3 pl-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
        >
          <ChevronLeftIcon className="size-5" aria-hidden="true" />
          Today
        </Link>
      </header>
      <ExerciseDetailsContent exercise={exercise} alternatives={alternatives} className="pb-10" />
    </main>
  )
}
