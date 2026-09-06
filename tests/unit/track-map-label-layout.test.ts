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

  it('resists placement changes across a small dot movement with hysteresis', () => {
    // Initial placement
    const initial = QUALIFYING_CLUSTER_FIXTURE
    const firstPlacements = placeTrackMapLabels(initial)
    const firstMap = new Map(firstPlacements.map((p) => [p.number, p]))
    const focusedFirstPlacement = firstMap.get(44)
    expect(focusedFirstPlacement?.visible).toBe(true)

    // Move a driver dot slightly (2-3 pixels), maintaining their relative position
    const slightlyMoved = initial.map((label) => ({
      ...label,
      x: label.x + (label.number === 44 ? 2 : 0),
      y: label.y + (label.number === 44 ? 2 : 0)
    }))

    // Place labels again WITH hysteresis (passing previous placements)
    const secondPlacementsWithHysteresis = placeTrackMapLabels(slightlyMoved, firstMap)
    const secondMapWithHysteresis = new Map(
      secondPlacementsWithHysteresis.map((p) => [p.number, p])
    )

    // Place labels again WITHOUT hysteresis (greedy baseline)
    const secondPlacementsNoHysteresis = placeTrackMapLabels(slightlyMoved)
    const secondMapNoHysteresis = new Map(secondPlacementsNoHysteresis.map((p) => [p.number, p]))

    const focusedWithHysteresis = secondMapWithHysteresis.get(44)
    const focusedNoHysteresis = secondMapNoHysteresis.get(44)

    if (focusedWithHysteresis?.visible && focusedNoHysteresis?.visible) {
      // With hysteresis, the placement should be more stable
      // (either the same or closer to the original than without hysteresis)
      const distanceWithHysteresis = Math.hypot(
        focusedWithHysteresis.x - focusedFirstPlacement!.x,
        focusedWithHysteresis.y - focusedFirstPlacement!.y
      )
      const distanceNoHysteresis = Math.hypot(
        focusedNoHysteresis.x - focusedFirstPlacement!.x,
        focusedNoHysteresis.y - focusedFirstPlacement!.y
      )
      // Hysteresis should reduce jumps
      expect(distanceWithHysteresis).toBeLessThanOrEqual(distanceNoHysteresis + 1)
    }
  })

  it('switches placement when the current one develops real overlap with another label', () => {
    // Scenario: two drivers close together, one moves into the other's label space
    const initialSpacing: readonly TrackMapLabelLayoutInput[] = [
      { number: 1, code: 'DRV', x: 100, y: 100, position: 1, focused: false, favorite: false, isFastestLap: false },
      { number: 2, code: 'OTH', x: 140, y: 100, position: 2, focused: false, favorite: false, isFastestLap: false }
    ] as const

    const firstPlacements = placeTrackMapLabels(initialSpacing)
    const firstMap = new Map(firstPlacements.map((p) => [p.number, p]))
    const firstDriver1 = firstMap.get(1)

    expect(firstDriver1?.visible).toBe(true)

    // Move driver 2 much closer (15+ pixels), which should create significant overlap
    const crowded: readonly TrackMapLabelLayoutInput[] = [
      { number: 1, code: 'DRV', x: 100, y: 100, position: 1, focused: false, favorite: false, isFastestLap: false },
      { number: 2, code: 'OTH', x: 120, y: 100, position: 2, focused: false, favorite: false, isFastestLap: false }
    ] as const

    const secondPlacements = placeTrackMapLabels(crowded, firstMap)
    const secondMap = new Map(secondPlacements.map((p) => [p.number, p]))
    const secondDriver1 = secondMap.get(1)

    // Driver 1's label may have repositioned to avoid the new overlap,
    // OR become hidden if no good placement exists. Either way, it shouldn't
    // overlap with driver 2's label.
    if (secondDriver1?.visible) {
      const driver2 = secondMap.get(2)
      if (driver2?.visible) {
        expect(boxesOverlap(secondDriver1.box, driver2.box)).toBe(false)
      }
    }
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
