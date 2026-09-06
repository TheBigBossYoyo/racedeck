import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TrackStatusBanner } from '@renderer/components/shell/TrackStatusBanner'
import { useSessionStore } from '@renderer/store/sessionStore'
import type { RaceControlMessage } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'

function raceControlMessage(message: string): RaceControlMessage {
  return {
    id: message,
    date: '2026-01-01T00:00:00Z',
    category: 'Other',
    message,
    flag: 'NONE',
    scope: null,
    sector: null,
    driverNumber: null,
    lapNumber: null,
    severity: 'info'
  }
}

function snapshot(over: {
  trackStatus: RaceSnapshot['trackStatus']
  trackMessage?: string | null
  raceControl?: RaceControlMessage[]
}): RaceSnapshot {
  return {
    trackStatus: over.trackStatus,
    trackMessage: over.trackMessage ?? null,
    raceControl: over.raceControl ?? []
  } as unknown as RaceSnapshot
}

describe('TrackStatusBanner', () => {
  afterEach(() => {
    cleanup()
    useSessionStore.setState({ snapshot: null })
  })

  it('does not render while the track is clear', () => {
    useSessionStore.setState({ snapshot: snapshot({ trackStatus: 'CLEAR' }) })
    render(createElement(TrackStatusBanner))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a red flag banner with the latest race control message as detail', () => {
    useSessionStore.setState({
      snapshot: snapshot({
        trackStatus: 'RED',
        raceControl: [
          raceControlMessage('RED FLAG'),
          raceControlMessage('RACE WILL RESUME AT 15:39')
        ]
      })
    })
    render(createElement(TrackStatusBanner))
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent(/red flag/i)
    expect(banner).toHaveTextContent('RACE WILL RESUME AT 15:39')
  })

  it('shows the faster trackMessage ticker over the formal race control message when both exist', () => {
    useSessionStore.setState({
      snapshot: snapshot({
        trackStatus: 'SAFETY_CAR',
        trackMessage: 'SC IN THIS LAP',
        raceControl: [raceControlMessage('SAFETY CAR DEPLOYED')]
      })
    })
    render(createElement(TrackStatusBanner))
    expect(screen.getByRole('status')).toHaveTextContent('SC IN THIS LAP')
  })

  it('can be dismissed, but re-surfaces once the status genuinely changes', async () => {
    useSessionStore.setState({ snapshot: snapshot({ trackStatus: 'VSC' }) })
    render(createElement(TrackStatusBanner))
    expect(screen.getByRole('status')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss track status banner' }))
    // framer-motion's AnimatePresence keeps the node mounted through its exit
    // transition, so absence isn't synchronous — wait for it to finish.
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    // Same status again — stays dismissed.
    act(() => {
      useSessionStore.setState({ snapshot: snapshot({ trackStatus: 'VSC' }) })
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    // Escalates to a full Safety Car — must re-surface even though VSC was dismissed.
    act(() => {
      useSessionStore.setState({ snapshot: snapshot({ trackStatus: 'SAFETY_CAR' }) })
    })
    expect(screen.getByRole('status')).toHaveTextContent(/safety car/i)
  })

  it('does not render for UNKNOWN status (an unrecognized feed code, not a known incident)', () => {
    useSessionStore.setState({ snapshot: snapshot({ trackStatus: 'UNKNOWN' }) })
    render(createElement(TrackStatusBanner))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
