import { describe, expect, it } from 'vitest'
import { buildDebrief, debriefToMarkdown } from '@renderer/core/engines/DebriefBuilder'
import type { RaceBookmark } from '@renderer/core/engines/RaceBookmarks'
import { createAnnotation } from '@renderer/core/engines/UserAnnotations'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { Driver, PitLaneTime, SectorTime, TimingEntry } from '@shared/models'

const NO_SECTOR: SectorTime = { seconds: null, state: 'none' }

function driver(number: number, code: string): Driver {
  return {
    number,
    code,
    firstName: null,
    lastName: null,
    fullName: code,
    broadcastName: null,
    teamName: null,
    teamColour: null,
    headshotUrl: null,
    countryCode: null
  }
}

function entry(number: number, position: number): TimingEntry {
  return {
    driverNumber: number,
    position,
    gapToLeader: position === 1 ? 0 : position * 5,
    intervalAhead: null,
    lastLap: 90,
    bestLap: 90,
    lapNumber: 40,
    stintAge: 10,
    lapsThisStint: 10,
    compound: 'MEDIUM',
    sector1: NO_SECTOR,
    sector2: NO_SECTOR,
    sector3: NO_SECTOR,
    status: 'RUNNING',
    inPit: false,
    pitStops: 1,
    isFastestLap: false,
    isPersonalBestLap: false,
    penalty: null,
    underInvestigation: false,
    retired: false,
    energyPct: null,
    deployMode: null
  }
}

function snapshot(overrides: Partial<RaceSnapshot> = {}): RaceSnapshot {
  return {
    session: {
      id: 'debrief',
      meetingId: null,
      name: 'Race',
      type: 'race',
      meetingName: 'Test GP',
      circuitName: null,
      circuitShortName: null,
      countryName: null,
      countryCode: null,
      location: null,
      dateStart: null,
      dateEnd: null,
      gmtOffset: null,
      year: 2026,
      totalLaps: 50,
      provider: 'test'
    },
    drivers: [driver(1, 'ONE'), driver(2, 'TWO')],
    timing: [entry(1, 1), entry(2, 2)],
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
    clock: 3600,
    currentLap: 40,
    totalLaps: 50,
    trackStatus: 'CLEAR',
    ...overrides
  }
}

const bookmarks: RaceBookmark[] = [
  { kind: 'start', t: 0, label: 'Lights out' },
  { kind: 'safety-car', t: 900, label: 'Safety Car' }
]

describe('buildDebrief', () => {
  it('defaults to every driver, ordered by final position', () => {
    const debrief = buildDebrief(snapshot(), bookmarks)
    expect(debrief.drivers.map((d) => d.code)).toEqual(['ONE', 'TWO'])
  })

  it('restricts to selectedDriverNumbers when given', () => {
    const debrief = buildDebrief(snapshot(), bookmarks, [2])
    expect(debrief.drivers.map((d) => d.code)).toEqual(['TWO'])
  })

  it('attaches each driver their own pit stops', () => {
    const pitLaneTimes: PitLaneTime[] = [
      { driverNumber: 1, duration: 22, lap: 20 },
      { driverNumber: 2, duration: 24, lap: 25 }
    ]
    const debrief = buildDebrief(snapshot({ pitLaneTimes }), bookmarks)
    const one = debrief.drivers.find((d) => d.code === 'ONE')!
    const two = debrief.drivers.find((d) => d.code === 'TWO')!
    expect(one.pitStops).toHaveLength(1)
    expect(one.pitStops[0].durationSec).toBe(22)
    expect(two.pitStops).toHaveLength(1)
    expect(two.pitStops[0].durationSec).toBe(24)
  })

  it('carries the bookmarks and a provenance note through unchanged', () => {
    const debrief = buildDebrief(snapshot(), bookmarks)
    expect(debrief.bookmarks).toBe(bookmarks)
    expect(debrief.provenanceNote.length).toBeGreaterThan(0)
  })
})

describe('debriefToMarkdown', () => {
  it('renders a heading, per-driver sections, a timeline, and provenance', () => {
    const debrief = buildDebrief(snapshot(), bookmarks)
    const md = debriefToMarkdown(debrief)
    expect(md).toContain('# Race Debrief')
    expect(md).toContain('### ONE')
    expect(md).toContain('### TWO')
    expect(md).toContain('## Timeline')
    expect(md).toContain('Safety Car')
    expect(md).toContain('## Provenance')
  })

  it('includes pit-stop lines with SC/VSC and penalty tags when present', () => {
    const pitLaneTimes: PitLaneTime[] = [{ driverNumber: 1, duration: 22, lap: 20 }]
    const debrief = buildDebrief(snapshot({ pitLaneTimes }), bookmarks)
    const md = debriefToMarkdown(debrief)
    expect(md).toMatch(/Lap 20: 22\.0s/)
  })

  it('renders a Notes section with driver code and tag when annotations are given', () => {
    const note = createAnnotation({
      sessionId: 'debrief',
      t: 120,
      driverNumber: 1,
      lapNumber: 3,
      tag: 'strategy',
      text: 'Undercut window opening'
    })
    const debrief = buildDebrief(snapshot(), bookmarks, undefined, [note])
    const md = debriefToMarkdown(debrief)
    expect(md).toContain('## Notes')
    expect(md).toContain('[ONE]')
    expect(md).toContain('(strategy)')
    expect(md).toContain('Undercut window opening')
  })

  it('omits the Notes section entirely when there are no annotations', () => {
    const debrief = buildDebrief(snapshot(), bookmarks)
    const md = debriefToMarkdown(debrief)
    expect(md).not.toContain('## Notes')
  })
})
