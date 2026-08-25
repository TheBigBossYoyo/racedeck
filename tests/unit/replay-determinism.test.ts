import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { F1SessionData } from '@shared/f1live'

/**
 * APP_IMPROVEMENT_ROADMAP.md P2 item 31: seeking backward then forward to the
 * same clock must produce identical timing, tyre, race-control, and strategy
 * state. This is a regression guard, not a bug fix — verified directly that
 * `F1LiveProvider`'s ERS ingest state (`ersBuild`/`lapCursor`) is one-time,
 * forward, ingest-order scratch state that produces an immutable `ersPoints`
 * timeline; `getSnapshotAt` never re-derives it from seek position (only
 * `advanceTo`'s merge cursors are seek-position-driven, and those already
 * reset on backward seek via `resetCursor`).
 *
 * (`energyEligibleForSec`'s documented backward-scrub exception is already
 * covered at the pure-function level in `ers.test.ts` — driving it through a
 * real provider here would require fabricating CarData/interval telemetry
 * shapes precisely enough that a wrong fixture would silently test nothing,
 * since `attachErs` short-circuits entirely when `ersPoints` is empty.)
 */

const ipc = vi.hoisted(() => ({
  loadSession: vi.fn(),
  loadSessionEnrichment: vi.fn(),
  getLive: vi.fn()
}))
const storeMem = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@renderer/lib/ipc', () => ({
  hasBridge: () => true,
  bridge: () => ({ f1: ipc })
}))

vi.mock('@renderer/store/persist', () => ({
  persist: {
    get: async (namespace: string, key: string) => storeMem.get(`${namespace}:${key}`) ?? null,
    set: async (namespace: string, key: string, value: unknown) => {
      storeMem.set(`${namespace}:${key}`, value)
    },
    remove: async (namespace: string, key: string) => {
      storeMem.delete(`${namespace}:${key}`)
    },
    all: async () => ({}),
    __resetMemory: () => storeMem.clear()
  }
}))

import { F1LiveProvider } from '@renderer/core/providers/F1LiveProvider'

const archive: F1SessionData = {
  summary: {
    path: '2026/Determinism_Grand_Prix/2026-01-01_Race/',
    key: 1,
    year: 2026,
    meetingName: 'Determinism Grand Prix',
    meetingOfficialName: null,
    name: 'Race',
    type: 'Race',
    number: 1,
    circuitShortName: 'Test',
    countryName: 'Test',
    countryCode: 'TST',
    location: 'Test',
    startDate: null,
    endDate: null,
    gmtOffset: '+00:00:00',
    archiveStatus: 'Complete'
  },
  sessionInfo: {},
  streams: {
    DriverList: [
      {
        t: 0,
        d: { '1': { RacingNumber: '1', Tla: 'TST' }, '2': { RacingNumber: '2', Tla: 'ALT' } }
      }
    ],
    TimingData: Array.from({ length: 8 }, (_, i) => {
      const lap = i + 1
      return {
        t: lap * 10,
        d: {
          Lines: {
            '1': { Position: '1', NumberOfLaps: lap, LastLapTime: { Value: '1:30.000' } },
            '2': { Position: '2', NumberOfLaps: lap, LastLapTime: { Value: '1:31.000' } }
          }
        }
      }
    }),
    TimingAppData: [
      {
        t: 0,
        d: {
          Lines: {
            '1': {
              Stints: { '0': { Compound: 'MEDIUM', StartLaps: 0, TotalLaps: 1, New: 'true' } }
            }
          }
        }
      },
      {
        t: 45,
        d: {
          Lines: {
            '1': { Stints: { '1': { Compound: 'HARD', StartLaps: 0, TotalLaps: 1, New: 'true' } } }
          }
        }
      }
    ],
    RaceControlMessages: [
      {
        t: 25,
        d: {
          Messages: [
            { Category: 'Flag', Message: 'YELLOW FLAG SECTOR 2', Flag: 'YELLOW', Sector: 2 }
          ]
        }
      },
      { t: 55, d: { Messages: [{ Category: 'Flag', Message: 'GREEN FLAG', Flag: 'GREEN' }] } }
    ],
    TrackStatus: [
      { t: 0, d: { Status: '1', Message: 'AllClear' } },
      { t: 30, d: { Status: '2', Message: 'Yellow' } },
      { t: 60, d: { Status: '1', Message: 'AllClear' } }
    ]
  },
  duration: 80
}

function snapshotFingerprint(snapshot: ReturnType<F1LiveProvider['getSnapshotAt']>) {
  // A deep, stable subset covering everything the roadmap names: timing,
  // tyre/stint, race-control, and the strategy-relevant fields.
  return JSON.stringify({
    timing: snapshot.timing,
    stints: snapshot.stints,
    laps: snapshot.laps,
    raceControl: snapshot.raceControl,
    trackStatus: snapshot.trackStatus,
    currentLap: snapshot.currentLap
  })
}

describe('replay determinism', () => {
  beforeEach(() => {
    ipc.loadSession.mockReset().mockResolvedValue(archive)
    ipc.loadSessionEnrichment.mockReset().mockResolvedValue({
      carData: [],
      position: [],
      duration: archive.duration,
      nextCarDataOffset: 0,
      nextPositionOffset: 0,
      done: true
    })
    ipc.getLive.mockReset()
    storeMem.clear()
  })

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  it('returns an identical snapshot at t2 after seeking backward then forward again', async () => {
    const provider = new F1LiveProvider()
    await provider.loadSession(archive.summary.path)

    const t1 = 25
    const t2 = 65

    const forward = snapshotFingerprint(provider.getSnapshotAt(t2))
    const afterBackward = snapshotFingerprint(provider.getSnapshotAt(t1))
    const forwardAgain = snapshotFingerprint(provider.getSnapshotAt(t2))

    expect(forwardAgain).toBe(forward)
    expect(afterBackward).not.toBe(forward)
  })

  it('is deterministic across a longer scrub pattern (forward/back/forward/back)', async () => {
    const provider = new F1LiveProvider()
    await provider.loadSession(archive.summary.path)

    const baseline = snapshotFingerprint(provider.getSnapshotAt(70))
    provider.getSnapshotAt(10)
    provider.getSnapshotAt(50)
    provider.getSnapshotAt(20)
    const after = snapshotFingerprint(provider.getSnapshotAt(70))

    expect(after).toBe(baseline)
  })

  it('does not leak driver/timing state across a session switch', async () => {
    const provider = new F1LiveProvider()
    await provider.loadSession(archive.summary.path)
    provider.getSnapshotAt(50)

    const other: F1SessionData = {
      ...archive,
      summary: {
        ...archive.summary,
        path: '2026/Other_Grand_Prix/2026-01-02_Race/',
        key: 2,
        meetingName: 'Other Grand Prix'
      },
      streams: {
        DriverList: [{ t: 0, d: { '9': { RacingNumber: '9', Tla: 'NEW' } } }],
        TimingData: [{ t: 5, d: { Lines: { '9': { Position: '1', NumberOfLaps: 1 } } } }]
      },
      duration: 20
    }
    ipc.loadSession.mockResolvedValue(other)
    await provider.loadSession(other.summary.path)

    const snapshot = provider.getSnapshotAt(5)
    expect(snapshot.drivers.map((d) => d.number)).toEqual([9])
    expect(snapshot.timing.map((t) => t.driverNumber)).toEqual([9])
  })
})
