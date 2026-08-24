import type { TelemetryOverlayPoint } from '@renderer/core/engines/TelemetryCompare'

/**
 * Overlaid speed trace for two drivers' most recent completed lap
 * (APP_IMPROVEMENT_ROADMAP.md P2 item 22), aligned by elapsed time since each
 * lap's own start. A break in either line is a real decimation gap — no
 * fabricated interpolation across missing samples.
 */
export function TelemetryOverlayChart({
  points,
  colorA,
  colorB,
  width = 220,
  height = 56
}: {
  readonly points: readonly TelemetryOverlayPoint[]
  readonly colorA: string
  readonly colorB: string
  readonly width?: number
  readonly height?: number
}) {
  const speedsA = points.map((p) => p.a?.speed ?? null)
  const speedsB = points.map((p) => p.b?.speed ?? null)
  const known = [...speedsA, ...speedsB].filter((v): v is number => v != null)
  if (points.length < 2 || known.length < 2) return null

  const min = Math.min(...known)
  const max = Math.max(...known)
  const range = max - min || 1
  const pad = 2

  function pathFor(values: readonly (number | null)[]): string {
    let d = ''
    let drawing = false
    values.forEach((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - pad * 2)
      if (v == null) {
        drawing = false
        return
      }
      const y = pad + (1 - (v - min) / range) * (height - pad * 2)
      d += `${drawing ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `
      drawing = true
    })
    return d.trim()
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="Speed trace comparison, aligned by elapsed time since lap start"
    >
      <path
        d={pathFor(speedsA)}
        fill="none"
        stroke={colorA}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={pathFor(speedsB)}
        fill="none"
        stroke={colorB}
        strokeWidth={1.5}
        strokeDasharray="3 2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
