import { describe, expect, it } from 'vitest'
import { buildSystemStatus, type SystemStatusInputs } from '@renderer/core/engines/SystemStatus'

function inputs(overrides: Partial<SystemStatusInputs> = {}): SystemStatusInputs {
  return {
    sessionError: null,
    liveStatus: null,
    loggedIn: true,
    followStatus: 'off',
    followDetail: null,
    drmCapable: false,
    drmReady: false,
    enrichmentIssue: null,
    persistCorruptions: [],
    persistRecoveredBackup: null,
    reconnect: null,
    ...overrides
  }
}

describe('buildSystemStatus', () => {
  it('returns nothing when everything is healthy', () => {
    expect(buildSystemStatus(inputs())).toEqual([])
  })

  it('classifies a session load error as a retryable provider issue', () => {
    const entries = buildSystemStatus(inputs({ sessionError: 'Could not load session: boom' }))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      category: 'provider',
      severity: 'danger',
      recoveryActionId: 'retry-session'
    })
  })

  it('classifies a live-socket error as reconnectable', () => {
    const entries = buildSystemStatus(
      inputs({ liveStatus: { state: 'error', detail: 'boom', subscription: false } })
    )
    expect(
      entries.some((e) => e.category === 'live-socket' && e.recoveryActionId === 'reconnect')
    ).toBe(true)
  })

  it('shows a live reconnect countdown instead of a generic error', () => {
    const entries = buildSystemStatus(
      inputs({
        liveStatus: { state: 'error', detail: 'boom', subscription: false },
        reconnect: { attempt: 2, remainingMs: 7_600 }
      })
    )
    const liveSocketEntries = entries.filter((e) => e.category === 'live-socket')
    expect(liveSocketEntries).toHaveLength(1)
    expect(liveSocketEntries[0]).toMatchObject({
      severity: 'warning',
      message: 'F1 Live reconnecting in 8s… (attempt 2)',
      recoveryActionId: 'reconnect'
    })
  })

  it('classifies a rejected subscription as a sign-in issue with warning severity', () => {
    const entries = buildSystemStatus(
      inputs({
        liveStatus: { state: 'connected', detail: 'Subscription rejected', subscription: false }
      })
    )
    const auth = entries.find((e) => e.category === 'auth')
    expect(auth).toMatchObject({ severity: 'warning', recoveryActionId: 'sign-in' })
  })

  it('classifies an unauthenticated-but-connected state as an informational sign-in nudge', () => {
    const entries = buildSystemStatus(
      inputs({
        loggedIn: false,
        liveStatus: { state: 'connected', detail: null, subscription: false }
      })
    )
    const auth = entries.find((e) => e.category === 'auth')
    expect(auth).toMatchObject({ severity: 'info', recoveryActionId: 'sign-in' })
  })

  it('does not flag auth when already subscribed', () => {
    const entries = buildSystemStatus(
      inputs({
        loggedIn: true,
        liveStatus: { state: 'connected', detail: null, subscription: true }
      })
    )
    expect(entries.some((e) => e.category === 'auth')).toBe(false)
  })

  it('classifies a stuck follow state as a recalibratable sync issue', () => {
    const entries = buildSystemStatus(
      inputs({ followStatus: 'needs-calibration', followDetail: 'Drift exceeded threshold' })
    )
    expect(entries).toContainEqual(
      expect.objectContaining({ category: 'sync', recoveryActionId: 'recalibrate-sync' })
    )
  })

  it('does not flag sync when follow is simply off', () => {
    const entries = buildSystemStatus(inputs({ followStatus: 'off', followDetail: 'irrelevant' }))
    expect(entries.some((e) => e.category === 'sync')).toBe(false)
  })

  it('surfaces an enrichment issue as informational with no recovery action', () => {
    const entries = buildSystemStatus(inputs({ enrichmentIssue: 'carData: network error' }))
    const enrichment = entries.find((e) => e.category === 'telemetry-enrichment')
    expect(enrichment).toMatchObject({ severity: 'info', recoveryActionId: null })
  })

  it('surfaces corrupted persisted data as a resettable warning', () => {
    const entries = buildSystemStatus(
      inputs({ persistCorruptions: [{ namespace: 'layouts', key: 'saved' }] })
    )
    expect(entries).toContainEqual(
      expect.objectContaining({
        category: 'persistence',
        severity: 'warning',
        recoveryActionId: 'reset-corrupted-data'
      })
    )
  })

  it('does not flag persistence when nothing is corrupted', () => {
    const entries = buildSystemStatus(inputs({ persistCorruptions: [] }))
    expect(entries.some((e) => e.category === 'persistence')).toBe(false)
  })

  it('tells the user their whole settings file was reset and where the copy is', () => {
    const backup = 'C:\\Users\\me\\AppData\\Roaming\\RaceDeck\\racedeck.corrupt-1.json'
    const entries = buildSystemStatus(inputs({ persistRecoveredBackup: backup }))

    const entry = entries.find((e) => e.category === 'persistence')
    expect(entry).toMatchObject({ severity: 'warning', recoveryActionId: 'dismiss-persist-recovery' })
    expect(entry?.message).toContain(backup)
  })

  it('surfaces an unready DRM-capable build as informational', () => {
    const entries = buildSystemStatus(inputs({ drmCapable: true, drmReady: false }))
    expect(entries.some((e) => e.category === 'drm' && e.severity === 'info')).toBe(true)
  })

  it('does not flag DRM on a standard (non-capable) build', () => {
    const entries = buildSystemStatus(inputs({ drmCapable: false, drmReady: false }))
    expect(entries.some((e) => e.category === 'drm')).toBe(false)
  })

  it('collects multiple simultaneous issues', () => {
    const entries = buildSystemStatus(
      inputs({
        sessionError: 'boom',
        liveStatus: { state: 'error', detail: 'x', subscription: false },
        followStatus: 'waiting',
        followDetail: 'waiting on player',
        enrichmentIssue: 'position: timeout'
      })
    )
    expect(entries.map((e) => e.category).sort()).toEqual(
      ['live-socket', 'provider', 'sync', 'telemetry-enrichment'].sort()
    )
  })
})
