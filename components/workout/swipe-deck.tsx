"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Ref } from "react"
import { useDrag } from "@use-gesture/react"
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react"
import {
  CheckIcon,
  FlagIcon,
  StarIcon,
  InfoIcon,
  ListIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SkipForwardIcon,
  TimerIcon,
  Undo2Icon,
} from "lucide-react"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ExerciseCard } from "@/components/workout/exercise-card"
import { toggleFavourite, useIsFavourite } from "@/components/workout/favourite"
import { ExerciseDetailsDrawer } from "@/components/workout/exercise-details-drawer"
import { ReplaceSheet } from "@/components/workout/replace-sheet"
import { SetLogger } from "@/components/workout/set-logger"
import { buildDefaultSets, spokenPrescription } from "@/components/workout/prescription"
import { useElementSize } from "@/hooks/use-element-size"
import type { SetLog, Units } from "@/lib/domain/types"
import type { WorkoutExercise } from "@/lib/engine/types"
import { getExercise } from "@/lib/exercises"
import type { Exercise } from "@/lib/exercises/types"
import { haptic } from "@/lib/haptics"
import { useHistoryStore, useProfileStore, useWorkoutStore } from "@/lib/store"
import { cn } from "@/lib/utils"

type Direction = 1 | -1

const SWIPE_FRACTION = 0.38
const VELOCITY_THRESHOLD = 0.6 // px/ms
const VELOCITY_MIN_DISTANCE = 60
const SPRING = { type: "spring", stiffness: 420, damping: 36 } as const
// Generous rest thresholds: the card is off-screen long before the spring fully settles.
const FLY = { type: "spring", stiffness: 260, damping: 28, restDelta: 4, restSpeed: 40 } as const

/**
 * True when completing this slot by swipe would save a loaded lift without a weight: a main-phase,
 * externally loaded exercise the user has never logged a weight for and has no load set for today.
 * In that case the set logger opens instead, so progression has real numbers to work from.
 */
function needsFirstLog(slot: WorkoutExercise): boolean {
  if (slot.phase !== "main") return false
  const exercise = getExercise(slot.exerciseId)
  if (!exercise || exercise.loadType !== "external") return false
  const best = useHistoryStore.getState().progress[slot.exerciseId]?.bestWeightKg
  if (best != null && best > 0) return false
  return slot.recommendedWeightKg == null || slot.weightSource === "estimate"
}

/**
 * Whether finishing a slot starts the rest timer. Not after the cool-down, and not after a
 * conditioning finisher: its rests sit between rounds, and the rest after the final round is not
 * part of the block (the engine budgets sets − 1 rests).
 */
function restsAfter(slot: WorkoutExercise): boolean {
  return slot.phase !== "cooldown" && slot.role !== "finisher" && slot.restSeconds > 0
}

function cardKey(slot: WorkoutExercise): string {
  return `${slot.slotId}:${slot.exerciseId}`
}

/* ------------------------------------------------------------------ */
/* Deck card: owns its motion values so exits never fight the next one */
/* ------------------------------------------------------------------ */

interface DeckCardHandle {
  /** Starts the fly-out; false when this card is already flying (nothing will commit). */
  swipe: (dir: Direction) => boolean
}

/**
 * Cards register their imperative handle by key and get back their own unregister. A shared ref
 * would be nulled by the exiting card's unmount (AnimatePresence keeps it rendered with its last
 * props), and an undo can mount a fresh card under the same key while the old one still exits, so
 * a card only ever removes the entry if it is still its own.
 */
type HandleRegistry = (key: string, handle: DeckCardHandle) => () => void

interface DeckCardProps {
  cardKey: string
  register: HandleRegistry
  slot: WorkoutExercise
  exercise: Exercise
  position: "current" | "next"
  index: number
  total: number
  units: Units
  /** The workout's split, for the card's role label. */
  split: string | null
  width: number
  reducedMotion: boolean
  /** A fly-out started (gesture, button or key): the deck blocks other actions until it commits. */
  onFlyStart: () => void
  /** The fly-out finished. `key` is the card that flew, so the deck only acts if it is still current. */
  onCommit: (dir: Direction, key: string) => void
  /** Return true to cancel a completed gesture (the card springs back), e.g. to ask for a weight first. */
  onIntercept: (dir: Direction) => boolean
  onTap: () => void
}

const STACK_VARIANTS = {
  current: { scale: 1, y: 0, opacity: 1 },
  next: { scale: 0.94, y: 16, opacity: 0.7 },
}

function DeckCard({ cardKey, register, slot, exercise, position, index, total, units, split, width, reducedMotion, onFlyStart, onCommit, onIntercept, onTap }: DeckCardProps) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotate = useTransform(x, (v) => v / 18)
  const doneOpacity = useTransform(x, [24, 120], [0, 1])
  const replaceOpacity = useTransform(x, [-120, -24], [1, 0])
  const doneTint = useTransform(x, [0, 160], [0, 0.18])
  const replaceTint = useTransform(x, [-160, 0], [0.18, 0])
  const flyingRef = useRef(false)
  const isCurrent = position === "current"

  // A card flies once. It never comes back on screen: an undo that brings its exercise back mounts
  // a fresh card (the deck bumps the key's generation on commit), so x/flyingRef need no reset.
  const fly = useCallback(
    (dir: Direction, velocityPxPerMs = 0): boolean => {
      if (flyingRef.current) return false
      flyingRef.current = true
      onFlyStart()
      const target = dir * Math.max(width, 320) * 1.4
      void (async () => {
        try {
          if (reducedMotion) {
            await animate(x, target, { duration: 0.12 })
          } else {
            void animate(y, y.get() + 24, FLY)
            await animate(x, target, { ...FLY, velocity: velocityPxPerMs * 1000 })
          }
        } finally {
          onCommit(dir, cardKey)
        }
      })()
      return true
    },
    [cardKey, onCommit, onFlyStart, reducedMotion, width, x, y],
  )

  useEffect(() => {
    if (!isCurrent) return
    return register(cardKey, { swipe: (dir) => fly(dir) })
  }, [cardKey, fly, isCurrent, register])

  const bind = useDrag(
    ({ active, offset: [ox, oy], velocity: [vx], direction: [dx], last, tap }) => {
      if (tap) {
        onTap()
        return
      }
      if (flyingRef.current) return
      if (active) {
        x.set(ox)
        y.set(Math.max(-48, Math.min(48, oy * 0.3)))
        return
      }
      if (!last) return
      const dir: Direction = ox >= 0 ? 1 : -1
      const distance = Math.abs(ox)
      const flick = vx > VELOCITY_THRESHOLD && distance > VELOCITY_MIN_DISTANCE && Math.sign(dx) === dir
      const pass = distance > SWIPE_FRACTION * Math.max(width, 1) || flick
      if (pass && !onIntercept(dir)) {
        fly(dir, vx)
      } else {
        animate(x, 0, SPRING)
        animate(y, 0, SPRING)
      }
    },
    {
      enabled: isCurrent,
      filterTaps: true,
      from: () => [x.get(), y.get()],
      pointer: { capture: true },
    },
  )

  return (
    <motion.div
      className="absolute inset-0"
      variants={STACK_VARIANTS}
      initial="next"
      animate={position}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 32 }}
      style={{ zIndex: isCurrent ? 2 : 1, pointerEvents: isCurrent ? "auto" : "none" }}
      aria-hidden={!isCurrent}
    >
      <motion.div
        className="relative h-full w-full will-change-transform"
        style={{ x, y, rotate }}
        data-testid={isCurrent ? "deck-card-current" : "deck-card-next"}
      >
        <div
          {...(isCurrent ? bind() : {})}
          className={cn("h-full w-full touch-none select-none", isCurrent && "cursor-grab active:cursor-grabbing")}
        >
          <ExerciseCard exercise={exercise} slot={slot} index={index} total={total} units={units} split={split} dimmed={!isCurrent} demoMode={isCurrent ? "play" : "preload"} />
        </div>
        {isCurrent ? (
          <>
            <motion.div
              className="pointer-events-none absolute inset-0 rounded-3xl bg-volt"
              style={{ opacity: doneTint }}
              aria-hidden="true"
            />
            <motion.div
              className="pointer-events-none absolute inset-0 rounded-3xl bg-replace"
              style={{ opacity: replaceTint }}
              aria-hidden="true"
            />
            <motion.div
              className="pointer-events-none absolute top-6 left-5 -rotate-12 rounded-xl border-4 border-volt px-3 py-1 font-heading text-3xl font-black tracking-[0.2em] text-volt uppercase shadow-volt"
              style={{ opacity: doneOpacity }}
              aria-hidden="true"
            >
              Done
            </motion.div>
            <motion.div
              className="pointer-events-none absolute top-6 right-5 rotate-12 rounded-xl border-4 border-replace px-3 py-1 font-heading text-3xl font-black tracking-[0.2em] text-replace uppercase"
              style={{ opacity: replaceOpacity }}
              aria-hidden="true"
            >
              Replace
            </motion.div>
          </>
        ) : null}
      </motion.div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Control buttons                                                     */
/* ------------------------------------------------------------------ */

function SmallControl({
  label,
  onClick,
  disabled,
  children,
  ref,
  ...rest
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  children?: React.ReactNode
  ref?: Ref<HTMLButtonElement>
} & Omit<React.ComponentProps<"button">, "children" | "onClick" | "ref">) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-muted-foreground transition-colors outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring active:scale-95 disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-5"
      {...rest}
    >
      {children}
      <span className="text-[0.625rem] leading-none font-medium">{label}</span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Deck                                                                */
/* ------------------------------------------------------------------ */

export interface SwipeDeckProps {
  units: Units
  /** Rendered between the card stack and the controls (the rest timer); the stack shrinks to make room. */
  overlay?: React.ReactNode
  className?: string
}

/**
 * The card stack. Current card on top, next card underneath. Drag follows the finger with
 * rotation and DONE / REPLACE stamps; past the threshold the card flies out and the store
 * advances. Explicit buttons and keyboard shortcuts do the same without a gesture.
 */
export function SwipeDeck({ units, overlay, className }: SwipeDeckProps) {
  const active = useWorkoutStore((s) => s.active)
  const canUndo = useWorkoutStore((s) => s.canUndo())
  const resting = useWorkoutStore((s) => s.timer.totalSeconds != null)
  const reducedMotion = useReducedMotion() ?? false
  const { ref: areaRef, size } = useElementSize<HTMLDivElement>()
  const handlesRef = useRef(new Map<string, DeckCardHandle>())
  /** True from the moment a card starts flying until it commits; store-changing actions wait. */
  const busyRef = useRef(false)
  /** Undo pressed mid-flight: applied right after the commit, so it undoes that swipe. */
  const undoAfterCommitRef = useRef(false)
  const liveRef = useRef<HTMLParagraphElement>(null)
  const announcedRef = useRef<{ index: number; key: string | null } | null>(null)
  // Bumped per card key on commit. A card brought back by undo then mounts fresh instead of reusing
  // the flown-off instance AnimatePresence may still hold for its exit (stuck off-screen, inert).
  const [generations, setGenerations] = useState<Record<string, number>>({})

  const [loggerOpen, setLoggerOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)

  const exercises = useMemo(() => active?.workout.exercises ?? [], [active])
  const index = active?.currentIndex ?? 0
  const current = exercises[index]
  const favourite = useIsFavourite(current?.exerciseId)
  const next = exercises[index + 1]
  const currentKey = current ? cardKey(current) : null
  const currentExercise = current ? getExercise(current.exerciseId) : undefined
  const nextExercise = next ? getExercise(next.exerciseId) : undefined
  const lastSession = useHistoryStore((s) => (current ? s.progress[current.exerciseId]?.recentSessions[0] : undefined))

  const onFlyStart = useCallback(() => {
    busyRef.current = true
  }, [])

  const undo = useCallback(() => {
    // Never mid-flight (the pending commit would land on the restored slot): queue it instead, so
    // a reflex Undo right after a swipe still undoes that swipe.
    if (busyRef.current) {
      undoAfterCommitRef.current = true
      return
    }
    const store = useWorkoutStore.getState()
    if (!store.canUndo()) return
    store.undo()
    haptic("warning")
    toast("Undone", { duration: 1200 })
  }, [])

  const commit = useCallback((dir: Direction, key: string) => {
    busyRef.current = false
    const undoQueued = undoAfterCommitRef.current
    undoAfterCommitRef.current = false
    const store = useWorkoutStore.getState()
    const slot = store.currentExercise()
    // Act only on the slot the card belonged to: if the deck moved during the flight, do nothing.
    const acted = Boolean(slot && cardKey(slot) === key)
    if (slot && acted) {
      if (dir === 1) {
        store.completeCurrent(buildDefaultSets(slot, getExercise(slot.exerciseId)))
        haptic("success")
        const after = useWorkoutStore.getState()
        if (restsAfter(slot) && !after.timer.running && !after.isAtEnd()) {
          after.startRest(slot.restSeconds)
        }
      } else {
        store.skipCurrent()
        haptic("tap")
      }
    }
    // After the store update, so the flown card exits under its old key.
    setGenerations((g) => ({ ...g, [key]: (g[key] ?? 0) + 1 }))
    if (acted && undoQueued) undo()
  }, [undo])

  const register = useCallback<HandleRegistry>((key, handle) => {
    handlesRef.current.set(key, handle)
    return () => {
      if (handlesRef.current.get(key) === handle) handlesRef.current.delete(key)
    }
  }, [])

  const intercept = useCallback((dir: Direction) => {
    if (dir !== 1) return false
    const slot = useWorkoutStore.getState().currentExercise()
    if (!slot || !needsFirstLog(slot)) return false
    haptic("tap")
    setLoggerOpen(true)
    return true
  }, [])

  const swipe = useCallback((dir: Direction) => {
    if (busyRef.current) return
    const slot = useWorkoutStore.getState().currentExercise()
    const handle = slot ? handlesRef.current.get(cardKey(slot)) : undefined
    if (!handle || intercept(dir)) return
    handle.swipe(dir)
  }, [intercept])


  const startRest = useCallback(() => {
    const store = useWorkoutStore.getState()
    const slot = store.currentExercise()
    if (!slot || slot.restSeconds <= 0 || store.timer.totalSeconds != null) return
    store.startRest(slot.restSeconds)
    haptic("tap")
  }, [])

  const logSets = useCallback((sets: SetLog[]) => {
    const store = useWorkoutStore.getState()
    const slot = store.currentExercise()
    if (!slot) return
    store.completeCurrent(sets)
    haptic("success")
    const after = useWorkoutStore.getState()
    if (restsAfter(slot) && !after.timer.running && !after.isAtEnd()) {
      after.startRest(slot.restSeconds)
    }
  }, [])

  const savePrescription = useCallback(
    (patch: { sets: number; weightKg: number | null; reps: number | null; durationSeconds: number | null }) => {
      const store = useWorkoutStore.getState()
      const slot = store.currentExercise()
      if (!slot) return
      store.updateCurrentPrescription({
        sets: patch.sets,
        recommendedWeightKg: patch.weightKg,
        reps: slot.reps && patch.reps != null ? [Math.min(slot.reps[0], patch.reps), patch.reps] : slot.reps,
        durationSeconds: patch.durationSeconds ?? slot.durationSeconds,
      })
      toast("Saved for this exercise", { duration: 1500 })
    },
    [],
  )

  const openLogger = useCallback(() => {
    if (!busyRef.current) setLoggerOpen(true)
  }, [])

  const skipWithoutReplace = useCallback(() => {
    if (busyRef.current) return
    useWorkoutStore.getState().skipWithoutReplace()
    haptic("tap")
  }, [])

  const flagUnsuitable = useCallback(() => {
    if (busyRef.current) return
    const workout = useWorkoutStore.getState()
    const profileStore = useProfileStore.getState()
    const slot = workout.currentExercise()
    const profile = profileStore.profile
    if (!slot || !profile) return
    if (!profile.excludedExerciseIds.includes(slot.exerciseId)) {
      // An unsuitable exercise is no longer a favourite either.
      profileStore.updateProfile({
        excludedExerciseIds: [...profile.excludedExerciseIds, slot.exerciseId],
        preferredExerciseIds: profile.preferredExerciseIds.filter((id) => id !== slot.exerciseId),
      })
    }
    workout.skipCurrent()
    haptic("tap")
    toast("Flagged — you will not see it again", { duration: 1800 })
  }, [])

  const toggleCurrentFavourite = useCallback(() => {
    const slot = useWorkoutStore.getState().currentExercise()
    if (!slot) return
    const now = toggleFavourite(slot.exerciseId)
    if (now == null) return
    haptic("tick")
    toast(now ? "Added to favourites" : "Removed from favourites", {
      description: now ? "Future workouts pick it more often." : undefined,
      duration: 1800,
    })
  }, [])

  // Screen readers: every path that changes the card (swipe, buttons, keys, logger, menu, replace
  // sheet, undo) lands here, so one status message covers them all. Written straight to the live
  // region so a message never waits on a render.
  useEffect(() => {
    const prev = announcedRef.current
    announcedRef.current = { index, key: currentKey }
    const region = liveRef.current
    if (!prev || !region || !active) return
    const currentExercise = current ? getExercise(current.exerciseId) : undefined
    const name = current ? (currentExercise?.name ?? "the next exercise") : null
    const what = current && name ? `${name}, ${spokenPrescription(current, currentExercise)}` : null
    let message = ""
    if (index > prev.index) {
      const acted = active.workout.exercises[prev.index]
      const verb = acted && active.logs[acted.slotId]?.status === "completed" ? "Done" : "Skipped"
      message = what ? `${verb}. Next: ${what}` : `${verb}.`
    } else if (index < prev.index) {
      message = what ? `Back to ${what}` : ""
    } else if (currentKey !== prev.key && what) {
      message = `Replaced with ${what}`
    }
    if (message) region.textContent = message
  }, [active, current, currentKey, index])

  // Keyboard: → / Enter = done, ← = replace, Backspace / U = undo, Space = pause/resume rest,
  // R = start rest. Held keys do not repeat, and nothing acts unless the workout is running.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (useWorkoutStore.getState().active?.status !== "active") return
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
      const onControl = Boolean(target?.closest("button, a, [role='button']"))
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault()
          swipe(1)
          break
        case "Enter":
          if (onControl) return
          e.preventDefault()
          swipe(1)
          break
        case "ArrowLeft":
          e.preventDefault()
          swipe(-1)
          break
        case "Backspace":
        case "u":
        case "U":
          e.preventDefault()
          undo()
          break
        case "r":
        case "R":
          e.preventDefault()
          startRest()
          break
        case " ": {
          if (onControl) return
          const store = useWorkoutStore.getState()
          if (store.timer.totalSeconds == null) return
          e.preventDefault()
          if (store.timer.running) store.pauseRest()
          else store.resumeRest()
          break
        }
        default:
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [startRest, swipe, undo])

  if (!active || !current || !currentExercise) return null

  const deckKey = (slot: WorkoutExercise) => `${cardKey(slot)}#${generations[cardKey(slot)] ?? 0}`

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <p ref={liveRef} role="status" aria-live="polite" className="sr-only" />
      <div ref={areaRef} className="relative min-h-0 flex-1 px-4 pt-2 pb-2">
        <div className="relative h-full w-full">
          <AnimatePresence initial={false}>
            {next && nextExercise ? (
              <DeckCard
                key={deckKey(next)}
                cardKey={cardKey(next)}
                register={register}
                slot={next}
                exercise={nextExercise}
                position="next"
                index={index + 1}
                total={exercises.length}
                units={units}
                split={active?.workout.split ?? null}
                width={size.width}
                reducedMotion={reducedMotion}
                onFlyStart={onFlyStart}
                onCommit={commit}
                onIntercept={intercept}
                onTap={() => {}}
              />
            ) : null}
            <DeckCard
              key={deckKey(current)}
              cardKey={cardKey(current)}
              register={register}
              slot={current}
              exercise={currentExercise}
              position="current"
              index={index}
              total={exercises.length}
              units={units}
              split={active?.workout.split ?? null}
              width={size.width}
              reducedMotion={reducedMotion}
              onFlyStart={onFlyStart}
              onCommit={commit}
              onIntercept={intercept}
              onTap={() => setDetailsOpen(true)}
            />
          </AnimatePresence>
        </div>
      </div>
      {overlay}

      <div className="flex flex-col gap-2 px-5 pt-1 pb-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => swipe(-1)}
            aria-label="Replace exercise"
            className="flex size-16 items-center justify-center rounded-full border border-replace/40 bg-replace/12 text-replace transition-transform outline-none hover:bg-replace/20 focus-visible:ring-3 focus-visible:ring-replace/50 active:scale-95 [&_svg]:size-7"
          >
            <RefreshCwIcon aria-hidden="true" />
          </button>
          <p className="text-label text-muted-foreground" aria-hidden="true">
            Swipe or tap
          </p>
          <button
            type="button"
            onClick={() => swipe(1)}
            aria-label="Mark exercise done"
            className="flex size-20 items-center justify-center rounded-full bg-volt text-volt-foreground shadow-volt transition-transform outline-none hover:bg-volt/90 focus-visible:ring-3 focus-visible:ring-ring active:scale-95 [&_svg]:size-9"
          >
            <CheckIcon strokeWidth={3} aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center justify-between" role="toolbar" aria-label="Workout controls">
          <SmallControl label="Undo" onClick={undo} disabled={!canUndo}>
            <Undo2Icon aria-hidden="true" />
          </SmallControl>
          <SmallControl label="Edit" onClick={openLogger}>
            <PencilIcon aria-hidden="true" />
          </SmallControl>
          <SmallControl
            label="Rest"
            aria-label="Start rest timer"
            title="Start rest timer between sets"
            onClick={startRest}
            disabled={resting || current.restSeconds <= 0}
          >
            <TimerIcon aria-hidden="true" />
          </SmallControl>
          <SmallControl label="Details" onClick={() => setDetailsOpen(true)}>
            <InfoIcon aria-hidden="true" />
          </SmallControl>
          <DropdownMenu>
            <DropdownMenuTrigger render={<SmallControl label="More" />}>
              <MoreHorizontalIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="min-w-56 rounded-xl p-1.5">
              <DropdownMenuItem className="h-11 rounded-lg px-3" onClick={skipWithoutReplace}>
                <SkipForwardIcon aria-hidden="true" />
                Skip without replacing
              </DropdownMenuItem>
              <DropdownMenuItem className="h-11 rounded-lg px-3" onClick={() => setReplaceOpen(true)}>
                <ListIcon aria-hidden="true" />
                Pick a replacement…
              </DropdownMenuItem>
              <DropdownMenuItem className="h-11 rounded-lg px-3" onClick={toggleCurrentFavourite}>
                <StarIcon aria-hidden="true" className={cn(favourite && "fill-current")} />
                {favourite ? "Remove from favourites" : "Add to favourites"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="h-11 rounded-lg px-3" variant="destructive" onClick={flagUnsuitable}>
                <FlagIcon aria-hidden="true" />
                Flag as unsuitable
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <SetLogger
        open={loggerOpen}
        onOpenChange={setLoggerOpen}
        slot={current}
        exercise={currentExercise}
        units={units}
        lastSession={lastSession}
        onLog={logSets}
        onSave={savePrescription}
      />
      <ReplaceSheet open={replaceOpen} onOpenChange={setReplaceOpen} />
      <ExerciseDetailsDrawer exerciseId={currentExercise.id} open={detailsOpen} onOpenChange={setDetailsOpen} slot={current} />
    </div>
  )
}
