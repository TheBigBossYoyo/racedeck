export const TRACK_MAP_VIEWBOX = {
  width: 300,
  height: 200
} as const

export interface TrackMapLabelLayoutInput {
  readonly number: number
  readonly code: string
  readonly x: number
  readonly y: number
  readonly position: number | null
  readonly focused: boolean
  readonly favorite: boolean
  readonly isFastestLap: boolean
}

export interface TrackMapLabelBox {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface TrackMapLabelPlacement {
  readonly number: number
  readonly text: string
  readonly x: number
  readonly y: number
  readonly textAnchor: 'middle' | 'start' | 'end'
  readonly visible: boolean
  readonly box: TrackMapLabelBox
}

const EDGE_PADDING = 2
const LABEL_HEIGHT = 12

export const CANDIDATE_RINGS = [0, 10] as const
export const CANDIDATE_DIRECTIONS = [
  { rank: 0, x: 0, y: -1, anchor: 'middle' },
  { rank: 1, x: 1, y: -1, anchor: 'start' },
  { rank: 2, x: -1, y: -1, anchor: 'end' },
  { rank: 3, x: 1, y: 0, anchor: 'start' },
  { rank: 4, x: -1, y: 0, anchor: 'end' },
  { rank: 5, x: 1, y: 1, anchor: 'start' },
  { rank: 6, x: -1, y: 1, anchor: 'end' },
  { rank: 7, x: 0, y: 1, anchor: 'middle' }
] as const satisfies readonly CandidateDirection[]

export function measureTrackMapLabelWidth(text: string): number {
  let width = 6
  for (const character of text) {
    width += measureCharacterWidth(character)
  }
  return width
}

export function createMarkerBox(label: TrackMapLabelLayoutInput): TrackMapMarkerBox {
  const markerRadius = label.focused ? 10 : 8.5
  return {
    ownerNumber: label.number,
    box: {
      left: label.x - markerRadius,
      top: label.y - markerRadius,
      right: label.x + markerRadius,
      bottom: label.y + markerRadius
    }
  }
}

export function buildPlacementCandidate({
  label,
  text,
  textWidth,
  markerGap,
  direction
}: TrackMapPlacementCandidateInput): TrackMapPlacementCandidate {
  const unclampedX = label.x + direction.x * markerGap
  const unclampedY = label.y + direction.y * markerGap
  const unclampedBox = createBox({
    x: unclampedX,
    y: unclampedY,
    width: textWidth,
    textAnchor: direction.anchor
  })
  const xShift = clampAxis(unclampedBox.left, unclampedBox.right, TRACK_MAP_VIEWBOX.width)
  const yShift = clampAxis(unclampedBox.top, unclampedBox.bottom, TRACK_MAP_VIEWBOX.height)

  return {
    number: label.number,
    text,
    x: unclampedX + xShift,
    y: unclampedY + yShift,
    textAnchor: direction.anchor,
    visible: true,
    box: shiftBox(unclampedBox, xShift, yShift),
    rank: direction.rank + Math.abs(direction.x) * 0.1 + Math.abs(direction.y) * 0.01,
    penalty: 0,
    labelOverlapArea: 0,
    markerOverlapArea: 0
  }
}

export function createBox({ x, y, width, textAnchor }: TrackMapLabelBoxInput): TrackMapLabelBox {
  const halfHeight = LABEL_HEIGHT / 2
  if (textAnchor === 'start') {
    return { left: x, top: y - halfHeight, right: x + width, bottom: y + halfHeight }
  }
  if (textAnchor === 'end') {
    return { left: x - width, top: y - halfHeight, right: x, bottom: y + halfHeight }
  }
  return { left: x - width / 2, top: y - halfHeight, right: x + width / 2, bottom: y + halfHeight }
}

export function calculateOverlapArea(left: TrackMapLabelBox, right: TrackMapLabelBox): number {
  const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left)
  const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top)
  if (overlapWidth <= 0 || overlapHeight <= 0) {
    return 0
  }
  return overlapWidth * overlapHeight
}

function measureCharacterWidth(character: string): number {
  if (character === ' ') return 2.4
  if (character === '·') return 3.2
  if (character === 'I') return 3.4
  return 5.2
}

function shiftBox(box: TrackMapLabelBox, xShift: number, yShift: number): TrackMapLabelBox {
  return {
    left: box.left + xShift,
    top: box.top + yShift,
    right: box.right + xShift,
    bottom: box.bottom + yShift
  }
}

function clampAxis(start: number, end: number, extent: number): number {
  if (start < EDGE_PADDING) {
    return EDGE_PADDING - start
  }
  if (end > extent - EDGE_PADDING) {
    return extent - EDGE_PADDING - end
  }
  return 0
}

interface CandidateDirection {
  readonly rank: number
  readonly x: -1 | 0 | 1
  readonly y: -1 | 0 | 1
  readonly anchor: TrackMapLabelPlacement['textAnchor']
}

interface TrackMapLabelBoxInput {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly textAnchor: TrackMapLabelPlacement['textAnchor']
}

export interface TrackMapMarkerBox {
  readonly ownerNumber: number
  readonly box: TrackMapLabelBox
}

interface TrackMapPlacementCandidateInput {
  readonly label: TrackMapLabelLayoutInput
  readonly text: string
  readonly textWidth: number
  readonly markerGap: number
  readonly direction: CandidateDirection
}

export interface TrackMapPlacementCandidate extends TrackMapLabelPlacement {
  readonly rank: number
  readonly penalty: number
  readonly labelOverlapArea: number
  readonly markerOverlapArea: number
}
