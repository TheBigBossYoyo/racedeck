import {
  normalizePoints,
  type Bounds,
  type NormalizationConfig,
  type Point
} from '@renderer/core/engines/geometry'

function sameBounds(a: Bounds, b: Bounds): boolean {
  return a.minX === b.minX && a.maxX === b.maxX && a.minY === b.minY && a.maxY === b.maxY
}

/**
 * Builds the SVG `points` string for the circuit outline, remembering the last
 * result. The traced outline (up to ~700 points) only changes when the trace
 * array or the shared frame box does, yet the map recomputes on every snapshot;
 * bounds are compared by value because the union step hands back a fresh object
 * each tick even when the frame has not moved.
 */
export function createOutlinePathMemo(): (
  trace: readonly Point[],
  bounds: Bounds,
  config: NormalizationConfig
) => string {
  let last: { trace: readonly Point[]; bounds: Bounds; config: NormalizationConfig; path: string } | null = null
  return (trace, bounds, config) => {
    if (
      last != null &&
      last.trace === trace &&
      sameBounds(last.bounds, bounds) &&
      last.config.viewBoxWidth === config.viewBoxWidth &&
      last.config.viewBoxHeight === config.viewBoxHeight &&
      last.config.padding === config.padding
    ) {
      return last.path
    }
    const path = normalizePoints([...trace], bounds, config)
      .map((point) => `${point.x},${point.y}`)
      .join(' ')
    last = { trace, bounds, config, path }
    return path
  }
}
