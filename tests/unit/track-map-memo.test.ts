import { describe, expect, it, vi } from 'vitest'
import { calculateBounds, normalizePoints, type Bounds, type Point } from '@renderer/core/engines/geometry'
import { createOutlinePathMemo } from '@renderer/widgets/trackMap/outlinePath'
import { trackMapMarkerPropsEqual } from '@renderer/widgets/trackMap/TrackMapDriverMarker'
import type { DriverDot } from '@renderer/widgets/trackMap/types'

const CONFIG = { viewBoxWidth: 300, viewBoxHeight: 200, padding: 15 }

function loop(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return { x: 1000 * Math.cos(a) + 12.5, y: 600 * Math.sin(a) - 3.25 }
  })
}

/** The expression TrackMap used before the memo, kept as the oracle. */
function legacyPath(trace: Point[], bounds: Bounds): string {
  return normalizePoints(trace, bounds, CONFIG)
    .map((point) => `${point.x},${point.y}`)
    .join(' ')
}

describe('createOutlinePathMemo', () => {
  const trace = loop(700)
  const bounds = calculateBounds(trace) as Bounds

  it('produces exactly the string the un-memoised expression produced', () => {
    const memo = createOutlinePathMemo()
    expect(memo(trace, bounds, CONFIG)).toBe(legacyPath(trace, bounds))
    const wider = { ...bounds, maxX: bounds.maxX + 50 }
    expect(memo(trace, wider, CONFIG)).toBe(legacyPath(trace, wider))
  })

  it('reuses the result for the same trace and equal-valued (but fresh) bounds', () => {
    const memo = createOutlinePathMemo()
    const first = memo(trace, bounds, CONFIG)
    const spy = vi.spyOn(Array.prototype, 'map')
    const second = memo(trace, { ...bounds }, { ...CONFIG })
    const mapCalls = spy.mock.calls.length
    spy.mockRestore()
    expect(second).toBe(first)
    expect(mapCalls).toBe(0)
  })

  it('recomputes when the trace identity or the frame changes', () => {
    const memo = createOutlinePathMemo()
    const a = memo(trace, bounds, CONFIG)
    const shifted = trace.map((p) => ({ x: p.x + 1, y: p.y }))
    expect(memo(shifted, bounds, CONFIG)).toBe(legacyPath(shifted, bounds))
    expect(memo(shifted, bounds, CONFIG)).not.toBe(a)
    const moved = { ...bounds, minY: bounds.minY - 100 }
    expect(memo(shifted, moved, CONFIG)).toBe(legacyPath(shifted, moved))
  })
})

describe('trackMapMarkerPropsEqual', () => {
  const dot: DriverDot = {
    number: 4,
    code: 'NOR',
    color: '#ff8000',
    position: 2,
    isRetired: false,
    isInPit: false,
    isFastestLap: false,
    x: 100.5,
    y: 60.25
  }
  const placement = {
    number: 4,
    text: 'NOR',
    x: 108,
    y: 55,
    textAnchor: 'start' as const,
    visible: true,
    box: { left: 0, top: 0, right: 10, bottom: 10 }
  }
  const onFocus = () => {}
  const props = (over: Record<string, unknown> = {}) => ({
    dot,
    focused: false,
    favorite: false,
    animate: true,
    durationMs: 900,
    onFocus,
    labelPlacement: placement,
    ...over
  })

  it('treats a rebuilt-but-identical dot and label placement as equal', () => {
    const next = props({
      dot: { ...dot },
      labelPlacement: { ...placement, box: { ...placement.box } }
    })
    expect(trackMapMarkerPropsEqual(props(), next as never)).toBe(true)
  })

  it.each([
    ['x', { dot: { ...dot, x: 101 } }],
    ['y', { dot: { ...dot, y: 61 } }],
    ['position', { dot: { ...dot, position: 3 } }],
    ['colour', { dot: { ...dot, color: '#000' } }],
    ['code', { dot: { ...dot, code: 'PIA' } }],
    ['retired', { dot: { ...dot, isRetired: true } }],
    ['in pit', { dot: { ...dot, isInPit: true } }],
    ['fastest lap', { dot: { ...dot, isFastestLap: true } }],
    ['extrapolated', { dot: { ...dot, extrapolated: true } }],
    ['focused', { focused: true }],
    ['favorite', { favorite: true }],
    ['animate', { animate: false }],
    ['duration', { durationMs: 620 }],
    ['handler', { onFocus: () => {} }],
    ['label text', { labelPlacement: { ...placement, text: 'N' } }],
    ['label x', { labelPlacement: { ...placement, x: 109 } }],
    ['label y', { labelPlacement: { ...placement, y: 56 } }],
    ['label anchor', { labelPlacement: { ...placement, textAnchor: 'end' as const } }],
    ['label visible', { labelPlacement: { ...placement, visible: false } }],
    ['label removed', { labelPlacement: undefined }]
  ])('re-renders when %s changes', (_name, over) => {
    expect(trackMapMarkerPropsEqual(props(), props(over) as never)).toBe(false)
  })
})
