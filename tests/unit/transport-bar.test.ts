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

  it('still renders the rarer race-state bookmark kinds', () => {
    const bookmarks = [
      bookmark('safety-car', 500),
      bookmark('vsc', 600),
      bookmark('red-flag', 700),
      bookmark('lead-change', 800),
      bookmark('penalty', 900),
      bookmark('fastest-lap', 1000)
    ]
    useSessionStore.setState({ timeline: TIMELINE, bookmarks, duration: 3_600, clock: 0 })

    const { container } = render(createElement(TransportBar))
    const markerButtons = container.querySelectorAll('button[title$="click to jump"]')
    expect(markerButtons.length).toBe(bookmarks.length)
  })
})
