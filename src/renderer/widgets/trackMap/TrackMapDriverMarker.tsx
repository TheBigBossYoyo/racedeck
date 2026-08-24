import { memo, useLayoutEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { AnimationFrameBatch } from '@renderer/lib/AnimationFrameBatch'
import type { Point } from '@renderer/core/engines/geometry'
import type { TrackMapLabelPlacement } from './labelLayout'
import type { DriverDot } from './types'

interface TrackMapDriverMarkerProps {
  readonly dot: DriverDot
  readonly focused: boolean
  readonly favorite: boolean
  readonly animate: boolean
  readonly durationMs: number
  readonly onFocus: (driverNumber: number) => void
  readonly labelPlacement?: TrackMapLabelPlacement
}

interface ActiveDotAnimation {
  readonly element: SVGGElement
  readonly from: Point
  readonly to: Point
  readonly started: number
  readonly durationMs: number
  readonly positionRef: MutableRefObject<Point>
}

const dotAnimations = new AnimationFrameBatch<number, ActiveDotAnimation>((animation, now) => {
  const progress = Math.min(1, (now - animation.started) / animation.durationMs)
  const x = animation.from.x + (animation.to.x - animation.from.x) * progress
  const y = animation.from.y + (animation.to.y - animation.from.y) * progress
  animation.positionRef.current = { x, y }
  animation.element.setAttribute('transform', `translate(${x}, ${y})`)
  return progress < 1
})

export const TrackMapDriverMarker = memo(function TrackMapDriverMarker({
  dot,
  focused,
  favorite,
  animate,
  durationMs,
  onFocus,
  labelPlacement
}: TrackMapDriverMarkerProps) {
  const groupRef = useRef<SVGGElement>(null)
  const positionRef = useRef<Point>({ x: dot.x, y: dot.y })

  useLayoutEffect(() => {
    const element = groupRef.current
    if (!element) return
    dotAnimations.cancel(dot.number)

    const from = positionRef.current
    const distance = Math.hypot(dot.x - from.x, dot.y - from.y)
    if (!animate || distance > 70) {
      positionRef.current = { x: dot.x, y: dot.y }
      element.setAttribute('transform', `translate(${dot.x}, ${dot.y})`)
      return
    }

    dotAnimations.schedule(dot.number, {
      element,
      from: { ...from },
      to: { x: dot.x, y: dot.y },
      started: performance.now(),
      durationMs,
      positionRef
    })
    return () => dotAnimations.cancel(dot.number)
  }, [animate, dot.number, dot.x, dot.y, durationMs])

  const faded = dot.isRetired || dot.isInPit
  const markerOpacity = dot.extrapolated ? 0.55 : faded && !focused ? 0.42 : 1
  const radius = getTrackMapMarkerRadius(focused)
  const outlineColor = dot.isFastestLap
    ? 'rgb(var(--purple))'
    : focused
      ? 'rgb(var(--accent))'
      : dot.color
  const labelFill = dot.isFastestLap
    ? 'rgb(var(--purple))'
    : faded && !focused
      ? 'rgb(var(--fg-muted))'
      : 'rgb(var(--fg))'
  const labelDx = labelPlacement ? labelPlacement.x - dot.x : 0
  const labelDy = labelPlacement ? labelPlacement.y - dot.y : 0

  return (
    <g
      ref={groupRef}
      onClick={() => onFocus(dot.number)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onFocus(dot.number)
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${dot.code}, position ${dot.position ?? 'unknown'}${dot.isFastestLap ? ', fastest lap' : ''}${dot.extrapolated ? ', estimated position — feed stalled' : ''}`}
      className="group cursor-pointer outline-none"
      style={{
        willChange: animate ? 'transform' : undefined
      }}
      transform={`translate(${positionRef.current.x}, ${positionRef.current.y})`}
    >
      <circle
        data-testid="track-map-focus-ring"
        r={radius + 6}
        fill="none"
        stroke="rgb(var(--accent))"
        strokeWidth={2.5}
        className="pointer-events-none opacity-0 transition-opacity duration-150 group-focus-visible:opacity-100"
      />
      <g style={{ opacity: markerOpacity, transition: 'opacity 300ms ease' }}>
        {(focused || favorite || dot.isFastestLap) && (
          <circle
            r={radius + 3}
            fill="none"
            stroke={outlineColor}
            strokeWidth={dot.isFastestLap ? 2 : 1.5}
          />
        )}
        <circle
          r={radius}
          fill={dot.color}
          stroke="rgb(var(--bg-base))"
          strokeWidth={1.5}
          strokeDasharray={dot.extrapolated ? '2 1.5' : undefined}
        />
      </g>
      {labelPlacement?.visible && (
        <g className="pointer-events-none select-none">
          <text
            x={labelDx}
            y={labelDy}
            textAnchor={labelPlacement.textAnchor}
            dominantBaseline="middle"
            fontSize={8}
            fontWeight={700}
            fill="none"
            stroke="rgb(var(--bg-base))"
            strokeWidth={3}
            style={{ paintOrder: 'stroke fill' }}
          >
            {labelPlacement.text}
          </text>
          <text
            x={labelDx}
            y={labelDy}
            textAnchor={labelPlacement.textAnchor}
            dominantBaseline="middle"
            fontSize={8}
            fontWeight={700}
            fill={labelFill}
          >
            {labelPlacement.text}
          </text>
        </g>
      )}
    </g>
  )
})

export function getTrackMapMarkerRadius(focused: boolean): number {
  return focused ? 7 : 5.5
}
