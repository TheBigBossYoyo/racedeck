import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionInfo } from '@shared/models'
import { dataManager, useSessionStore } from '@renderer/store/sessionStore'

const SESSION: SessionInfo = {
  id: 'session-a',
  meetingId: 'meeting-a',
  name: 'Race',
  type: 'race',
  meetingName: 'Test Grand Prix',
  circuitName: 'Test',
  circuitShortName: 'Test',
  countryName: 'Test',
  countryCode: 'TST',
  location: 'Test',
  dateStart: '2026-01-01T00:00:00Z',
  dateEnd: '2026-01-01T02:00:00Z',
  gmtOffset: '+00:00:00',
  year: 2026,
  totalLaps: 50,
  provider: 'demo'
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('atomic session loading', () => {
  beforeEach(() => {
    dataManager.setActive('demo')
    useSessionStore.getState().pause()
    useSessionStore.setState({
      providerId: 'demo',
      sessions: [SESSION],
      currentSession: null,
      loadingSession: false,
      sessionsLoading: false,
      error: null,
      snapshot: null,
      timeline: null,
      duration: 0,
      clock: 0
    })
    vi.spyOn(dataManager, 'getDuration').mockReturnValue(100)
    vi.spyOn(dataManager, 'getInitialClock').mockReturnValue(0)
    vi.spyOn(dataManager, 'getTimeline').mockReturnValue(null)
  })

  afterEach(() => vi.restoreAllMocks())

  it('ignores repeated session selections while one load is active', async () => {
    const pending = deferred<SessionInfo>()
    const load = vi.spyOn(dataManager, 'loadSession').mockReturnValue(pending.promise)

    const first = useSessionStore.getState().selectSession('session-a')
    const duplicate = useSessionStore.getState().selectSession('session-a')
    expect(load).toHaveBeenCalledTimes(1)

    pending.resolve(SESSION)
    await Promise.all([first, duplicate])
    expect(useSessionStore.getState().currentSession?.id).toBe('session-a')
    expect(useSessionStore.getState().loadingSession).toBe(false)
  })

  it('does not let an old load commit after the provider changes', async () => {
    const pending = deferred<SessionInfo>()
    vi.spyOn(dataManager, 'loadSession').mockReturnValue(pending.promise)
    vi.spyOn(dataManager, 'listSessions').mockResolvedValue([])

    const oldLoad = useSessionStore.getState().selectSession('session-a')
    await useSessionStore.getState().setProvider('openf1')
    pending.resolve(SESSION)
    await oldLoad

    expect(useSessionStore.getState().providerId).toBe('openf1')
    expect(useSessionStore.getState().currentSession).toBeNull()
    expect(useSessionStore.getState().loadingSession).toBe(false)
  })

  it('coalesces overlapping live reload requests', async () => {
    const pending = deferred<SessionInfo>()
    const load = vi.spyOn(dataManager, 'loadSession').mockReturnValue(pending.promise)
    useSessionStore.setState({ currentSession: SESSION })

    const first = useSessionStore.getState().reloadSession()
    const second = useSessionStore.getState().reloadSession()
    expect(load).toHaveBeenCalledTimes(1)

    pending.resolve(SESSION)
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
  })

  it('opens a replay at the provider first usable snapshot', async () => {
    vi.mocked(dataManager.getInitialClock).mockReturnValue(8)
    vi.spyOn(dataManager, 'loadSession').mockResolvedValue(SESSION)

    await useSessionStore.getState().selectSession('session-a')

    expect(useSessionStore.getState().clock).toBe(8)
  })
})
