import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TransportBar } from '../../src/renderer/components/shell/TransportBar'
import { useSessionStore } from '../../src/renderer/store/sessionStore'
import type { SessionTimeline } from '../../src/renderer/core/engines/SessionPhaseEngine'
import type { RaceBookmark } from '../../src/renderer/core/engines/RaceBookmarks'

// jsdom has no ResizeObserver; the Radix Slider TransportBar renders needs one.
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const TIMELINE: SessionTimeline = {
  segments: [{ kind: 'green', tStart: 0, tEnd: 3_600, lapStart: 1, lapEnd: 50 }],
  greenStart: 0,
  chequered: 3_600,
  totalLaps: 50,
  type: 'race',
  duration: 3_600
}

function bookmark(kind: RaceBookmark['kind'], t: number): RaceBookmark {
  return { kind, t, label: kind }
}

describe('TransportBar scrubber bookmarks', () => {
  beforeAll(() => {
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver
  })

  afterEach(() => {
    cleanup()
    useSessionStore.setState({ timeline: null, bookmarks: [], duration: 0, clock: 0 })
  })

  it('omits pit-stop and radio bookmarks from the scrubber to avoid a dense dot smear', () => {
    const bookmarks = [
      ...Array.from({ length: 20 }, (_, i) => bookmark('pit-stop', 100 + i * 50)),
      ...Array.from({ length: 30 }, (_, i) => bookmark('radio', 50 + i * 30)),
      bookmark('safety-car', 500),
      bookmark('lead-change', 1200)
    ]
    useSessionStore.setState({ timeline: TIMELINE, bookmarks, duration: 3_600, clock: 0 })

    const { container } = render(createElement(TransportBar))
    const markerButtons = container.querySelectorAll('button[title$="click to jump"]')

    expect(markerButtons.length).toBe(2) // only safety-car + lead-change survive
  })

  it('renders the rarer race-state bookmark kinds up to the 5-marker cap', () => {
    const bookmarks = [
      bookmark('safety-car', 500),
      bookmark('vsc', 600),
      bookmark('red-flag', 700),
      bookmark('lead-change', 800),
      bookmark('penalty', 900)
    ]
    useSessionStore.setState({ timeline: TIMELINE, bookmarks, duration: 3_600, clock: 0 })

    const { container } = render(createElement(TransportBar))
    const markerButtons = container.querySelectorAll('button[title$="click to jump"]')
    expect(markerButtons.length).toBe(5)
  })

  it('caps at 5 total and keeps the highest-priority kinds when over the limit', () => {
    const bookmarks = [
      bookmark('fastest-lap', 100),
      ...Array.from({ length: 6 }, (_, i) => bookmark('lead-change', 200 + i * 100)),
      bookmark('penalty', 900),
      bookmark('vsc', 950),
      bookmark('safety-car', 1000),
      bookmark('red-flag', 1050)
    ]
    useSessionStore.setState({ timeline: TIMELINE, bookmarks, duration: 3_600, clock: 0 })

    const { container } = render(createElement(TransportBar))
    const markerButtons = container.querySelectorAll('button[title$="click to jump"]')
    expect(markerButtons.length).toBe(5)

    const titles = Array.from(markerButtons).map((el) => el.getAttribute('title'))
    // red-flag, safety-car, vsc, penalty always outrank lead-change/fastest-lap.
    expect(titles.some((t) => t?.includes('red-flag'))).toBe(true)
    expect(titles.some((t) => t?.includes('safety-car'))).toBe(true)
    expect(titles.some((t) => t?.includes('vsc'))).toBe(true)
    expect(titles.some((t) => t?.includes('penalty'))).toBe(true)
    expect(titles.filter((t) => t?.includes('lead-change')).length).toBe(1)
    expect(titles.some((t) => t?.includes('fastest-lap'))).toBe(false)
  })
})
