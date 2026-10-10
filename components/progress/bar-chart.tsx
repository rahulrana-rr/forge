"use client"

import { useRef, useState, type PointerEvent } from "react"

import { cn } from "@/lib/utils"

import { useElementWidth } from "./use-element-width"

export interface BarDatum {
  key: string
  value: number
  /** Readout label for this bar, e.g. "Week of 15 Sep". */
  label: string
  /** Optional x-axis tick under this bar. */
  axisLabel?: string
}

const TOP_PAD = 20
const AXIS_BAND = 20
const MAX_BAR_WIDTH = 24
const MIN_GAP = 4
const LABEL_INSET = 16

/**
 * Single-series column chart drawn as inline SVG in real pixels. Bars are capped at 24px with a
 * 4px rounded data-end on a hairline baseline. Touch or hover a column to read it; the readout
 * line under the plot always shows the latest column by default so no value is tooltip-only.
 */
export function BarChart({
  data,
  ariaLabel,
  formatValue,
  formatCap = formatValue,
  plotHeight = 112,
  className,
}: {
  data: BarDatum[]
  /** Summarises the whole series for assistive tech. */
  ariaLabel: string
  formatValue: (value: number) => string
  /** Shorter format for the label on the column cap; defaults to formatValue. */
  formatCap?: (value: number) => string
  plotHeight?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useElementWidth(ref)
  const [hovered, setHovered] = useState<number | null>(null)

  const n = data.length
  const max = data.reduce((m, d) => Math.max(m, d.value), 0)
  const height = TOP_PAD + plotHeight + AXIS_BAND
  const baseline = TOP_PAD + plotHeight
  const band = n > 0 ? width / n : 0
  const barWidth = Math.max(2, Math.min(MAX_BAR_WIDTH, band - MIN_GAP))
  const current = hovered ?? n - 1
  const shown = current >= 0 ? data[current] : undefined

  function indexFromEvent(e: PointerEvent<SVGSVGElement>): number | null {
    if (n === 0 || band <= 0) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    return Math.min(n - 1, Math.max(0, Math.floor(x / band)))
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
            <line x1={0} x2={width} y1={baseline + 0.5} y2={baseline + 0.5} stroke="var(--border)" strokeWidth={1} />
            {data.map((d, i) => {
              const x = round(i * band + (band - barWidth) / 2)
              const h = max > 0 ? round((d.value / max) * plotHeight) : 0
              const isCurrent = i === current
              const dimmed = hovered != null && !isCurrent
              const labelX = Math.min(width - LABEL_INSET, Math.max(LABEL_INSET, x + barWidth / 2))
              return (
                <g key={d.key}>
                  {h > 0 ? (
                    <path
                      d={roundedBar(x, baseline - h, barWidth, h)}
                      fill="var(--chart-1)"
                      opacity={dimmed ? 0.4 : 1}
                      className="transition-opacity duration-150"
                    />
                  ) : (
                    <rect x={x} y={baseline - 2} width={barWidth} height={2} fill="var(--surface-3)" />
                  )}
                  {isCurrent && h > 0 ? (
                    <text
                      x={labelX}
                      y={baseline - h - 6}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill="var(--foreground)"
                      stroke="var(--card)"
                      strokeWidth={3}
                      paintOrder="stroke"
                      className="text-stat"
                    >
                      {formatCap(d.value)}
                    </text>
                  ) : null}
                  {d.axisLabel ? (
                    <text
                      x={x}
                      y={height - 5}
                      fontSize={10}
                      fontWeight={600}
                      letterSpacing="0.08em"
                      fill="var(--muted-foreground)"
                      className="uppercase"
                    >
                      {d.axisLabel}
                    </text>
                  ) : null}
                </g>
              )
            })}
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

/** Column with 4px rounded top corners and a square base at the baseline. */
function roundedBar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  const bottom = y + h
  return [
    `M${x},${bottom}`,
    `V${round(y + r)}`,
    `Q${x},${y} ${round(x + r)},${y}`,
    `H${round(x + w - r)}`,
    `Q${round(x + w)},${y} ${round(x + w)},${round(y + r)}`,
    `V${bottom}`,
    "Z",
  ].join(" ")
}
