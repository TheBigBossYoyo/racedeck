import { cn } from '@renderer/lib/utils'

/**
 * Small pure-SVG line chart for a short numeric series (APP_IMPROVEMENT_ROADMAP.md
 * P1 item 7: tyre trend sparkline). Deliberately not echarts — this is a
 * ~100x28px inline chart for ~6 points, and the chart-lib setup/bundle cost
 * isn't justified at this size; matches the codebase's existing plain-SVG
 * approach in `TrackMap.tsx`.
 */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  tone = 'stroke-fg-muted',
  className
}: {
  readonly values: readonly number[]
  readonly width?: number
  readonly height?: number
  /** Tailwind stroke color class, e.g. "stroke-warn". */
  readonly tone?: string
  readonly className?: string
}) {
  if (values.length < 2) {
    return (
      <div
        className={cn('flex items-center justify-center text-[9px] text-fg-subtle', className)}
        style={{ width, height }}
      >
        —
      </div>
    )
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pad = 2
  const points = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - pad * 2)
      // A rising line reads as "getting worse" (slower lap times higher up),
      // matching the intuitive up-is-more convention of a line chart.
      const y = pad + (1 - (v - min) / range) * (height - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Lap time trend"
    >
      <polyline
        points={points}
        fill="none"
        className={cn(tone, 'stroke-[1.5]')}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
