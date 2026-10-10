"use client"

import { useReducedMotion } from "motion/react"

import { MUSCLE_LABELS, type Exercise, type Muscle } from "@/lib/exercises/types"
import { cn } from "@/lib/utils"

type View = "front" | "back"

/** The map is colour only, so its label names the muscles it highlights. */
function muscleSummary(exercise: Pick<Exercise, "primaryMuscle" | "secondaryMuscles">): string {
  const primary = MUSCLE_LABELS[exercise.primaryMuscle]
  if (exercise.secondaryMuscles.length === 0) return primary
  return `${primary}, also ${exercise.secondaryMuscles.map((m) => MUSCLE_LABELS[m]).join(", ")}`
}

/* ------------------------------------------------------------------ */
/* Silhouette (left half, mirrored) — viewBox 0 0 200 400              */
/* ------------------------------------------------------------------ */
const HALF_BODY = [
  // torso: shoulder → waist → hip (left half, x ≤ 100)
  "M100 76 L66 82 C58 86 56 100 57 118 L60 160 C61 182 64 200 66 216 L100 220 Z",
  // arm: upper arm → forearm → hand
  "M58 86 C46 92 40 112 38 134 L32 190 C30 206 30 218 33 226 L45 226 C48 214 50 200 52 188 L58 140 C60 124 62 108 66 98 Z",
  // leg: thigh → shin → foot
  "M66 216 L63 300 C62 332 66 362 68 388 L92 388 C94 362 97 332 97 300 L100 222 Z",
]
const HEAD = { cx: 100, cy: 34, rx: 21, ry: 26 }
const NECK = "M90 56 L110 56 L112 78 L88 78 Z"

/* ------------------------------------------------------------------ */
/* Muscle regions. `mirror` regions are drawn for both halves.         */
/* ------------------------------------------------------------------ */
interface Region {
  muscle: Muscle
  view: View
  /** Ellipse [cx, cy, rx, ry, rotateDeg?] or a path `d`. */
  ellipse?: [number, number, number, number, number?]
  d?: string
  mirror: boolean
}

const REGIONS: Region[] = [
  // front
  { muscle: "neck", view: "front", d: "M90 58 L110 58 L111 77 L89 77 Z", mirror: false },
  { muscle: "upper_chest", view: "front", d: "M68 86 C80 83 96 85 100 90 L100 100 C92 98 78 98 68 100 Z", mirror: true },
  { muscle: "chest", view: "front", d: "M68 100 C78 98 92 98 100 100 L100 124 C90 130 74 126 66 112 Z", mirror: true },
  { muscle: "front_delts", view: "front", ellipse: [60, 96, 11, 13, -15], mirror: true },
  { muscle: "side_delts", view: "front", ellipse: [49, 102, 7, 13, -10], mirror: true },
  { muscle: "biceps", view: "front", ellipse: [50, 134, 8, 20, 8], mirror: true },
  { muscle: "forearms", view: "front", ellipse: [40, 184, 7, 26, 5], mirror: true },
  { muscle: "abs", view: "front", d: "M86 128 L114 128 L112 192 C108 198 92 198 88 192 Z", mirror: false },
  { muscle: "obliques", view: "front", d: "M70 128 L84 128 L86 192 C78 186 72 164 70 128 Z", mirror: true },
  { muscle: "hip_flexors", view: "front", ellipse: [84, 212, 11, 8, 25], mirror: true },
  { muscle: "abductors", view: "front", ellipse: [70, 236, 7, 18, 0], mirror: true },
  { muscle: "quads", view: "front", ellipse: [82, 268, 14, 46, 0], mirror: true },
  { muscle: "adductors", view: "front", ellipse: [95, 252, 5, 30, 0], mirror: true },
  { muscle: "calves", view: "front", ellipse: [80, 340, 8, 30, 0], mirror: true },
  // back
  { muscle: "neck", view: "back", d: "M90 58 L110 58 L111 77 L89 77 Z", mirror: false },
  { muscle: "traps", view: "back", d: "M100 78 L64 90 C76 96 92 106 100 134 Z", mirror: true },
  { muscle: "rear_delts", view: "back", ellipse: [58, 98, 11, 13, 15], mirror: true },
  { muscle: "side_delts", view: "back", ellipse: [49, 102, 7, 13, 10], mirror: true },
  { muscle: "upper_back", view: "back", d: "M68 100 L100 110 L100 140 L74 138 C70 126 68 112 68 100 Z", mirror: true },
  { muscle: "lats", view: "back", d: "M66 126 L100 142 L100 190 C88 190 74 178 66 150 Z", mirror: true },
  { muscle: "lower_back", view: "back", d: "M86 162 L114 162 L112 212 L88 212 Z", mirror: false },
  { muscle: "triceps", view: "back", ellipse: [50, 134, 8, 20, 8], mirror: true },
  { muscle: "forearms", view: "back", ellipse: [40, 184, 7, 26, 5], mirror: true },
  { muscle: "glutes", view: "back", ellipse: [82, 228, 16, 20, 0], mirror: true },
  { muscle: "abductors", view: "back", ellipse: [68, 236, 6, 16, 0], mirror: true },
  { muscle: "hamstrings", view: "back", ellipse: [82, 288, 13, 44, 0], mirror: true },
  { muscle: "adductors", view: "back", ellipse: [95, 252, 5, 30, 0], mirror: true },
  { muscle: "calves", view: "back", ellipse: [80, 342, 10, 32, 0], mirror: true },
]

const MUSCLE_VIEW: Record<Muscle, View | "both"> = {
  chest: "front",
  upper_chest: "front",
  front_delts: "front",
  side_delts: "both",
  rear_delts: "back",
  lats: "back",
  upper_back: "back",
  traps: "back",
  lower_back: "back",
  biceps: "front",
  triceps: "back",
  forearms: "both",
  quads: "front",
  hamstrings: "back",
  glutes: "back",
  calves: "back",
  adductors: "front",
  abductors: "both",
  hip_flexors: "front",
  abs: "front",
  obliques: "front",
  neck: "both",
  full_body: "both",
  cardiovascular: "both",
}

const MIRROR = "translate(200 0) scale(-1 1)"

function Shape({ region, className, style }: { region: Region; className?: string; style?: React.CSSProperties }) {
  if (region.ellipse) {
    const [cx, cy, rx, ry, rot = 0] = region.ellipse
    return (
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(${rot} ${cx} ${cy})`} className={className} style={style} />
    )
  }
  return <path d={region.d} className={className} style={style} />
}

function Figure({
  view,
  primary,
  secondary,
  pulse,
}: {
  view: View
  /** null lights up the whole silhouette (full-body / cardio). */
  primary: Muscle | null
  secondary: Set<Muscle>
  pulse: boolean
}) {
  const regions = REGIONS.filter((r) => r.view === view)
  const wholeBody = primary === null
  const tone = (m: Muscle): "primary" | "secondary" | "muted" =>
    m === primary ? "primary" : secondary.has(m) ? "secondary" : "muted"
  const glowId = `glow-${view}`

  return (
    <svg
      viewBox="0 0 200 400"
      className={cn("h-full w-auto max-w-full", pulse && "animate-pulse-soft")}
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* body: the whole silhouette lights up for full-body and cardio work */}
      <g
        className={wholeBody ? "fill-volt/45 stroke-volt/70" : "fill-surface-3 stroke-border"}
        strokeWidth={1}
        filter={wholeBody ? `url(#${glowId})` : undefined}
      >
        <ellipse cx={HEAD.cx} cy={HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} />
        <path d={NECK} />
        {HALF_BODY.map((d) => (
          <path key={d} d={d} strokeLinejoin="round" />
        ))}
        <g transform={MIRROR}>
          {HALF_BODY.map((d) => (
            <path key={d} d={d} strokeLinejoin="round" />
          ))}
        </g>
      </g>
      {/* muscles */}
      {(["muted", "secondary", "primary"] as const).map((layer) => (
        <g
          key={layer}
          className={layer === "muted" ? "fill-foreground/8" : "fill-volt"}
          style={layer === "secondary" ? { opacity: 0.4 } : undefined}
          filter={layer === "primary" ? `url(#${glowId})` : undefined}
        >
          {regions
            .filter((r) => tone(r.muscle) === layer)
            .map((r) => (
              <g key={`${r.muscle}-${r.view}`}>
                <Shape region={r} />
                {r.mirror ? (
                  <g transform={MIRROR}>
                    <Shape region={r} />
                  </g>
                ) : null}
              </g>
            ))}
        </g>
      ))}
    </svg>
  )
}

/**
 * The card's visual: a stylised anatomical silhouette with the exercise's muscles highlighted
 * (primary in volt with a glow, secondary at 40%). Shows the front or back view depending on
 * where the primary muscle lives, or both for full-body and cardio work. If the exercise ships
 * an image or video, that is rendered instead.
 */
export function ExerciseMedia({ exercise, className }: { exercise: Exercise; className?: string }) {
  const reducedMotion = useReducedMotion()

  if (exercise.videoUrl) {
    return (
      <video
        className={cn("h-full w-full object-cover", className)}
        src={exercise.videoUrl}
        poster={exercise.imageUrl}
        muted
        loop
        playsInline
        autoPlay={!reducedMotion}
        preload="metadata"
        aria-label={`${exercise.name} demonstration`}
      />
    )
  }
  if (exercise.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- library media is static and uncropped; no optimizer needed
      <img
        className={cn("h-full w-full object-cover", className)}
        src={exercise.imageUrl}
        alt={`${exercise.name} demonstration`}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    )
  }

  const primary = exercise.primaryMuscle
  const wholeBody = primary === "full_body" || primary === "cardiovascular"
  const placement = MUSCLE_VIEW[primary]
  const views: View[] = placement === "both" ? ["front", "back"] : [placement]
  const secondary = new Set(exercise.secondaryMuscles)
  const pulse = wholeBody && !reducedMotion

  return (
    <div
      className={cn("flex h-full w-full items-center justify-center gap-6 px-4 py-3", className)}
      role="img"
      aria-label={`Muscle map for ${exercise.name}: ${muscleSummary(exercise)}`}
    >
      {views.map((view) => (
        <Figure
          key={view}
          view={view}
          primary={wholeBody ? null : primary}
          secondary={wholeBody ? new Set<Muscle>() : secondary}
          pulse={pulse}
        />
      ))}
    </div>
  )
}
