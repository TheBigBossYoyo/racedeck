import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlertEvent } from '@renderer/core/engines/AlertEngine'
import { dataManager, useSessionStore } from '@renderer/store/sessionStore'
import { useAlertStore } from '@renderer/store/alertStore'
import { useRaceStoryStore } from '@renderer/store/raceStoryStore'
import { useEngineerNotesStore } from '@renderer/store/engineerNotesStore'
import { useRadioNotifyStore, type RadioNotice } from '@renderer/store/radioNotifyStore'
import { useSyncStore } from '@renderer/store/syncStore'

const ALERT = { id: 'a1', message: 'old provider alert' } as unknown as AlertEvent
const NOTICE: RadioNotice = {
  url: 'https://example.test/clip.mp3',
  utc: '2026-01-01T00:00:00Z',
  driverNumber: 1,
  code: 'AAA',
  teamColour: null
}

function seedStaleData(): void {
  useAlertStore.setState({ alerts: [ALERT], unseen: 1 })
  useRaceStoryStore.setState({ events: [{ id: 'e1' }] as never })
  useEngineerNotesStore.setState({ notes: [{ id: 'n1' }] as never, lastHighId: 'n1' })
  useRadioNotifyStore.setState({ current: NOTICE, queue: [NOTICE] })
}

function expectNoStaleData(): void {
  expect(useAlertStore.getState().alerts).toEqual([])
  expect(useAlertStore.getState().unseen).toBe(0)
  expect(useRaceStoryStore.getState().events).toEqual([])
  expect(useEngineerNotesStore.getState().notes).toEqual([])
  expect(useRadioNotifyStore.getState().current).toBeNull()
  expect(useRadioNotifyStore.getState().queue).toEqual([])
}

describe('session-scoped stores on provider switch', () => {
  beforeEach(() => {
    dataManager.setActive('demo')
    useSessionStore.getState().pause()
    useSessionStore.setState({
      providerId: 'demo',
      sessions: [],
      currentSession: null,
      loadingSession: false,
      error: null,
      snapshot: null
    })
    seedStaleData()
    vi.spyOn(dataManager, 'listSessions').mockResolvedValue([])
  })

  afterEach(() => vi.restoreAllMocks())

  it('clears the old provider alerts, story, notes and radio notices when the provider changes', async () => {
    await useSessionStore.getState().setProvider('openf1')
    expect(useSessionStore.getState().providerId).toBe('openf1')
    expectNoStaleData()
  })

  it('leaves nothing stale when the session load after the switch fails', async () => {
    await useSessionStore.getState().setProvider('openf1')
    vi.spyOn(dataManager, 'loadSession').mockRejectedValue(new Error('boom'))

    await useSessionStore.getState().selectSession('missing')

    expect(useSessionStore.getState().error).toBe('Could not load session: boom')
    expect(useSessionStore.getState().currentSession).toBeNull()
    expectNoStaleData()
  })

  it('reports a thrown non-Error value instead of "undefined"', async () => {
    await useSessionStore.getState().setProvider('openf1')
    vi.spyOn(dataManager, 'loadSession').mockRejectedValue('plain string failure')

    await useSessionStore.getState().selectSession('missing')

    expect(useSessionStore.getState().error).toBe('Could not load session: plain string failure')
  })

  it('does not clear anything when the switch itself is rejected as an unknown provider', async () => {
    await useSessionStore.getState().setProvider('does-not-exist')
    expect(useSessionStore.getState().providerId).toBe('demo')
    expect(useAlertStore.getState().alerts).toEqual([ALERT])
    expect(useRaceStoryStore.getState().events).toHaveLength(1)
    expect(useEngineerNotesStore.getState().notes).toHaveLength(1)
    expect(useRadioNotifyStore.getState().current).toEqual(NOTICE)
  })

  it('drops the previous session sync scope on a provider switch', async () => {
    const original = useSyncStore.getState().setScope
    const setScope = vi.fn().mockResolvedValue(undefined)
    useSyncStore.setState({ setScope })
    try {
      await useSessionStore.getState().setProvider('openf1')
      expect(setScope).toHaveBeenCalledWith(null)
    } finally {
      useSyncStore.setState({ setScope: original })
    }
  })
})
