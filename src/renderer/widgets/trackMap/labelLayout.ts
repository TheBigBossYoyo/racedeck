import {
  CANDIDATE_DIRECTIONS,
  CANDIDATE_RINGS,
  TRACK_MAP_VIEWBOX,
  buildPlacementCandidate,
  calculateOverlapArea,
  createBox,
  createMarkerBox,
  measureTrackMapLabelWidth,
  type TrackMapLabelBox,
  type TrackMapLabelLayoutInput,
  type TrackMapLabelPlacement,
  type TrackMapMarkerBox,
  type TrackMapPlacementCandidate
} from './labelLayoutPlacement'

export {
  TRACK_MAP_VIEWBOX,
  type TrackMapLabelBox,
  type TrackMapLabelLayoutInput,
  type TrackMapLabelPlacement
}

export function placeTrackMapLabels(
  labels: readonly TrackMapLabelLayoutInput[],
  previousPlacements?: ReadonlyMap<number, TrackMapLabelPlacement>
): readonly TrackMapLabelPlacement[] {
  const sortedLabels = [...labels].sort(compareTrackMapLabels)
  const markerBoxes = labels.map((label) => createMarkerBox(label))
  const placementsByDriver = new Map<number, TrackMapLabelPlacement>()
  const visiblePlacements: TrackMapLabelPlacement[] = []

  for (const label of sortedLabels) {
    const placement = chooseTrackMapPlacement(
      label,
      visiblePlacements,
      markerBoxes,
      previousPlacements?.get(label.number)
    )
    placementsByDriver.set(label.number, placement)
    if (placement.visible) {
      visiblePlacements.push(placement)
    }
  }

  return labels.map(
    (label) =>
      placementsByDriver.get(label.number) ?? {
        number: label.number,
        text: toTrackMapLabelText(label),
        x: label.x,
        y: label.y,
        textAnchor: 'middle',
        visible: false,
        box: createBox({ x: label.x, y: label.y, width: 0, textAnchor: 'middle' })
      }
  )
}

function chooseTrackMapPlacement(
  label: TrackMapLabelLayoutInput,
  visiblePlacements: readonly TrackMapLabelPlacement[],
  markerBoxes: readonly TrackMapMarkerBox[],
  previousPlacement?: TrackMapLabelPlacement
): TrackMapLabelPlacement {
  const text = toTrackMapLabelText(label)
  const textWidth = measureTrackMapLabelWidth(text)
  const markerRadius = label.focused ? 7 : 5.5
  let bestCandidate: TrackMapPlacementCandidate | null = null
  let previousPenalty: number | null = null

  for (const ringOffset of CANDIDATE_RINGS) {
    const markerGap = markerRadius + 8 + ringOffset
    for (const direction of CANDIDATE_DIRECTIONS) {
      const candidate = buildPlacementCandidate({
        label,
        text,
        textWidth,
        markerGap,
        direction
      })
      const labelOverlapArea = visiblePlacements.reduce(
        (total, placement) => total + calculateOverlapArea(candidate.box, placement.box),
        0
      )
      const markerOverlapArea = markerBoxes.reduce((total, markerBox) => {
        if (markerBox.ownerNumber === label.number) {
          return total
        }
        return total + calculateOverlapArea(candidate.box, markerBox.box)
      }, 0)
      const penalty = labelOverlapArea * 1_000 + markerOverlapArea * 100 + candidate.rank

      if (
        bestCandidate == null ||
        penalty < bestCandidate.penalty ||
        (penalty === bestCandidate.penalty && candidate.rank < bestCandidate.rank)
      ) {
        bestCandidate = { ...candidate, penalty, labelOverlapArea, markerOverlapArea }
      }

      if (labelOverlapArea === 0 && markerOverlapArea === 0) {
        return candidate
      }
    }
  }

  // Hysteresis: if we have a previous placement, check if it's still reasonable.
  // Only switch if the new best candidate is meaningfully better (at least 25% lower penalty).
  if (previousPlacement && previousPlacement.visible && bestCandidate) {
    const previousCandidateAtNewPosition = reevaluatePlacementAtNewPosition(
      previousPlacement,
      label,
      visiblePlacements,
      markerBoxes
    )
    previousPenalty = previousCandidateAtNewPosition
    const hysteresisThreshold = previousPenalty * 0.75 // Require 25% improvement
    if (previousPenalty < hysteresisThreshold && previousPenalty < Infinity) {
      // Previous placement is still good enough; stick with it to avoid jumps
      return previousPlacement
    }
  }

  if (bestCandidate == null) {
    return {
      number: label.number,
      text,
      x: label.x,
      y: label.y,
      textAnchor: 'middle',
      visible: false,
      box: createBox({ x: label.x, y: label.y, width: textWidth, textAnchor: 'middle' })
    }
  }

  if (label.focused || label.favorite || label.isFastestLap) {
    return bestCandidate
  }

  return {
    ...bestCandidate,
    visible: false
  }
}

function compareTrackMapLabels(
  left: TrackMapLabelLayoutInput,
  right: TrackMapLabelLayoutInput
): number {
  const priorityDelta = getTrackMapLabelPriority(right) - getTrackMapLabelPriority(left)
  if (priorityDelta !== 0) {
    return priorityDelta
  }

  const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER
  const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER
  if (leftPosition !== rightPosition) {
    return leftPosition - rightPosition
  }

  return left.number - right.number
}

function getTrackMapLabelPriority(label: TrackMapLabelLayoutInput): number {
  let priority = 0
  if (label.focused) priority += 8
  if (label.favorite) priority += 4
  if (label.isFastestLap) priority += 2
  return priority
}

function toTrackMapLabelText(label: TrackMapLabelLayoutInput): string {
  return label.isFastestLap ? `${label.code} · FL` : label.code
}

function reevaluatePlacementAtNewPosition(
  previousPlacement: TrackMapLabelPlacement,
  currentLabel: TrackMapLabelLayoutInput,
  visiblePlacements: readonly TrackMapLabelPlacement[],
  markerBoxes: readonly TrackMapMarkerBox[]
): number {
  // Recalculate the penalty for the previous placement at the dot's new position.
  // This helps us decide whether the old placement is still valid for the new dot location.
  const textWidth = measureTrackMapLabelWidth(previousPlacement.text)

  // Build a box for the previous placement at the new dot position
  // The offset from dot to label should remain the same
  const labelDx = previousPlacement.x - currentLabel.x
  const labelDy = previousPlacement.y - currentLabel.y
  const newPlacementX = currentLabel.x + labelDx
  const newPlacementY = currentLabel.y + labelDy

  const newBox = createBox({
    x: newPlacementX,
    y: newPlacementY,
    width: textWidth,
    textAnchor: previousPlacement.textAnchor
  })

  // Check bounds
  if (
    newBox.left < 0 ||
    newBox.top < 0 ||
    newBox.right > TRACK_MAP_VIEWBOX.width ||
    newBox.bottom > TRACK_MAP_VIEWBOX.height
  ) {
    return Infinity
  }

  // Calculate overlap penalties
  const labelOverlapArea = visiblePlacements.reduce(
    (total, placement) => total + calculateOverlapArea(newBox, placement.box),
    0
  )
  const markerOverlapArea = markerBoxes.reduce((total, markerBox) => {
    if (markerBox.ownerNumber === currentLabel.number) {
      return total
    }
    return total + calculateOverlapArea(newBox, markerBox.box)
  }, 0)

  // Use a small rank penalty for continuing with existing placement
  const rank = 0.5
  return labelOverlapArea * 1_000 + markerOverlapArea * 100 + rank
}
