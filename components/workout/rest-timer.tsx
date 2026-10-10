"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  BellIcon,
  BellOffIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SkipForwardIcon,
} from "lucide-react"

import { useCountdown } from "@/hooks/use-countdown"
import { useTimerSound } from "@/hooks/use-timer-sound"
import { formatDuration } from "@/lib/dates"
import { haptic } from "@/lib/haptics"
import { useWorkoutStore } from "@/lib/store"
import { cn } from "@/lib/utils"

/** Two short sine blips through WebAudio. Never throws. */
function beep() {
  try {
    const ctx = new window.AudioContext()
    const t0 = ctx.currentTime
    for (const [offset, freq] of [
      [0, 880],
      [0.18, 1175],
    ] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + offset)
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + offset)
      osc.stop(t0 + offset + 0.18)
    }
    window.setTimeout(() => void ctx.close(), 600)
  } catch {
    // no audio available
  }
}

const RING_R = 54
const RING_C = 2 * Math.PI * RING_R

function CircleButton({
  label,
  onClick,
  children,
  className,
  compact = false,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-surface-3/80 text-foreground transition-colors outline-none hover:bg-surface-3 focus-visible:ring-3 focus-visible:ring-ring active:scale-95",
        // 44px either way (touch-target rule); compact only shrinks the icon.
        compact ? "size-11 [&_svg]:size-4" : "size-11 [&_svg]:size-5",
        className
      )}
    >
      {children}
    </button>
  )
}

/**
 * Rest timer. Subscribes to the store's timer slice only, so ticking never re-renders the deck.
 * Compact floating bar by default; tap the time for a larger ring. Haptic + optional beep at 0,
 * and a polite screen-reader announcement ("Rest over").
 */
export function RestTimer({ className }: { className?: string }) {
  const timer = useWorkoutStore((s) => s.timer)
  // Each completed exercise starts a new rest; expanding applies to the current rest only, so the
  // larger ring never silently carries over and squeezes the next card.
  const restFor = useWorkoutStore((s) => s.active?.currentIndex ?? -1)
  const remaining = useCountdown(timer)
  const reducedMotion = useReducedMotion()
  const [expandedFor, setExpandedFor] = useState<number | null>(null)
  const expanded = expandedFor === restFor
  const setExpanded = (next: boolean) => setExpandedFor(next ? restFor : null)
  const [sound, setSound] = useTimerSound()
  const visible = timer.totalSeconds != null
  const finishedRef = useRef(false)
  const liveRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (!visible) {
      finishedRef.current = false
      return
    }
    if (remaining > 0 && liveRef.current && liveRef.current.textContent) {
      // Cleared at the start of each rest so the next "Rest over" is announced again.
      liveRef.current.textContent = ""
    }
    if (timer.running && remaining === 0 && !finishedRef.current) {
      finishedRef.current = true
      haptic("success")
      if (sound) beep()
      if (liveRef.current) liveRef.current.textContent = "Rest over"
      useWorkoutStore.getState().skipRest()
    }
  }, [visible, timer.running, remaining, sound])

  const total = timer.totalSeconds ?? 1
  const fraction = Math.max(0, Math.min(1, remaining / total))
  const actions = useWorkoutStore.getState

  const controls = (compact: boolean) => (
    <>
      <CircleButton
        compact={compact}
        label="Subtract 15 seconds"
        onClick={() => actions().adjustRest(-15)}
      >
        <MinusIcon aria-hidden="true" />
      </CircleButton>
      <CircleButton
        compact={compact}
        label={timer.running ? "Pause rest timer" : "Resume rest timer"}
        onClick={() =>
          timer.running ? actions().pauseRest() : actions().resumeRest()
        }
        className="bg-volt text-volt-foreground hover:bg-volt/90"
      >
        {timer.running ? (
          <PauseIcon aria-hidden="true" />
        ) : (
          <PlayIcon aria-hidden="true" />
        )}
      </CircleButton>
      <CircleButton
        compact={compact}
        label="Add 15 seconds"
        onClick={() => actions().adjustRest(15)}
      >
        <PlusIcon aria-hidden="true" />
      </CircleButton>
      <CircleButton
        compact={compact}
        label="Skip rest"
        onClick={() => actions().skipRest()}
      >
        <SkipForwardIcon aria-hidden="true" />
      </CircleButton>
    </>
  )

  return (
    <>
      {/* Always mounted, so the announcement survives the timer unmounting at 0. */}
      <p ref={liveRef} role="status" aria-live="polite" className="sr-only" />
      <AnimatePresence>
        {visible ? (
          <motion.div
            key="rest-timer"
            initial={reducedMotion ? false : { y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className={cn("pointer-events-auto", className)}
            role="timer"
            aria-live="off"
            aria-label={`Rest, ${formatDuration(remaining)} remaining`}
          >
            {expanded ? (
              <div
                className={cn(
                  "mx-auto flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl border border-border p-4 shadow-float glass",
                  // Short screens: ring and controls side by side, so the card keeps its prescription and load.
                  "[@media(max-height:760px)]:flex-row [@media(max-height:760px)]:justify-center [@media(max-height:760px)]:gap-4 [@media(max-height:760px)]:p-3"
                )}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Collapse rest timer"
                  className={cn(
                    "relative flex size-36 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring",
                    "[@media(max-height:760px)]:size-24"
                  )}
                >
                  <svg
                    viewBox="0 0 120 120"
                    className="absolute inset-0 size-full -rotate-90"
                    aria-hidden="true"
                  >
                    <circle
                      cx="60"
                      cy="60"
                      r={RING_R}
                      className="fill-none stroke-surface-3"
                      strokeWidth="6"
                    />
                    <circle
                      cx="60"
                      cy="60"
                      r={RING_R}
                      className="fill-none stroke-volt transition-[stroke-dashoffset] duration-250 ease-linear"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={RING_C}
                      strokeDashoffset={RING_C * (1 - fraction)}
                    />
                  </svg>
                  <span className="flex flex-col items-center leading-none">
                    <span className="text-label text-muted-foreground">
                      Rest
                    </span>
                    <span
                      className={cn(
                        "text-stat text-4xl font-bold",
                        "[@media(max-height:760px)]:text-2xl"
                      )}
                    >
                      {formatDuration(remaining)}
                    </span>
                  </span>
                </button>
                <div
                  className={cn(
                    "flex items-center gap-2",
                    "[@media(max-height:760px)]:grid [@media(max-height:760px)]:grid-cols-3"
                  )}
                >
                  {controls(false)}
                  <CircleButton
                    label={
                      sound ? "Turn timer sound off" : "Turn timer sound on"
                    }
                    onClick={() => setSound(!sound)}
                    className={cn(!sound && "text-muted-foreground")}
                  >
                    {sound ? (
                      <BellIcon aria-hidden="true" />
                    ) : (
                      <BellOffIcon aria-hidden="true" />
                    )}
                  </CircleButton>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-sm items-center gap-1 rounded-full border border-border p-1 shadow-float glass">
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  aria-label="Expand rest timer"
                  className="flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-full pr-1 pl-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring"
                >
                  <span className="relative size-7 shrink-0" aria-hidden="true">
                    <svg
                      viewBox="0 0 120 120"
                      className="absolute inset-0 size-full -rotate-90"
                    >
                      <circle
                        cx="60"
                        cy="60"
                        r={RING_R}
                        className="fill-none stroke-surface-3"
                        strokeWidth="12"
                      />
                      <circle
                        cx="60"
                        cy="60"
                        r={RING_R}
                        className="fill-none stroke-volt transition-[stroke-dashoffset] duration-250 ease-linear"
                        strokeWidth="12"
                        strokeLinecap="round"
                        strokeDasharray={RING_C}
                        strokeDashoffset={RING_C * (1 - fraction)}
                      />
                    </svg>
                  </span>
                  <span className="truncate text-stat text-lg font-bold">
                    {formatDuration(remaining)}
                  </span>
                </button>
                <div className="flex items-center gap-1.5">
                  {controls(true)}
                </div>
              </div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}
