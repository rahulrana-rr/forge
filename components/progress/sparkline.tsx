"use client"

import { useRef, useState, type PointerEvent } from "react"

import { cn } from "@/lib/utils"

import { useElementWidth } from "./use-element-width"

export interface SparkPoint {
  key: string
  value: number
  /** Readout label for this point, e.g. "Tue, 30 Sep". */
  label: string
}

const PAD_X = 10
const PAD_TOP = 18
const PAD_BOTTOM = 8

/**
 * Small single-series line: 2px stroke, 10% area wash, ring-separated markers, the latest point
 * in the accent and direct-labelled. Hover or touch to read any point; the readout under the plot
 * shows the latest point by default.
 */
export function Sparkline({
  points,
  ariaLabel,
  formatValue,
  height = 72,
  className,
}: {
  points: SparkPoint[]
  ariaLabel: string
  formatValue: (value: number) => string
  height?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useElementWidth(ref)
  const [hovered, setHovered] = useState<number | null>(null)

  const n = points.length
  const values = points.map((p) => p.value)
  const min = n ? Math.min(...values) : 0
  const max = n ? Math.max(...values) : 0
  const flat = max === min
  const plotHeight = height - PAD_TOP - PAD_BOTTOM
  const step = n > 1 ? (width - PAD_X * 2) / (n - 1) : 0
  const current = hovered ?? n - 1
  const shown = current >= 0 ? points[current] : undefined

  const xs = points.map((_, i) => round(n > 1 ? PAD_X + i * step : width / 2))
  const ys = points.map((p) =>
    round(flat ? PAD_TOP + plotHeight / 2 : PAD_TOP + (1 - (p.value - min) / (max - min)) * plotHeight),
  )
  const bottom = height - PAD_BOTTOM
  const linePath = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x},${ys[i]}`).join(" ")
  const areaPath = n > 1 ? `${linePath} L${xs[n - 1]},${bottom} L${xs[0]},${bottom} Z` : ""

  function indexFromEvent(e: PointerEvent<SVGSVGElement>): number | null {
    if (n === 0) return null
    if (n === 1 || step <= 0) return 0
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    return Math.min(n - 1, Math.max(0, Math.round((x - PAD_X) / step)))
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div ref={ref} role="img" aria-label={ariaLabel} className="w-full touch-pan-y" style={{ height }}>
        {width > 0 && n > 0 ? (
          <svg
            width={width}
            height={height}
            aria-hidden="true"
            className="block overflow-visible"
            onPointerMove={(e) => setHovered(indexFromEvent(e))}
            onPointerDown={(e) => setHovered(indexFromEvent(e))}
            onPointerLeave={() => setHovered(null)}
          >
            {areaPath ? <path d={areaPath} fill="var(--chart-1)" opacity={0.1} /> : null}
            {n > 1 ? (
              <path
                d={linePath}
                fill="none"
                stroke="var(--chart-1)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {points.map((p, i) => {
              const isCurrent = i === current
              return (
                <circle
                  key={p.key}
                  cx={xs[i]}
                  cy={ys[i]}
                  r={isCurrent ? 5 : 3.5}
                  fill="var(--chart-1)"
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              )
            })}
            {shown ? (
              <text
                x={Math.min(width - 20, Math.max(20, xs[current] ?? 0))}
                y={(ys[current] ?? PAD_TOP) - 10}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill="var(--foreground)"
                stroke="var(--card)"
                strokeWidth={3}
                paintOrder="stroke"
                className="text-stat"
              >
                {formatValue(shown.value)}
              </text>
            ) : null}
          </svg>
        ) : null}
      </div>
      {shown ? (
        <p className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{shown.label}</span>
          <span className="text-stat font-semibold text-foreground">{formatValue(shown.value)}</span>
        </p>
      ) : null}
    </div>
  )
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}
