import { useMemo, useRef } from 'react'
import { Map as MapIcon } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Badge } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { formatStaleness, hexColor } from '@renderer/lib/utils'
import {
  calculateBounds,
  normalizePoint,
  normalizePoints,
  unionBounds,
  type Bounds,
  type Point
} from '@renderer/core/engines/geometry'
import { placeTrackMapLabels } from './trackMap/labelLayout'
import { TrackMapDriverMarker } from './trackMap/TrackMapDriverMarker'
import {
  reconcileLivePositions,
  fillMissingFromTracks,
  type PositionTrack
} from './trackMap/positionTracking'
import type { DriverDot } from './trackMap/types'

const CX = 150
const CY = 100
const RX = 120
const RY = 74
const LIVE_INTERPOLATION_MS = 900
const LIVE_INTERPOLATION_PERFORMANCE_MS = 1_000
const REPLAY_INTERPOLATION_MS = 280
const REPLAY_INTERPOLATION_PERFORMANCE_MS = 620
/** Position is a ~2 Hz high-rate feed; this many quiet ms means it stopped, not just jittered. */
const POSITION_STALE_MS = 5_000
/** Dead-reckoning distance cap: ~5% of the 300x200 viewBox diagonal. */
const MAX_EXTRAPOLATION_DISTANCE = 0.05 * Math.hypot(300, 200)

interface TrackGeometry {
  bounds: ReturnType<typeof calculateBounds>
  path: string
  dots: DriverDot[]
}

/** progress (0..1) → point on the stylized circuit oval (start/finish at top). */
function pointAt(progress: number): { x: number; y: number } {
  const angle = progress * Math.PI * 2 - Math.PI / 2
  return { x: CX + RX * Math.cos(angle), y: CY + RY * Math.sin(angle) }
}

function trackMapAnimationConfig(options: {
  isLiveSnapshot: boolean
  performanceMode: boolean
  playing: boolean
  reducedMotion: boolean
}): { animate: boolean; durationMs: number } {
  const durationMs = options.isLiveSnapshot
    ? options.performanceMode
      ? LIVE_INTERPOLATION_PERFORMANCE_MS
      : LIVE_INTERPOLATION_MS
    : options.performanceMode
      ? REPLAY_INTERPOLATION_PERFORMANCE_MS
      : REPLAY_INTERPOLATION_MS
  return {
    animate: !options.reducedMotion && (options.isLiveSnapshot || options.playing),
    durationMs
  }
}

export function TrackMap() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const setFocus = useSessionStore((s) => s.setFocusDriver)
  const focusDriver = useSessionStore((s) => s.focusDriver)
  const playing = useSessionStore((s) => s.playing)
  const getDiagnostics = useSessionStore((s) => s.getDiagnostics)
  const favorites = useSettingsStore((s) => s.favorites)
  const performanceMode = useSettingsStore((s) => s.performanceMode)
  const reducedMotion = useSettingsStore((s) => s.theme.reducedMotion)

  const hasCoordinatePositions = snapshot?.availability.positions === true
  const isLiveSnapshot = snapshot?.availability.live === true

  const trace = snapshot?.trackPath ?? []
  const traceBounds = useMemo(() => calculateBounds(trace), [trace])

  // Framing is sticky: once the map has been sized to a circuit it never
  // rescales, so cars move across a fixed picture instead of the picture moving
  // under them. Cleared when the session (or its traced outline) changes.
  const frameRef = useRef<{ key: string; bounds: Bounds | null }>({ key: '', bounds: null })
  // Rolling per-driver velocity, for bounded dead-reckoning through a brief
  // live position outage (see trackMap/positionTracking.ts).
  const positionTrackRef = useRef<Map<number, PositionTrack>>(new Map())
  // Sticky label placements to reduce jitter from the greedy search algorithm
  // (hysteresis in placeTrackMapLabels only switches if meaningfully better).
  const labelPlacementsRef = useRef<Map<number, ReturnType<typeof placeTrackMapLabels>[0]>>(
    new Map()
  )

  const geometry = useMemo<TrackGeometry>(() => {
    if (!snapshot) return { bounds: null, path: '', dots: [] }

    const meta = new Map(snapshot.drivers.map((d) => [d.number, d]))
    const retiredDrivers = new Set(
      snapshot.timing
        .filter((t) => t.retired || t.status === 'RETIRED' || t.status === 'DNF')
        .map((t) => t.driverNumber)
    )
    const inPitDrivers = new Set(
      snapshot.timing.filter((t) => t.inPit || t.status === 'IN_PIT').map((t) => t.driverNumber)
    )
    const fastestDriver = snapshot.timing.find((entry) => entry.isFastestLap)?.driverNumber ?? null
    const driverDots: DriverDot[] = []
    let path = ''

    if (hasCoordinatePositions) {
      const currentPoints = snapshot.positions.flatMap((position) =>
        position.x == null || position.y == null ? [] : [{ x: position.x, y: position.y }]
      )

      // Keyed on session ONLY, not trace length: the outline can go from no
      // trace -> an open best-effort trace -> a closed one, each a DIFFERENT
      // (and typically SMALLER-at-first) box than whatever car positions had
      // already been accumulated. Resetting bounds to `traceBounds` alone at
      // that moment discarded that accumulated extent and replaced it with a
      // narrower one, so drivers standing in track sections the not-yet-
      // complete trace didn't cover yet suddenly rendered outside the loop —
      // then the box slowly re-grew back via live positions, reading as a
      // reflow/flicker right when the outline first appeared. The trace's own
      // bounds are now unioned in below every tick instead, so a newly
      // available or upgraded trace can only ever EXTEND the box, never
      // shrink or replace it.
      const frameKey = snapshot.session.id
      if (frameRef.current.key !== frameKey) {
        frameRef.current = { key: frameKey, bounds: traceBounds }
      }
      // Extend to hold any car outside the traced racing line — a pit lane, a
      // run-off excursion — rather than drawing it off the edge of the panel.
      const currentBounds = unionBounds(
        unionBounds(frameRef.current.bounds, traceBounds),
        calculateBounds(currentPoints)
      )
      frameRef.current.bounds = currentBounds

      if (currentBounds) {
        const config = { viewBoxWidth: 300, viewBoxHeight: 200, padding: 15 }
        // The outline MUST be normalized against the very same box as the cars,
        // or the circuit and the field are drawn in two different frames.
        if (trace.length >= 2) {
          path = normalizePoints(trace, currentBounds, config)
            .map((point) => `${point.x},${point.y}`)
            .join(' ')
        }

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

    // Dead-reckoning only means anything for a genuinely live, coordinate-mode
    // map — replay has no "now" to extrapolate towards, and schematic mode has
    // no x/y velocity to project.
    let finalDots = driverDots
    if (isLiveSnapshot && hasCoordinatePositions) {
      const nowMs = Date.now()
      const reconciled = reconcileLivePositions(
        driverDots,
        positionTrackRef.current,
        nowMs,
        snapshot.feedFreshness?.Position ?? 0,
        POSITION_STALE_MS,
        MAX_EXTRAPOLATION_DISTANCE
      )
      // A driver entirely missing from THIS frame's real positions — not just
      // frozen, but absent — would otherwise vanish from the map for exactly
      // one tick and reappear the next. Bridge it from their rolling track the
      // same way a frozen-but-present reading is bridged.
      finalDots = fillMissingFromTracks(
        reconciled,
        positionTrackRef.current,
        (driverNumber, point) => {
          if (retiredDrivers.has(driverNumber)) return null
          const d = meta.get(driverNumber)
          const timingEntry = snapshot.timing.find((t) => t.driverNumber === driverNumber)
          if (!d || !timingEntry) return null
          return {
            number: driverNumber,
            code: d.code,
            color: hexColor(d.teamColour ?? null),
            position: timingEntry.position,
            isRetired: false,
            isInPit: inPitDrivers.has(driverNumber),
            isFastestLap: fastestDriver === driverNumber,
            ...point
          }
        },
        nowMs,
        MAX_EXTRAPOLATION_DISTANCE,
        POSITION_STALE_MS
      )
    }

    return {
      bounds: frameRef.current.bounds,
      path,
      dots: finalDots.sort((a, b) => (b.position ?? 99) - (a.position ?? 99))
    }
  }, [snapshot, hasCoordinatePositions, trace, traceBounds])

  const dots = geometry.dots
  const favoriteNumbers = useMemo(() => new Set(favorites), [favorites])
  const labelPlacements = useMemo(() => {
    const inputs = dots.map((dot) => ({
      number: dot.number,
      code: dot.code,
      x: dot.x,
      y: dot.y,
      position: dot.position,
      focused: focusDriver === dot.number,
      favorite: favoriteNumbers.has(dot.number),
      isFastestLap: dot.isFastestLap
    }))
    const placements = placeTrackMapLabels(inputs, labelPlacementsRef.current)
    // Update the sticky ref for next frame's hysteresis
    labelPlacementsRef.current = new Map(placements.map((p) => [p.number, p]))
    return new Map(placements.map((placement) => [placement.number, placement]))
  }, [dots, favoriteNumbers, focusDriver])
  const animation = trackMapAnimationConfig({
    isLiveSnapshot,
    performanceMode,
    playing,
    reducedMotion
  })

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
      ? 'rgb(var(--warn))'
      : snapshot.trackStatus === 'RED'
        ? 'rgb(var(--danger))'
        : 'rgb(var(--fg-subtle))'

  const stale = formatStaleness(snapshot.feedFreshness?.Position, POSITION_STALE_MS)

  return (
    <WidgetFrame
      title="Track Map"
      icon={<MapIcon />}
      actions={
        <>
          {!hasCoordinatePositions ? (
            <Badge tone="neutral">Schematic</Badge>
          ) : (
            <Badge tone="good">Live positions</Badge>
          )}
          {hasCoordinatePositions && !geometry.path && (
            <span
              title={(() => {
                const d = getDiagnostics()
                const base =
                  "No car has completed a full lap since connecting yet, and no cached outline exists for this race weekend — positions are real, the outline just isn't traced yet."
                if (!d) return base
                return (
                  `${base}\n\nDiagnostics — position samples: ${d.trackRawPointCount}, ` +
                  `reference car: ${d.trackReferenceDriver == null ? 'none yet' : `#${d.trackReferenceDriver}`}, ` +
                  `open trace: ${d.trackOpenTraceLength} pts, adopted: ${d.trackAdoptedLength} pts, ` +
                  `closed: ${d.trackPathClosed ? 'yes' : 'no'}`
                )
              })()}
            >
              <Badge tone="neutral">Tracing outline…</Badge>
            </span>
          )}
          {stale && (
            <span title="Position feed has stopped delivering new data">
              <Badge tone="warn">{stale}</Badge>
            </span>
          )}
        </>
      }
      noPadding
      scroll={false}
    >
      <div className="flex h-full w-full items-center justify-center p-2">
        <svg viewBox="0 0 300 200" className="h-full w-full">
          {hasCoordinatePositions && geometry.path ? (
            <>
              {/* Soft halo carrying track-status colour (grey/amber/red), then a
                  crisp bright core so the shape reads clearly against a dark
                  panel with 20 colourful driver dots drawn on top of it — the
                  single thin 25%-opacity line this used to be was functionally
                  invisible at that contrast. */}
              <polyline
                points={geometry.path}
                fill="none"
                stroke={trackTint}
                strokeWidth={8}
                strokeOpacity={0.45}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <polyline
                points={geometry.path}
                fill="none"
                stroke="rgb(var(--fg))"
                strokeWidth={2}
                strokeOpacity={0.9}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </>
          ) : hasCoordinatePositions ? null : (
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
              <ellipse
                cx={CX}
                cy={CY}
                rx={RX}
                ry={RY}
                fill="none"
                stroke={trackTint}
                strokeWidth={1.5}
              />
              {/* start/finish */}
              <line
                x1={CX}
                y1={CY - RY - 6}
                x2={CX}
                y2={CY - RY + 6}
                stroke="rgb(var(--fg))"
                strokeWidth={2}
              />
            </>
          )}

          {dots.map((dot) => (
            <TrackMapDriverMarker
              key={dot.number}
              dot={dot}
              focused={focusDriver === dot.number}
              favorite={favoriteNumbers.has(dot.number)}
              animate={animation.animate}
              durationMs={animation.durationMs}
              onFocus={setFocus}
              labelPlacement={labelPlacements.get(dot.number)}
            />
          ))}
        </svg>
      </div>
    </WidgetFrame>
  )
}
