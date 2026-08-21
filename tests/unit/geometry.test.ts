import { describe, it, expect } from 'vitest'
import { calculateBounds, normalizePoint, normalizePoints } from '../../src/renderer/core/engines/geometry'

describe('geometry', () => {
  describe('calculateBounds', () => {
    it('returns null for empty array', () => {
      expect(calculateBounds([])).toBeNull()
    })

    it('calculates correct bounds for multiple points', () => {
      const points = [
        { x: 0, y: 10 },
        { x: -5, y: 5 },
        { x: 15, y: -5 }
      ]
      expect(calculateBounds(points)).toEqual({
        minX: -5,
        maxX: 15,
        minY: -5,
        maxY: 10
      })
    })

    it('handles single point degenerate case by expanding bounds slightly', () => {
      const bounds = calculateBounds([{ x: 10, y: 10 }])
      expect(bounds).toEqual({
        minX: 9,
        maxX: 11,
        minY: 9,
        maxY: 11
      })
    })
  })

  describe('normalizePoint / normalizePoints', () => {
    it('maintains aspect ratio and fits within viewBox with padding', () => {
      const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 }
      const config = { viewBoxWidth: 200, viewBoxHeight: 300, padding: 10 }
      
      const p1 = { x: 0, y: 0 }
      const p2 = { x: 100, y: 100 }

      const n1 = normalizePoint(p1, bounds, config)
      const n2 = normalizePoint(p2, bounds, config)

      // Expected scale: 
      // targetWidth = 180, boundsWidth = 100 -> scaleX = 1.8
      // targetHeight = 280, boundsHeight = 100 -> scaleY = 2.8
      // scale = 1.8
      // width = 180, height = 180
      // xOffset = 10 + (180 - 180)/2 = 10
      // yOffset = 10 + (280 - 180)/2 = 60
      // SVG Y is inverted: y_svg = viewBoxHeight - y_norm
      // y_norm for p1(0,0) = (0 - 0)*1.8 + 60 = 60 => y_svg = 300 - 60 = 240
      // y_norm for p2(100,100) = (100 - 0)*1.8 + 60 = 240 => y_svg = 300 - 240 = 60

      expect(n1.x).toBeCloseTo(10)
      expect(n1.y).toBeCloseTo(240)

      expect(n2.x).toBeCloseTo(190)
      expect(n2.y).toBeCloseTo(60)
    })

    it('works with normalizePoints array helper', () => {
      const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 }
      const config = { viewBoxWidth: 200, viewBoxHeight: 300, padding: 10 }
      
      const points = [{ x: 0, y: 0 }, { x: 100, y: 100 }]
      const normalized = normalizePoints(points, bounds, config)
      
      expect(normalized.length).toBe(2)
      expect(normalized[0].x).toBeCloseTo(10)
      expect(normalized[0].y).toBeCloseTo(240)
    })
  })
})
