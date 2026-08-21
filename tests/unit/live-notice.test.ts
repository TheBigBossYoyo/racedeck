import { describe, expect, it } from 'vitest'
import type { LiveStatus } from '@shared/f1live'
import { liveNoticeForTransition } from '@renderer/store/liveStore'

const connected: LiveStatus = {
  state: 'connected',
  detail: 'full live data',
  sessionName: 'Race',
  messages: 10,
  subscription: true,
  live: true,
  updatedAt: '2026-01-01T00:00:00Z'
}

describe('F1 live connection notices', () => {
  it('surfaces unexpected connection loss', () => {
    const notice = liveNoticeForTransition(connected, {
      ...connected,
      state: 'closed',
      detail: 'closed (1006)',
      live: false
    })
    expect(notice).toMatchObject({ tone: 'danger', title: 'F1 Live connection lost' })
  })

  it('distinguishes an expired F1 TV session from a generic network error', () => {
    const notice = liveNoticeForTransition(connected, {
      ...connected,
      state: 'connecting',
      detail: 'F1 TV subscription rejected — falling back to public timing…',
      subscription: false
    })
    expect(notice).toMatchObject({ tone: 'warning', title: 'F1 TV session expired' })
  })

  it('keeps an intentional disconnect neutral', () => {
    const notice = liveNoticeForTransition(connected, { ...connected, state: 'closed' }, true)
    expect(notice).toMatchObject({ tone: 'info', title: 'F1 Live disconnected' })
  })
})
