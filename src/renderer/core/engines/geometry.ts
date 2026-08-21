export interface Point {
  x: number
  y: number
}

export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * Calculates the bounding box of a collection of points.
 * Returns null if the array is empty.
 */
export function calculateBounds(points: Point[]): Bounds | null {
  if (!points || points.length === 0) return null

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }

  // Degenerate case: single point or all identical points
  if (minX === maxX) {
    minX -= 1
    maxX += 1
  }
  if (minY === maxY) {
    minY -= 1
    maxY += 1
  }

  return { minX, maxX, minY, maxY }
}

export interface NormalizationConfig {
  viewBoxWidth: number
  viewBoxHeight: number
  padding: number
}

/**
 * Normalizes a point into the target viewBox, maintaining aspect ratio.
 * Flips the Y axis so that higher Y goes UP in standard Cartesian, 
 * down in SVG (or vice versa, typically track maps come with Y=North).
 */
export function normalizePoint(
  p: Point,
  bounds: Bounds,
  config: NormalizationConfig
): Point {
  const { viewBoxWidth, viewBoxHeight, padding } = config
  const boundsWidth = bounds.maxX - bounds.minX
  const boundsHeight = bounds.maxY - bounds.minY

  const targetWidth = viewBoxWidth - padding * 2
  const targetHeight = viewBoxHeight - padding * 2

  const scaleX = targetWidth / boundsWidth
  const scaleY = targetHeight / boundsHeight
  const scale = Math.min(scaleX, scaleY)

  // Center the track in the target view
  const xOffset = padding + (targetWidth - boundsWidth * scale) / 2
  const yOffset = padding + (targetHeight - boundsHeight * scale) / 2

  return {
    x: (p.x - bounds.minX) * scale + xOffset,
    // Typically telemetry coordinates are right-handed (Y up), SVG is Y down
    y: viewBoxHeight - ((p.y - bounds.minY) * scale + yOffset)
  }
}

/**
 * Convenience to normalize an array of points.
 */
export function normalizePoints(
  points: Point[],
  bounds: Bounds,
  config: NormalizationConfig
): Point[] {
  return points.map((p) => normalizePoint(p, bounds, config))
}
