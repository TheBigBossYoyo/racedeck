import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSampledValue } from '../../src/renderer/lib/useSampledValue'
import { AnimationFrameBatch } from '../../src/renderer/lib/AnimationFrameBatch'
import { DemoProvider } from '../../src/renderer/core/providers/DemoProvider'
import { F1LiveProvider, renderScheduler } from '../../src/renderer/core/providers/F1LiveProvider'
import type { F1SessionData } from '../../src/shared/f1live'
import { DEFAULT_THEME } from '../../src/renderer/core/engines/ThemeEngine'
import { useSettingsStore } from '../../src/renderer/store/settingsStore'
import { persist } from '../../src/renderer/store/persist'
import { STORE_NS } from '../../src/shared/ipc-contract'

describe('useSampledValue', () => {
  afterEach(() => vi.useRealTimers())

  it('coalesces rapid source updates into the configured publication interval', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ value }) => useSampledValue(value, 1_000, 'session-a'),
      { initialProps: { value: 1 } }
    )

    rerender({ value: 2 })
    rerender({ value: 3 })
    expect(result.current).toBe(1)

    act(() => vi.advanceTimersByTime(1_000))
    expect(result.current).toBe(3)
  })

  it('publishes immediately when the source identity changes', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ value, sessionId }) => useSampledValue(value, 1_000, sessionId),
      { initialProps: { value: 1, sessionId: 'session-a' } }
    )

    rerender({ value: 2, sessionId: 'session-b' })
    expect(result.current).toBe(2)
  })
})

describe('AnimationFrameBatch', () => {
  it('uses one native frame for many simultaneous animations', () => {
    const queued: FrameRequestCallback[] = []
    const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      queued.push(callback)
      return queued.length
    })
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const stepped: number[] = []
    const batch = new AnimationFrameBatch<number, number>((value) => {
      stepped.push(value)
      return false
    })

    for (let driver = 1; driver <= 20; driver++) batch.schedule(driver, driver)
    expect(request).toHaveBeenCalledTimes(1)

    queued[0](100)
    expect(stepped).toHaveLength(20)
    expect(request).toHaveBeenCalledTimes(1)

    request.mockRestore()
    cancel.mockRestore()
  })
})

describe('snapshot allocation boundaries', () => {
  it('reuses immutable demo collections between lap completions', () => {
    const provider = new DemoProvider()
    const first = provider.getSnapshotAt(1_000)
    const nextTick = provider.getSnapshotAt(1_000.01)

    expect(nextTick.drivers).toBe(first.drivers)
    expect(nextTick.stints).toBe(first.stints)
    expect(nextTick.laps).toBe(first.laps)

    const afterLapCompletions = provider.getSnapshotAt(1_100)
    expect(afterLapCompletions.laps).not.toBe(first.laps)
  })

  it('invalidates official F1 stints when an in-place app-data patch arrives', async () => {
    const provider = new F1LiveProvider()
    const data: F1SessionData = {
      summary: {
        path: 'test/race/',
        key: 1,
        year: 2026,
        meetingName: 'Test Grand Prix',
        meetingOfficialName: null,
        name: 'Race',
        type: 'Race',
        number: 1,
        circuitShortName: 'Test',
        countryName: 'Test',
        countryCode: 'TST',
        location: 'Test',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-01T02:00:00Z',
        gmtOffset: '+00:00:00',
        archiveStatus: 'Complete'
      },
      sessionInfo: {},
      duration: 20,
      streams: {
        DriverList: [{ t: 0, d: { '4': { RacingNumber: '4', Tla: 'NOR', TeamName: 'McLaren' } } }],
        TimingData: [],
        TimingAppData: [
          { t: 0, d: { Lines: { '4': { Stints: { '0': { Compound: 'MEDIUM', StartLaps: 0, TotalLaps: 10 } } } } } },
          { t: 10, d: { Lines: { '4': { Stints: { '1': { Compound: 'HARD', StartLaps: 0, TotalLaps: 1 } } } } } }
        ]
      }
    }
    const internal = provider as unknown as { ingest: (session: F1SessionData) => Promise<unknown> }
    await internal.ingest(data)

    const before = provider.getSnapshotAt(5).stints
    const after = provider.getSnapshotAt(15).stints
    expect(after).not.toBe(before)
    expect(after).toHaveLength(2)
    expect(after[1].tyre.compound).toBe('HARD')
  })

  it('yields during large official timing preprocessing', async () => {
    const provider = new F1LiveProvider()
    const yields = vi.spyOn(renderScheduler, 'yieldToRenderer')
    const timing = Array.from({ length: 401 }, (_, index) => ({ t: index, d: {} }))
    const data: F1SessionData = {
      summary: {
        path: 'test/large/', key: 2, year: 2026, meetingName: 'Large Test', meetingOfficialName: null,
        name: 'Race', type: 'Race', number: 1, circuitShortName: 'Test', countryName: 'Test',
        countryCode: 'TST', location: 'Test', startDate: null, endDate: null, gmtOffset: '+00:00:00',
        archiveStatus: 'Complete'
      },
      sessionInfo: {},
      duration: 401,
      streams: { DriverList: [], TimingData: timing, TimingAppData: [] }
    }
    const internal = provider as unknown as { ingest: (session: F1SessionData) => Promise<unknown> }
    await internal.ingest(data)
    expect(yields.mock.calls.length).toBeGreaterThanOrEqual(4)
    yields.mockRestore()
  })

  it('hides partial position data and advertises only usable telemetry', async () => {
    const provider = new F1LiveProvider()
    const data: F1SessionData = {
      summary: {
        path: 'test/reliability/', key: 3, year: 2026, meetingName: 'Reliability Test', meetingOfficialName: null,
        name: 'Race', type: 'Race', number: 1, circuitShortName: 'Test', countryName: 'Test',
        countryCode: 'TST', location: 'Test', startDate: null, endDate: null, gmtOffset: '+00:00:00',
        archiveStatus: 'Complete'
      },
      sessionInfo: {}, duration: 20,
      streams: {
        DriverList: [{ t: 0, d: { '4': { RacingNumber: '4', Tla: 'NOR', TeamColour: 'ff8000' } } }],
        TimingData: [{ t: 0, d: { Lines: { '4': { Position: '1' } } } }],
        TimingAppData: []
      }
    }
    const internal = provider as unknown as {
      ingest: (session: F1SessionData) => Promise<unknown>
      appendPositionPoints: (position: F1SessionData['streams'][string], done: boolean, duration: number) => void
      appendCarDataPoints: (carData: F1SessionData['streams'][string], done: boolean, duration: number, version: number) => Promise<void>
      sessionLoadVersion: number
    }
    await internal.ingest(data)
    const usableCarData = [{
      t: 1,
      d: { Entries: { '0': { Cars: { '4': { Channels: { '2': 300, '4': 80 } } } } } }
    }]

    // A streamed prefix without one demonstrably closed lap must not surface a
    // partial map — coordinates stay hidden until the circuit outline exists.
    internal.appendPositionPoints(
      [{ t: 1, d: { Position: { '0': { Entries: { '4': { X: 100, Y: 200, Z: 0 } } } } } }],
      false,
      20
    )
    expect(provider.getSnapshotAt(1).availability.positions).toBe(false)

    // Feed completion always publishes whatever coordinates exist.
    internal.appendPositionPoints([], true, 20)
    expect(provider.getSnapshotAt(1).availability.positions).toBe(true)

    await internal.appendCarDataPoints([{ t: 1, d: { Entries: {} } }], false, 20, internal.sessionLoadVersion)
    expect(provider.getSnapshotAt(1).availability.telemetry).toBe(false)
    await internal.appendCarDataPoints(usableCarData, true, 20, internal.sessionLoadVersion)
    expect(provider.getSnapshotAt(1).availability.telemetry).toBe(true)
  })
})

describe('performance-mode runtime settings', () => {
  it('keeps reduced motion active across theme edits, import and hydration', async () => {
    persist.__resetMemory()
    useSettingsStore.setState({ theme: DEFAULT_THEME, performanceMode: true, hydrated: true })
    useSettingsStore.getState().setTheme({ density: 'compact' })
    expect(document.documentElement.dataset.reducedMotion).toBe('true')

    await useSettingsStore.getState().importAll({ theme: DEFAULT_THEME, performanceMode: true })
    expect(document.documentElement.dataset.reducedMotion).toBe('true')

    await persist.set(STORE_NS.SETTINGS, 'theme', DEFAULT_THEME)
    await persist.set(STORE_NS.SETTINGS, 'performanceMode', true)
    useSettingsStore.setState({ performanceMode: false, hydrated: false })
    await useSettingsStore.getState().hydrate()
    expect(document.documentElement.dataset.reducedMotion).toBe('true')
  })
})
