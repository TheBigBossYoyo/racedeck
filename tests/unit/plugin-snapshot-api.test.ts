import { describe, expect, it } from 'vitest'
import {
  PLUGIN_FEEDS,
  projectPluginSnapshot,
  validatePluginManifest
} from '@renderer/core/engines/PluginSnapshotApi'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { Driver, SectorTime, TimingEntry } from '@shared/models'

const NO_SECTOR: SectorTime = { seconds: null, state: 'none' }

function driver(number: number): Driver {
  return {
    number,
    code: `D${number}`,
    firstName: null,
    lastName: null,
    fullName: `D${number}`,
    broadcastName: null,
    teamName: null,
    teamColour: null,
    headshotUrl: null,
    countryCode: null
  }
}

function entry(number: number): TimingEntry {
  return {
    driverNumber: number,
    position: number,
    gapToLeader: 0,
    intervalAhead: null,
    lastLap: 90,
    bestLap: 90,
    lapNumber: 10,
    stintAge: 5,
    lapsThisStint: 5,
    compound: 'MEDIUM',
    sector1: NO_SECTOR,
    sector2: NO_SECTOR,
    sector3: NO_SECTOR,
    status: 'RUNNING',
    inPit: false,
    pitStops: 0,
    isFastestLap: false,
    isPersonalBestLap: false,
    penalty: null,
    underInvestigation: false,
    retired: false,
    energyPct: null,
    deployMode: null
  }
}

function snapshot(): RaceSnapshot {
  return {
    session: {
      id: 'plugin-1',
      meetingId: null,
      name: 'Race',
      type: 'race',
      meetingName: 'Test GP',
      circuitName: null,
      circuitShortName: null,
      countryName: null,
      countryCode: null,
      location: null,
      dateStart: '2026-03-01T14:00:00.000Z',
      dateEnd: null,
      gmtOffset: null,
      year: 2026,
      totalLaps: 50,
      provider: 'test'
    },
    drivers: [driver(1)],
    timing: [entry(1)],
    laps: [],
    stints: [],
    raceControl: [],
    weather: null,
    weatherHistory: [],
    positions: [],
    availability: {
      timing: true,
      laps: false,
      stints: false,
      intervals: false,
      raceControl: true,
      weather: false,
      positions: false,
      positionProgress: false,
      telemetry: false,
      live: false
    },
    clock: 1234,
    currentLap: 10,
    totalLaps: 50,
    trackStatus: 'CLEAR'
  }
}

// Keys that must never reach a plugin: TOD/DRM/auth-adjacent, or anything
// under `session` (a plugin only gets `clock`/`currentLap`/`trackStatus`).
const DENYLIST = ['session', 'apiKey', 'drmReady', 'drmCapable', 'token', 'credential', 'cookie']

describe('projectPluginSnapshot', () => {
  it('always includes base context regardless of declared feeds', () => {
    const out = projectPluginSnapshot(snapshot(), [])
    expect(out.clock).toBe(1234)
    expect(out.currentLap).toBe(10)
    expect(out.trackStatus).toBe('CLEAR')
    expect(out.timing).toBeUndefined()
    expect(out.laps).toBeUndefined()
  })

  it('includes only the declared feeds', () => {
    const out = projectPluginSnapshot(snapshot(), ['timing', 'drivers'])
    expect(out.timing).toBeDefined()
    expect(out.drivers).toBeDefined()
    expect(out.laps).toBeUndefined()
    expect(out.weather).toBeUndefined()
    expect(out.raceControl).toBeUndefined()
    expect(out.stints).toBeUndefined()
  })

  it('includes every declared feed when all are requested', () => {
    const out = projectPluginSnapshot(snapshot(), [...PLUGIN_FEEDS])
    for (const feed of PLUGIN_FEEDS) {
      expect(out).toHaveProperty(feed)
    }
  })

  it('adversarial: the projected DTO carries no denylisted key at any depth and round-trips through structuredClone', () => {
    const out = projectPluginSnapshot(snapshot(), [...PLUGIN_FEEDS])
    const json = JSON.stringify(out)
    for (const banned of DENYLIST) {
      expect(json.toLowerCase()).not.toContain(banned.toLowerCase())
    }
    // No functions/class instances leak through — a plain-data round trip
    // must reproduce the object exactly.
    expect(structuredClone(out)).toEqual(out)
  })
})

describe('validatePluginManifest', () => {
  it('returns no missing feeds when everything declared is available', () => {
    const missing = validatePluginManifest(
      { id: 'p1', name: 'p1', requiredFeeds: ['timing', 'raceControl'] },
      snapshot().availability
    )
    expect(missing).toEqual([])
  })

  it('returns feeds the session cannot back', () => {
    const missing = validatePluginManifest(
      { id: 'p1', name: 'p1', requiredFeeds: ['timing', 'laps', 'weather'] },
      snapshot().availability
    )
    expect(missing.sort()).toEqual(['laps', 'weather'])
  })

  it('never flags "drivers" as missing — it has no availability flag', () => {
    const missing = validatePluginManifest(
      { id: 'p1', name: 'p1', requiredFeeds: ['drivers'] },
      snapshot().availability
    )
    expect(missing).toEqual([])
  })
})
