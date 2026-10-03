import { createElement } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RaceDeckApi } from '@shared/ipc-contract'
import type { PracticeBriefRequest } from '@shared/practice'
import { usePracticeStore } from '@renderer/store/practiceStore'
import { useSessionStore } from '@renderer/store/sessionStore'
import { usePracticeBriefing } from '@renderer/lib/usePracticeBriefing'

const briefing = vi.fn()

const request: PracticeBriefRequest = {
  year: 2026,
  meetingName: 'Belgian Grand Prix',
  countryName: 'Belgium',
  dateStart: '2026-07-17T11:30:00Z',
  drivers: [{ number: 14, code: 'ALO', fullName: 'Fernando Alonso', teamName: 'Aston Martin' }]
}

/** A new snapshot object each call, as every provider publish produces. */
function snapshotFor(clock: number) {
  return {
    clock,
    session: {
      year: request.year,
      meetingName: request.meetingName,
      countryName: request.countryName,
      dateStart: request.dateStart
    },
    drivers: request.drivers.map((d) => ({ ...d }))
  } as never
}

describe('practice briefing does not retry on every publish', () => {
  beforeEach(() => {
    briefing.mockReset()
    ;(window as Window).racedeck = { practice: { briefing } } as unknown as RaceDeckApi
    usePracticeStore.getState().clear()
    useSessionStore.setState({ snapshot: null })
  })

  afterEach(() => {
    delete (window as Partial<Window>).racedeck
  })

  it('does not call the bridge again for the same request after a rejected load', async () => {
    briefing.mockRejectedValue(new Error('ipc down'))

    await usePracticeStore.getState().load(request)
    await usePracticeStore.getState().load(request)
    await usePracticeStore.getState().load(request)

    expect(briefing).toHaveBeenCalledTimes(1)
    expect(usePracticeStore.getState().error).toBe('ipc down')
  })

  it('retries after the user asks for a refresh (clear), and for a different request', async () => {
    briefing.mockRejectedValue(new Error('ipc down'))
    await usePracticeStore.getState().load(request)

    usePracticeStore.getState().clear()
    await usePracticeStore.getState().load(request)
    expect(briefing).toHaveBeenCalledTimes(2)

    await usePracticeStore.getState().load({ ...request, year: 2025 })
    expect(briefing).toHaveBeenCalledTimes(3)
  })

  it('the hook loads once while snapshots keep changing identity with the same weekend', async () => {
    briefing.mockRejectedValue(new Error('ipc down'))
    act(() => useSessionStore.setState({ snapshot: snapshotFor(1) }))
    renderHook(() => usePracticeBriefing(), { wrapper: ({ children }) => createElement('div', null, children) })
    await act(async () => undefined)

    for (let clock = 2; clock <= 12; clock++) {
      await act(async () => useSessionStore.setState({ snapshot: snapshotFor(clock) }))
    }

    expect(briefing).toHaveBeenCalledTimes(1)
  })

  it('the hook exposes a stable request object across same-content snapshots', async () => {
    briefing.mockResolvedValue({ ok: true, error: null, swaps: [], upgrades: [], upgradeDocumentUrl: null, fetchedAt: '' })
    act(() => useSessionStore.setState({ snapshot: snapshotFor(1) }))
    const { result } = renderHook(() => usePracticeBriefing())
    const first = result.current.request

    await act(async () => useSessionStore.setState({ snapshot: snapshotFor(2) }))

    expect(first).not.toBeNull()
    expect(result.current.request).toBe(first)
  })
})
