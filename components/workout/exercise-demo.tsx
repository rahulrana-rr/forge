"use client"

import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "motion/react"
import { PauseIcon, PlayIcon } from "lucide-react"

import {
  LICENSE_LABELS,
  LICENSE_URLS,
  SOURCE_LABELS,
  mediaFor,
  type ExerciseFrames,
  type ExerciseVideo,
  type MediaCredit,
} from "@/lib/exercises/media"
import type { Exercise } from "@/lib/exercises/types"
import { cn } from "@/lib/utils"

/**
 * play    = the card on top: video autoplays (unless reduced motion / data saver), photos animate.
 * preload = the card underneath: fetch everything now so the swipe lands on a ready demo.
 * idle    = lists and off-screen use: lazy, nothing plays.
 */
export type DemoMode = "play" | "preload" | "idle"

interface ExerciseDemoProps {
  exercise: Exercise
  mode: DemoMode
  /** "card": fills the media area, minimal chrome. "detail": larger, side-by-side photos, linked credits. */
  variant: "card" | "detail"
  /** Rendered when the exercise has no media or every source failed (the body map). */
  fallback: React.ReactNode
  className?: string
}

type Connection = { saveData?: boolean; effectiveType?: string }

/** Data Saver on, or a 2G-class connection: never autoplay video. */
function useDataSaving(): boolean {
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const c = (navigator as Navigator & { connection?: Connection }).connection
    if (!c) return
    const read = () => setSaving(c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g")
    read()
    const target = c as unknown as EventTarget
    target.addEventListener?.("change", read)
    return () => target.removeEventListener?.("change", read)
  }, [])
  return saving
}

/**
 * Exercise demonstration: a real video loop when one exists, otherwise start and finish photos,
 * otherwise an illustrated animation, otherwise the fallback. Media is static and served from the
 * CDN path in lib/exercises/media.ts.
 */
export function ExerciseDemo({ exercise, mode, variant, fallback, className }: ExerciseDemoProps) {
  const media = mediaFor(exercise.id)
  const [videoFailed, setVideoFailed] = useState(false)
  const [framesFailed, setFramesFailed] = useState(false)
  const [animationFailed, setAnimationFailed] = useState(false)

  const video = media?.video && !videoFailed ? media.video : null
  const frames = media?.frames && !framesFailed ? media.frames : null
  const animation = media?.animation && !animationFailed ? media.animation : null

  if (video) {
    return <VideoDemo key={video.mp4} video={video} kind="Video" name={exercise.name} mode={mode} variant={variant} onFail={() => setVideoFailed(true)} className={className} />
  }
  if (frames) {
    return <FramesDemo key={frames.start} frames={frames} name={exercise.name} mode={mode} variant={variant} onFail={() => setFramesFailed(true)} className={className} />
  }
  if (animation) {
    return (
      <VideoDemo
        key={animation.mp4}
        video={animation}
        kind="Animation"
        name={exercise.name}
        mode={mode}
        variant={variant}
        onFail={() => setAnimationFailed(true)}
        className={className}
      />
    )
  }
  return <>{fallback}</>
}

/* ------------------------------------------------------------------ */
/* Video (filmed demo or illustrated animation)                        */
/* ------------------------------------------------------------------ */

function VideoDemo({
  video,
  kind,
  name,
  mode,
  variant,
  onFail,
  className,
}: {
  video: ExerciseVideo
  kind: "Video" | "Animation"
  name: string
  mode: DemoMode
  variant: "card" | "detail"
  onFail: () => void
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const reducedMotion = useReducedMotion() ?? false
  const dataSaving = useDataSaving()
  // null = follow the automatic rule; true/false = the viewer pressed play/pause.
  const [choice, setChoice] = useState<boolean | null>(null)
  const [playing, setPlaying] = useState(false)

  const wantsPlay = mode === "play" && (choice ?? (!reducedMotion && !dataSaving))

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // React does not always reflect `muted` onto a server-rendered element, and browsers only
    // allow autoplay for muted video, so set the property before every attempt.
    el.muted = true
    el.defaultMuted = true
    const tryPlay = () => {
      if (!wantsPlay || document.hidden || !el.paused) return
      // A rejected promise (interrupted load, blocked autoplay) leaves the poster and play button.
      el.play().catch(() => setPlaying(false))
    }
    const sync = () => {
      if (wantsPlay && !document.hidden) tryPlay()
      else el.pause()
    }
    sync()
    // The first attempt can be interrupted while the source is still being chosen: retry once
    // the browser says it can play.
    el.addEventListener("canplay", tryPlay)
    document.addEventListener("visibilitychange", sync)
    return () => {
      el.removeEventListener("canplay", tryPlay)
      document.removeEventListener("visibilitychange", sync)
    }
  }, [wantsPlay])

  const toggle = () => setChoice(!(playing || wantsPlay))

  return (
    <figure
      // Illustrations are drawn on white: keep the whole figure in frame on a matching background.
      className={cn("relative h-full w-full overflow-hidden", video.fit === "contain" ? "bg-white" : "bg-surface-3", className)}
      data-autoplay={wantsPlay ? "on" : "off"}
      data-reduced-motion={reducedMotion ? "1" : "0"}
      data-data-saving={dataSaving ? "1" : "0"}
    >
      <video
        ref={ref}
        muted
        loop
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        preload={mode === "idle" ? "none" : "auto"}
        poster={video.poster}
        width={video.width}
        height={video.height}
        aria-label={`${name} demonstration ${kind === "Video" ? "video" : "animation"}`}
        className={cn("h-full w-full", video.fit === "contain" ? "object-contain" : "object-cover")}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        <source src={video.webm} type="video/webm" />
        {/* When every source fails the error fires on the last <source>, not on the video. */}
        <source src={video.mp4} type="video/mp4" onError={onFail} />
      </video>

      {mode === "play" && !playing ? (
        <button
          type="button"
          onClick={toggle}
          // Keep the tap away from the card's drag and tap-to-open-details handlers.
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Play ${name} ${kind === "Video" ? "video" : "animation"}`}
          className="absolute inset-0 m-auto flex size-14 items-center justify-center rounded-full bg-background/70 text-foreground shadow-float backdrop-blur-sm outline-none focus-visible:ring-3 focus-visible:ring-ring [&_svg]:size-6"
        >
          <PlayIcon aria-hidden="true" className="translate-x-0.5" />
        </button>
      ) : null}
      {variant === "detail" && playing ? (
        <button
          type="button"
          onClick={toggle}
          aria-label={`Pause ${name} ${kind === "Video" ? "video" : "animation"}`}
          className="absolute bottom-3 left-3 flex size-11 items-center justify-center rounded-full bg-background/70 text-foreground backdrop-blur-sm outline-none focus-visible:ring-3 focus-visible:ring-ring [&_svg]:size-5"
        >
          <PauseIcon aria-hidden="true" />
        </button>
      ) : null}

      <Credit credit={video.credit} kind={kind} variant={variant} />
    </figure>
  )
}

/* ------------------------------------------------------------------ */
/* Start / finish photos                                               */
/* ------------------------------------------------------------------ */

function FramesDemo({
  frames,
  name,
  mode,
  variant,
  onFail,
  className,
}: {
  frames: ExerciseFrames
  name: string
  mode: DemoMode
  variant: "card" | "detail"
  onFail: () => void
  className?: string
}) {
  const reducedMotion = useReducedMotion() ?? false
  const eager = mode !== "idle"
  const imgProps = {
    width: frames.width,
    height: frames.height,
    decoding: "async" as const,
    loading: eager ? ("eager" as const) : ("lazy" as const),
    fetchPriority: mode === "play" ? ("high" as const) : ("low" as const),
    onError: onFail,
    draggable: false,
  }

  // Details and reduced motion: show both positions side by side, labelled.
  if (variant === "detail" || reducedMotion) {
    return (
      <figure className={cn("relative grid h-full w-full grid-cols-2 gap-px overflow-hidden bg-border", className)}>
        {(
          [
            ["Start", frames.start],
            ["Finish", frames.end],
          ] as const
        ).map(([label, src]) => (
          <div key={label} className="relative min-h-0 bg-surface-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- static CDN media, sized by the manifest */}
            <img src={src} alt={`${name}, ${label.toLowerCase()} position`} className="h-full w-full object-cover" {...imgProps} />
            <span className="absolute top-2 left-2 rounded-full bg-background/75 px-2 py-0.5 text-label text-foreground backdrop-blur-sm">
              {label}
            </span>
          </div>
        ))}
        <Credit credit={frames.credit} kind="Photos" variant={variant} />
      </figure>
    )
  }

  return (
    <figure className={cn("relative h-full w-full overflow-hidden bg-surface-3", className)} aria-label={`${name}: start and finish positions`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static CDN media, sized by the manifest */}
      <img src={frames.start} alt={`${name}, start position`} className="absolute inset-0 h-full w-full object-cover" {...imgProps} />
      {/* eslint-disable-next-line @next/next/no-img-element -- static CDN media, sized by the manifest */}
      <img
        src={frames.end}
        alt={`${name}, finish position`}
        className={cn("absolute inset-0 h-full w-full object-cover opacity-0", mode === "play" && "animate-demo-crossfade")}
        {...imgProps}
      />
    </figure>
  )
}

/* ------------------------------------------------------------------ */
/* Credit                                                              */
/* ------------------------------------------------------------------ */

function Credit({ credit, kind, variant }: { credit: MediaCredit; kind: "Video" | "Photos" | "Animation"; variant: "card" | "detail" }) {
  // Public-domain photos need no credit on the card; the details view always credits.
  if (variant === "card" && credit.license === "Unlicense") return null
  const label = LICENSE_LABELS[credit.license]
  if (variant === "card") {
    return (
      <figcaption className="pointer-events-none absolute right-2 bottom-1.5 max-w-[70%] truncate rounded bg-background/60 px-1.5 py-px text-[0.625rem] leading-4 text-foreground/80 backdrop-blur-sm">
        {kind}: {credit.author} · {SOURCE_LABELS[credit.source]} · {label}
      </figcaption>
    )
  }
  return (
    <figcaption className="absolute right-2 bottom-2 max-w-[80%] rounded-md bg-background/75 px-2 py-1 text-[0.6875rem] leading-4 text-foreground/85 backdrop-blur-sm">
      {kind}:{" "}
      <a href={credit.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
        {credit.author}
      </a>{" "}
      ·{" "}
      <a href={LICENSE_URLS[credit.license]} target="_blank" rel="noreferrer" className="underline underline-offset-2">
        {label}
      </a>
    </figcaption>
  )
}
