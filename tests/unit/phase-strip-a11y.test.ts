import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionTimeline } from '@renderer/core/engines/SessionPhaseEngine'
import type { RaceBookmark } from '@renderer/core/engines/RaceBookmarks'
import { useSessionStore } from '@renderer/store/sessionStore'
import { TransportBar } from '@renderer/components/shell/TransportBar'

const timeline: SessionTimeline = {
  segments: [
    { kind: 'pre', tStart: 0, tEnd: 100, lapStart: null, lapEnd: null },
    { kind: 'green', tStart: 100, tEnd: 600, lapStart: 1, lapEnd: 10 },
    { kind: 'sc', tStart: 600, tEnd: 700, lapStart: 11, lapEnd: 12 },
    { kind: 'green', tStart: 700, tEnd: 1000, lapStart: 13, lapEnd: 13 }
  ],
  greenStart: 100,
  chequered: 1000,
  totalLaps: 13,
  type: 'race',
  duration: 1000
}

const bookmarks: RaceBookmark[] = [
  { kind: 'safety-car', t: 600, label: 'Safety car deployed' },
  { kind: 'fastest-lap', t: 800, label: 'Fastest lap VER' }
]

const seek = vi.fn()

beforeEach(() => {
  // Radix's Slider measures its thumb with ResizeObserver, which jsdom lacks.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  seek.mockClear()
  useSessionStore.setState({ timeline, bookmarks, duration: 1000, clock: 0, seek })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const strip = () => screen.getByRole('group', { name: 'Race phases' })

describe('PhaseStrip keyboard operation', () => {
  it('exposes each phase segment as a focusable button named by its label, laps and time', () => {
    render(createElement(TransportBar))
    const segments = within(strip()).getAllByRole('button', { name: /^Jump to (?!.*(Safety car deployed|Fastest lap))/ })
    expect(segments).toHaveLength(4)
    expect(segments[0]).toHaveAccessibleName('Jump to Pre‑race at 0:00')
    expect(segments[1]).toHaveAccessibleName('Jump to Racing · laps 1–10 at 1:40')
    expect(segments[2]).toHaveAccessibleName('Jump to Safety Car · laps 11–12 at 10:00')
    expect(segments[3]).toHaveAccessibleName('Jump to Racing · lap 13 at 11:40')
    for (const seg of segments) expect(seg).toHaveAttribute('tabindex', '0')
  })

  it.each(['Enter', ' '])('seeks to the segment start on %j', (key) => {
    render(createElement(TransportBar))
    const sc = screen.getByRole('button', { name: /Jump to Safety Car/ })
    fireEvent.keyDown(sc, { key })
    expect(seek).toHaveBeenCalledTimes(1)
    expect(seek).toHaveBeenCalledWith(600)
  })

  it('leaves other keys alone', () => {
    render(createElement(TransportBar))
    fireEvent.keyDown(screen.getByRole('button', { name: /Jump to Safety Car/ }), { key: 'a' })
    fireEvent.keyDown(screen.getByRole('button', { name: /Jump to Safety Car/ }), { key: 'Tab' })
    expect(seek).not.toHaveBeenCalled()
  })

  it('does not double-seek: a keyboard activation is not also handled as a strip click', () => {
    render(createElement(TransportBar))
    const sc = screen.getByRole('button', { name: /Jump to Safety Car/ })
    fireEvent.keyDown(sc, { key: 'Enter' })
    expect(seek).toHaveBeenCalledTimes(1)
  })

  it('keeps click-to-seek by pointer position on the strip', () => {
    render(createElement(TransportBar))
    const el = strip()
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 8, right: 200, bottom: 8, x: 0, y: 0 }) as DOMRect
    fireEvent.click(el, { clientX: 50 })
    expect(seek).toHaveBeenCalledWith(250)
  })

  it('keeps the strip itself out of the tab order', () => {
    render(createElement(TransportBar))
    expect(strip()).not.toHaveAttribute('tabindex')
  })
})

describe('PhaseStrip bookmark dots', () => {
  it('have real accessible names, not only a title', () => {
    render(createElement(TransportBar))
    const dots = within(strip()).getAllByRole('button', { name: /Safety car deployed|Fastest lap VER/ })
    expect(dots).toHaveLength(2)
    expect(dots[0]).toHaveAttribute('aria-label', 'Jump to Safety car deployed at 10:00')
    expect(dots[1]).toHaveAttribute('aria-label', 'Jump to Fastest lap VER at 13:20')
  })

  it('seek to the bookmark without also triggering the strip click handler', () => {
    render(createElement(TransportBar))
    fireEvent.click(screen.getByRole('button', { name: 'Jump to Fastest lap VER at 13:20' }))
    expect(seek).toHaveBeenCalledTimes(1)
    expect(seek).toHaveBeenCalledWith(800)
  })
})

describe('TransportBar seek slider', () => {
  it('keeps its accessible name', () => {
    render(createElement(TransportBar))
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeInTheDocument()
  })
})
