import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { Map as MapIcon } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Badge } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { hexColor } from '@renderer/lib/utils'
import { calculateBounds, normalizePoint, normalizePoints, type Point } from '@renderer/core/engines/geometry'
import { AnimationFrameBatch } from '@renderer/lib/AnimationFrameBatch'

const CX = 150
const CY = 100
const RX = 120
const RY = 74
interface DriverDot extends Point {
  number: number
  code: string
  color: string
  position: number | null
  isRetired: boolean
  isInPit: boolean
  isFastestLap: boolean
}

interface TrackGeometry {
  bounds: ReturnType<typeof calculateBounds>
  path: string
}

interface ActiveDotAnimation {
  element: SVGGElement
  from: Point
  to: Point
  started: number
  durationMs: number
  positionRef: React.MutableRefObject<Point>
}

const dotAnimations = new AnimationFrameBatch<number, ActiveDotAnimation>((animation, now) => {
  const progress = Math.min(1, (now - animation.started) / animation.durationMs)
  const x = animation.from.x + (animation.to.x - animation.from.x) * progress
  const y = animation.from.y + (animation.to.y - animation.from.y) * progress
  animation.positionRef.current = { x, y }
  animation.element.setAttribute('transform', `translate(${x}, ${y})`)
  return progress < 1
})

/** progress (0..1) → point on the stylized circuit oval (start/finish at top). */
function pointAt(progress: number): { x: number; y: number } {
  const angle = progress * Math.PI * 2 - Math.PI / 2
  return { x: CX + RX * Math.cos(angle), y: CY + RY * Math.sin(angle) }
}

export function TrackMap() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const setFocus = useSessionStore((s) => s.setFocusDriver)
  const focusDriver = useSessionStore((s) => s.focusDriver)
  const playing = useSessionStore((s) => s.playing)
  const favorites = useSettingsStore((s) => s.favorites)
  const performanceMode = useSettingsStore((s) => s.performanceMode)
  const reducedMotion = useSettingsStore((s) => s.theme.reducedMotion)

  const isLive = snapshot?.availability.positions === true

  const geometry = useMemo<TrackGeometry>(() => {
    const trace = snapshot?.trackPath ?? []
    const bounds = calculateBounds(trace)
    if (!bounds || trace.length < 2) return { bounds, path: '' }
    const normalized = normalizePoints(trace, bounds, {
      viewBoxWidth: 300,
      viewBoxHeight: 200,
      padding: 15
    })
    return { bounds, path: normalized.map((point) => `${point.x},${point.y}`).join(' ') }
  }, [snapshot?.trackPath])

  const dots = useMemo(() => {
    if (!snapshot) return []

    const meta = new Map(snapshot.drivers.map((d) => [d.number, d]))
    const driverDots: DriverDot[] = []

    if (isLive) {
      const currentPoints = snapshot.positions
        .filter((position) => position.x != null && position.y != null)
        .map((position) => ({ x: position.x!, y: position.y! }))
      const currentBounds = geometry.bounds ?? calculateBounds(currentPoints)

      if (currentBounds) {
        const config = { viewBoxWidth: 300, viewBoxHeight: 200, padding: 15 }
        const retiredDrivers = new Set(
          snapshot.timing
            .filter((t) => t.retired || t.status === 'RETIRED' || t.status === 'DNF')
            .map((t) => t.driverNumber)
        )
        const inPitDrivers = new Set(
          snapshot.timing
            .filter((t) => t.inPit || t.status === 'IN_PIT')
            .map((t) => t.driverNumber)
        )
        const fastestDriver = snapshot.timing.find((entry) => entry.isFastestLap)?.driverNumber ?? null

        for (const p of snapshot.positions) {
          if (p.x == null || p.y == null) continue
          const normPt = normalizePoint({ x: p.x, y: p.y }, currentBounds, config)
          driverDots.push({
            number: p.driverNumber,
            code: meta.get(p.driverNumber)?.code ?? String(p.driverNumber),
            color: hexColor(meta.get(p.driverNumber)?.teamColour ?? null),
            position: p.position,
            isRetired: retiredDrivers.has(p.driverNumber),
            isInPit: inPitDrivers.has(p.driverNumber),
            isFastestLap: fastestDriver === p.driverNumber,
            ...normPt
          })
        }
      }
    } else {
      // schematic mode
      for (const p of snapshot.positions) {
        if (p.lapProgress == null) continue
        const pt = pointAt(p.lapProgress)
        driverDots.push({
          number: p.driverNumber,
          code: meta.get(p.driverNumber)?.code ?? String(p.driverNumber),
          color: hexColor(meta.get(p.driverNumber)?.teamColour ?? null),
          position: p.position,
          isRetired: false,
          isInPit: false,
          isFastestLap: snapshot.timing.some(
            (entry) => entry.driverNumber === p.driverNumber && entry.isFastestLap
          ),
          ...pt
        })
      }
    }

    return driverDots.sort((a, b) => (b.position ?? 99) - (a.position ?? 99))
  }, [snapshot, isLive, geometry.bounds])

  if (!snapshot || (!snapshot.availability.positions && !snapshot.availability.positionProgress)) {
    // On a live F1 session, car GPS (Position.z) is gated behind an F1 TV
    // subscription — an anonymous "public timing" connection never receives it.
    // Say so, rather than a dead "will appear when available".
    const liveNoPositions = snapshot?.availability.live === true
    return (
      <WidgetFrame title="Track Map" icon={<MapIcon />}>
        <EmptyState
          title="No position data"
          hint={
            liveNoPositions
              ? 'Live car positions need an F1 TV subscription. Open Go Live and sign in with F1 TV to unlock the track map — or replay the session once F1 publishes its archive.'
              : 'Car positions will appear here when available.'
          }
        />
      </WidgetFrame>
    )
  }

  const trackTint =
    snapshot.trackStatus === 'SAFETY_CAR' || snapshot.trackStatus === 'VSC'
      ? 'rgb(245 158 11)'
      : snapshot.trackStatus === 'RED'
        ? 'rgb(244 63 94)'
        : 'rgb(64 70 92)'

  return (
    <WidgetFrame
      title="Track Map"
      icon={<MapIcon />}
      actions={
        !isLive ? (
          <Badge tone="neutral">Schematic</Badge>
        ) : (
          <Badge tone="good">Live positions</Badge>
        )
      }
      noPadding
      scroll={false}
    >
      <div className="flex h-full w-full items-center justify-center p-2">
        <svg viewBox="0 0 300 200" className="h-full w-full">
          {isLive && geometry.path ? (
            <polyline
              points={geometry.path}
              fill="none"
              stroke={trackTint}
              strokeWidth={3}
              strokeOpacity={0.25}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : (
            <>
              {/* Circuit outline */}
              <ellipse
                cx={CX}
                cy={CY}
                rx={RX}
                ry={RY}
                fill="none"
                stroke={trackTint}
                strokeWidth={9}
                strokeOpacity={0.35}
              />
              <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="none" stroke={trackTint} strokeWidth={1.5} />
              {/* start/finish */}
              <line x1={CX} y1={CY - RY - 6} x2={CX} y2={CY - RY + 6} stroke="#E9ECF5" strokeWidth={2} />
            </>
          )}

          {dots.map((dot) => (
            <AnimatedDriverDot
              key={dot.number}
              dot={dot}
              focused={focusDriver === dot.number}
              favorite={favorites.includes(dot.number)}
              animate={playing && !reducedMotion}
              durationMs={performanceMode ? 620 : 280}
              onFocus={setFocus}
            />
          ))}
        </svg>
      </div>
    </WidgetFrame>
  )
}

const AnimatedDriverDot = memo(function AnimatedDriverDot({
  dot,
  focused,
  favorite,
  animate,
  durationMs,
  onFocus
}: {
  dot: DriverDot
  focused: boolean
  favorite: boolean
  animate: boolean
  durationMs: number
  onFocus: (driverNumber: number) => void
}) {
  const groupRef = useRef<SVGGElement>(null)
  const positionRef = useRef({ x: dot.x, y: dot.y })

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
  }, [dot.number, dot.x, dot.y, animate, durationMs])

  const faded = dot.isRetired || dot.isInPit
  const radius = focused ? 7 : 5.5
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
      aria-label={`${dot.code}, position ${dot.position ?? 'unknown'}${dot.isFastestLap ? ', fastest lap' : ''}`}
      className="cursor-pointer"
      style={{
        opacity: faded && !focused ? 0.4 : 1,
        transition: 'opacity 300ms ease',
        willChange: animate ? 'transform' : undefined,
        outline: 'none'
      }}
      transform={`translate(${positionRef.current.x}, ${positionRef.current.y})`}
    >
      {(focused || favorite || dot.isFastestLap) && (
        <circle
          r={radius + 3}
          fill="none"
          stroke={dot.isFastestLap ? 'rgb(168 85 247)' : focused ? 'rgb(34 211 238)' : dot.color}
          strokeWidth={dot.isFastestLap ? 2 : 1.5}
        />
      )}
      <circle r={radius} fill={dot.color} stroke="#06070b" strokeWidth={1.5} />
      <text
        y={-radius - 4}
        textAnchor="middle"
        fontSize={8}
        fontWeight={700}
        fill={dot.isFastestLap ? '#C084FC' : '#E9ECF5'}
        className="pointer-events-none select-none"
      >
        {dot.code}{dot.isFastestLap ? ' · FL' : ''}
      </text>
    </g>
  )
})
