import { describe, expect, it } from 'vitest'
import {
  TRACK_MAP_VIEWBOX,
  placeTrackMapLabels,
  type TrackMapLabelBox,
  type TrackMapLabelLayoutInput,
  type TrackMapLabelPlacement
} from '../../src/renderer/widgets/trackMap/labelLayout'

const QUALIFYING_CLUSTER_FIXTURE: readonly TrackMapLabelLayoutInput[] = [
  { number: 44, code: 'HAM', x: 115, y: 32, position: 1, focused: true, favorite: false, isFastestLap: false },
  { number: 22, code: 'TSU', x: 108, y: 45, position: 2, focused: false, favorite: true, isFastestLap: false },
  { number: 12, code: 'ANT', x: 103, y: 58, position: 3, focused: false, favorite: false, isFastestLap: false },
  { number: 14, code: 'ALO', x: 97, y: 72, position: 4, focused: false, favorite: false, isFastestLap: false },
  { number: 31, code: 'OCO', x: 88, y: 91, position: 5, focused: false, favorite: false, isFastestLap: false },
  { number: 63, code: 'RUS', x: 102, y: 94, position: 6, focused: false, favorite: false, isFastestLap: false },
  { number: 77, code: 'BOT', x: 118, y: 95, position: 7, focused: false, favorite: false, isFastestLap: false },
  { number: 81, code: 'PIA', x: 157, y: 104, position: 8, focused: false, favorite: false, isFastestLap: true },
  { number: 43, code: 'COL', x: 181, y: 96, position: 9, focused: false, favorite: false, isFastestLap: false },
  { number: 18, code: 'STR', x: 196, y: 129, position: 10, focused: false, favorite: false, isFastestLap: false },
  { number: 10, code: 'GAS', x: 219, y: 132, position: 11, focused: false, favorite: false, isFastestLap: false },
  { number: 87, code: 'BEA', x: 70, y: 150, position: 12, focused: false, favorite: false, isFastestLap: false },
  { number: 27, code: 'HUL', x: 110, y: 176, position: 13, focused: false, favorite: false, isFastestLap: false }
] as const

describe('placeTrackMapLabels', () => {
  it('returns deterministic placements when the same dense fixture arrives in a different order', () => {
    const forward = normalizePlacements(placeTrackMapLabels(QUALIFYING_CLUSTER_FIXTURE))
    const reversed = normalizePlacements(placeTrackMapLabels([...QUALIFYING_CLUSTER_FIXTURE].reverse()))

    expect(forward).toEqual(reversed)
  })

  it('keeps visible labels inside the 300x200 viewBox and avoids overlap on the dense qualifying fixture', () => {
    const placements = placeTrackMapLabels(QUALIFYING_CLUSTER_FIXTURE)
    const visible = placements.filter((placement) => placement.visible)

    expect(visible.length).toBeGreaterThanOrEqual(7)
    expect(visible.find((placement) => placement.number === 44)?.visible).toBe(true)
    expect(visible.find((placement) => placement.number === 22)?.visible).toBe(true)
    expect(visible.find((placement) => placement.number === 81)?.visible).toBe(true)

    for (const placement of visible) {
      expect(placement.box.left).toBeGreaterThanOrEqual(0)
      expect(placement.box.top).toBeGreaterThanOrEqual(0)
      expect(placement.box.right).toBeLessThanOrEqual(TRACK_MAP_VIEWBOX.width)
      expect(placement.box.bottom).toBeLessThanOrEqual(TRACK_MAP_VIEWBOX.height)
    }

    for (let index = 0; index < visible.length; index += 1) {
      const current = visible[index]
      for (let otherIndex = index + 1; otherIndex < visible.length; otherIndex += 1) {
        expect(boxesOverlap(current.box, visible[otherIndex].box)).toBe(false)
      }
    }
  })

  it('does not mutate marker coordinates when label placements are displaced', () => {
    const inputs = QUALIFYING_CLUSTER_FIXTURE.map((label) => ({ ...label }))
    const before = inputs.map((label) => ({ ...label }))

    placeTrackMapLabels(inputs)

    expect(inputs).toEqual(before)
  })
})

function normalizePlacements(
  placements: readonly TrackMapLabelPlacement[]
): readonly TrackMapLabelPlacement[] {
  return [...placements].sort((left, right) => left.number - right.number)
}

function boxesOverlap(left: TrackMapLabelBox, right: TrackMapLabelBox): boolean {
  return !(
    left.right <= right.left ||
    right.right <= left.left ||
    left.bottom <= right.top ||
    right.bottom <= left.top
  )
}
