/**
 * Characterisation tests for the weak snapshot-derivation contracts listed in
 * SNAPSHOT_DERIVATION.md section 4.3 (items 1, 2, 5) and their OpenF1/Demo
 * counterparts. Each block states what was proven real and pins the fixed
 * behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { F1LiveDataDelta, F1SessionData, F1StreamPoint } from '@shared/f1live'
import { buildSyntheticSession, liveDeltaFor } from './fixtures/f1SyntheticSession'

const ipc = vi.hoisted(() => ({
  loadSession: vi.fn(),
  loadSessionEnrichment: vi.fn(),
  getLive: vi.fn()
}))

vi.mock('@renderer/lib/ipc', () => ({
  hasBridge: () => true,
  bridge: () => ({ f1: ipc })
}))
vi.mock('@renderer/store/persist', () => ({
  persist: {
    get: async () => null,
    set: async () => undefined,
    remove: async () => undefined,
    all: async () => ({}),
    __resetMemory: () => undefined
  }
}))

import { F1LiveProvider } from '@renderer/core/providers/F1LiveProvider'
import { OpenF1Provider } from '@renderer/core/providers/OpenF1Provider'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'

beforeEach(() => {
  ipc.getLive.mockReset()
})

// ── (a) stints identity while a CurrentTyres gap-fill applies ──────────────────

describe('F1 stints gap-filled from CurrentTyres', () => {
  const summary: F1SessionData['summary'] = {
    path: 'test/gapfill/',
    key: 3,
    year: 2026,
    meetingName: 'Gap Fill GP',
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
  }

  function gapFillSession(): F1SessionData {
    return {
      summary,
      sessionInfo: {},
      duration: 30,
      streams: {
        DriverList: [{ t: 0, d: { '4': { RacingNumber: '4', Tla: 'NOR', TeamName: 'McLaren' } } }],
        TimingData: [{ t: 0, d: { Lines: { '4': { Position: '1' } } } }],
        // The active stint carries no Compound: the reconstruction has no opinion.
        TimingAppData: [
          { t: 0, d: { Lines: { '4': { Stints: { '0': { StartLaps: 0, TotalLaps: 3 } } } } } }
        ],
        CurrentTyres: [
          { t: 0, d: { Tyres: { '4': { Compound: 'SOFT', New: 'true' } } } },
          { t: 20, d: { Tyres: { '4': { Compound: 'HARD', New: 'true' } } } }
        ]
      }
    }
  }

  async function load(): Promise<F1LiveProvider> {
    const provider = new F1LiveProvider()
    const internal = provider as unknown as { ingest: (s: F1SessionData) => Promise<unknown> }
    await internal.ingest(gapFillSession())
    return provider
  }

  it('fills the active stint compound from CurrentTyres', async () => {
    const provider = await load()
    expect(provider.getSnapshotAt(5).stints[0].tyre.compound).toBe('SOFT')
  })

  it('keeps the stints array identity between ticks while the gap-fill applies', async () => {
    const provider = await load()
    const first = provider.getSnapshotAt(5).stints
    expect(provider.getSnapshotAt(5.25).stints).toBe(first)
    expect(provider.getSnapshotAt(9).stints).toBe(first)
  })

  it('publishes a new array when CurrentTyres changes, without mutating the old one', async () => {
    const provider = await load()
    const before = provider.getSnapshotAt(5).stints
    const after = provider.getSnapshotAt(25).stints
    expect(after).not.toBe(before)
    expect(after[0].tyre.compound).toBe('HARD')
    expect(before[0].tyre.compound).toBe('SOFT')
    // Scrubbing back restores the earlier statement.
    expect(provider.getSnapshotAt(6).stints[0].tyre.compound).toBe('SOFT')
  })

  it('still returns the reconstructed array itself when no gap-fill applies', async () => {
    const data = gapFillSession()
    data.streams.TimingAppData = [
      {
        t: 0,
        d: { Lines: { '4': { Stints: { '0': { Compound: 'MEDIUM', StartLaps: 0, TotalLaps: 3 } } } } }
      }
    ]
    const provider = new F1LiveProvider()
    await (provider as unknown as { ingest: (s: F1SessionData) => Promise<unknown> }).ingest(data)
    const first = provider.getSnapshotAt(5).stints
    expect(provider.getSnapshotAt(6).stints).toBe(first)
    expect(first[0].tyre.compound).toBe('MEDIUM')
  })
})

// ── (b) laps cache key vs the pit-lap index ────────────────────────────────────

describe('F1 laps cache and the pit-lap index', () => {
  const session = buildSyntheticSession({ durationSec: 120, timingRate: 3, seed: 4 })

  async function poll(
    provider: F1LiveProvider,
    from: number,
    to: number,
    extra?: Record<string, F1StreamPoint[]>
  ): Promise<void> {
    const delta: F1LiveDataDelta = liveDeltaFor(session, from, to)
    if (extra) Object.assign(delta.streams, extra)
    ipc.getLive.mockResolvedValueOnce(delta)
    await provider.loadSession('live')
  }

  it('reflects a pit entry that lands for an already-completed lap before any new lap completes', async () => {
    const provider = new F1LiveProvider()
    await poll(provider, -1, 60)
    const before = provider.getSnapshotAt(60)
    const target = before.laps[before.laps.length - 1]
    expect(target).toBeDefined()
    expect(target.isPitInLap).toBe(false)

    // A poll that carries only the pit entry: no timing point, so no driver
    // completes a lap and the per-driver completed counts are unchanged.
    await poll(provider, 60, 60, {
      PitLaneTimeCollection: [
        {
          t: 61,
          d: { PitTimes: { [String(target.driverNumber)]: { Duration: '22.4', Lap: target.lapNumber } } }
        }
      ]
    })
    const after = provider.getSnapshotAt(60)
    const same = after.laps.find(
      (l) => l.driverNumber === target.driverNumber && l.lapNumber === target.lapNumber
    )
    expect(same?.isPitInLap).toBe(true)
    expect(after.laps).not.toBe(before.laps)
  })

  it('keeps the laps identity while neither completions nor pit entries change', async () => {
    const provider = new F1LiveProvider()
    await poll(provider, -1, 60)
    const first = provider.getSnapshotAt(60).laps
    expect(provider.getSnapshotAt(60).laps).toBe(first)
    await poll(provider, 60, 60)
    expect(provider.getSnapshotAt(60).laps).toBe(first)
  })
})

// ── (c) OpenF1 / Demo single lap cache ─────────────────────────────────────────

describe('OpenF1 lap cache', () => {
  const START = Date.parse('2024-03-02T15:00:00Z')
  const iso = (offsetSec: number): string => new Date(START + offsetSec * 1000).toISOString()

  function lap(
    driver: number,
    lapNumber: number,
    startSec: number | null,
    durationSec: number | null
  ): Record<string, unknown> {
    return {
      driver_number: driver,
      lap_number: lapNumber,
      lap_duration: durationSec,
      duration_sector_1: null,
      duration_sector_2: null,
      duration_sector_3: null,
      i1_speed: null,
      i2_speed: null,
      st_speed: null,
      is_pit_out_lap: false,
      date_start: startSec == null ? null : iso(startSec)
    }
  }

  const drivers = [1, 2].map((n) => ({
    driver_number: n,
    name_acronym: `D0${n}`,
    team_name: 'T',
    team_colour: 'ffffff'
  }))

  // Driver 1's opening lap has no date_start (OpenF1 leaves lap 1 undated in some
  // sessions), so the lap AFTER it is the first one it can complete.
  const laps = [
    lap(1, 1, null, null),
    lap(1, 2, 10, 20),
    lap(1, 3, 30, 20),
    lap(2, 1, 0, 8),
    lap(2, 2, 8, 200)
  ]

  const payloads: Record<string, unknown[]> = {
    sessions: [
      {
        session_key: 9001,
        meeting_key: 1,
        session_name: 'Race',
        session_type: 'Race',
        date_start: iso(0),
        date_end: iso(300)
      }
    ],
    drivers,
    stints: [],
    laps,
    intervals: [],
    weather: [],
    position: [],
    race_control: []
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const endpoint = /\/([a-z_]+)\?/.exec(url)?.[1] ?? ''
        return { ok: true, json: async () => payloads[endpoint] ?? [] }
      })
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  /** loadSession throttles its fetch waves with real delays; skip them. */
  async function loadOpenF1(): Promise<OpenF1Provider> {
    vi.useFakeTimers()
    const provider = new OpenF1Provider()
    const loading = provider.loadSession('9001')
    await vi.advanceTimersByTimeAsync(1_000)
    await loading
    return provider
  }

  const keys = (snapshot: { laps: { driverNumber: number; lapNumber: number }[] }): string[] =>
    snapshot.laps.map((l) => `${l.driverNumber}:${l.lapNumber}`).sort()

  it('serves every completed lap when a driver has an undated lap before them', async () => {
    const provider = await loadOpenF1()

    // Only driver 2's lap 1 has finished: driver 1's undated lap 1 never counts.
    expect(keys(provider.getSnapshotAt(9))).toEqual(['2:1'])
    // Driver 1 has since finished lap 2 (ends at 30 s); driver 2 has nothing new.
    expect(keys(provider.getSnapshotAt(31))).toEqual(['1:2', '2:1'])
    // ...and lap 3 (ends at 50 s).
    expect(keys(provider.getSnapshotAt(51))).toEqual(['1:2', '1:3', '2:1'])
  })

  it('answers the same for a backwards clock as for a fresh forward read', async () => {
    const provider = await loadOpenF1()
    const late = keys(provider.getSnapshotAt(51))
    expect(keys(provider.getSnapshotAt(9))).toEqual(['2:1'])
    expect(keys(provider.getSnapshotAt(51))).toEqual(late)
  })

  it('keeps the laps identity between reads with the same completions', async () => {
    const provider = await loadOpenF1()
    const first = provider.getSnapshotAt(31).laps
    expect(provider.getSnapshotAt(32).laps).toBe(first)
  })
})

describe('Demo lap cache', () => {
  const key = (laps: { driverNumber: number; lapNumber: number }[]): string =>
    laps
      .map((l) => `${l.driverNumber}:${l.lapNumber}`)
      .sort()
      .join(',')

  it('answers a backwards clock exactly as a fresh provider does', () => {
    const provider = new DemoProvider()
    const t = 1_000
    const forward = key(new DemoProvider().getSnapshotAt(t).laps)
    provider.getSnapshotAt(3_000)
    expect(key(provider.getSnapshotAt(t).laps)).toBe(forward)
  })

  it('never serves one driver the laps of another as positions swap', () => {
    const provider = new DemoProvider()
    const duration = provider.getDuration()
    for (let t = 0; t <= duration; t += duration / 40) {
      const laps = provider.getSnapshotAt(t).laps
      const fresh = new DemoProvider().getSnapshotAt(t).laps
      expect(key(laps)).toBe(key(fresh))
    }
  })
})
