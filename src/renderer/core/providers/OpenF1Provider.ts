import type {
  Driver,
  LapSample,
  PositionSample,
  RaceControlMessage,
  Stint,
  TimingEntry,
  SessionInfo,
  SessionType,
  WeatherSample,
  DriverStatus,
  TrackStatus,
  SectorTime
} from '@shared/models'
import { OPENF1_BASE_URL } from '@shared/constants'
import { clamp } from '@renderer/lib/utils'
import type { DataProvider, ProviderCapabilities, RaceSnapshot } from './types'
import {
  nearestAtOrBefore,
  normalizeCompound,
  normalizeFlag,
  normalizeGap,
  raceControlSeverity,
  toMs
} from './normalize'
import { assignCredibleFastestLap } from './f1normalize'

// ── Raw OpenF1 shapes (only the fields we use) ───────────────────────────────
interface RawSession {
  session_key: number
  meeting_key: number
  session_name: string
  session_type: string
  circuit_short_name?: string
  country_name?: string
  country_code?: string
  location?: string
  date_start: string
  date_end: string
  gmt_offset?: string
  year?: number
}
interface RawDriver {
  driver_number: number
  name_acronym: string
  first_name?: string
  last_name?: string
  full_name?: string
  broadcast_name?: string
  team_name?: string
  team_colour?: string
  headshot_url?: string
  country_code?: string
}
interface RawLap {
  driver_number: number
  lap_number: number
  lap_duration: number | null
  duration_sector_1: number | null
  duration_sector_2: number | null
  duration_sector_3: number | null
  i1_speed: number | null
  i2_speed: number | null
  st_speed: number | null
  is_pit_out_lap: boolean
  date_start: string | null
}
interface RawStint {
  driver_number: number
  stint_number: number
  lap_start: number
  lap_end: number
  compound: string
  tyre_age_at_start: number
}
interface RawInterval {
  driver_number: number
  date: string
  gap_to_leader: number | string | null
  interval: number | string | null
}
interface RawPosition {
  driver_number: number
  date: string
  position: number
}
interface RawRaceControl {
  date: string
  category: string
  message: string
  flag: string | null
  scope: string | null
  sector: number | null
  driver_number: number | null
  lap_number: number | null
}
interface RawWeather {
  date: string
  air_temperature: number | null
  track_temperature: number | null
  humidity: number | null
  pressure: number | null
  rainfall: number | null
  wind_speed: number | null
  wind_direction: number | null
}

function mapSessionType(name: string): SessionType {
  const s = name.toLowerCase()
  if (s.includes('sprint') && s.includes('qual')) return 'sprint-qualifying'
  if (s.includes('sprint')) return 'sprint'
  if (s.includes('qual')) return 'qualifying'
  if (s.includes('practice')) return 'practice'
  if (s.includes('race')) return 'race'
  return 'unknown'
}

async function getJson<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`OpenF1 ${res.status} for ${url}`)
  const data = (await res.json()) as unknown
  return Array.isArray(data) ? (data as T[]) : []
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * OpenF1Provider — real historical / replay data from api.openf1.org.
 *
 * Free, no key, 2023+ (rate limit ~3 req/s → loadSession fetches in throttled
 * waves). All raw payloads are normalized into RaceDeck models. Only historical
 * usage is wired here; live streaming stays a separate, user-connected concern.
 */
export class OpenF1Provider implements DataProvider {
  readonly capabilities: ProviderCapabilities = {
    id: 'openf1',
    label: 'OpenF1 (Historical / Replay)',
    description:
      'Community OpenF1 API. Real historical F1 data from 2023 onward for replay, analysis, and demos. No account required.',
    supportsHistorical: true,
    supportsLive: false,
    supportsReplay: true,
    requiresAuth: false,
    requiresSubscription: false,
    riskLevel: 'low',
    latencyClass: 'historical'
  }

  private session: SessionInfo | null = null
  private drivers: Driver[] = []
  private lapsByDriver = new Map<number, RawLap[]>()
  private intervalsByDriver = new Map<number, RawInterval[]>()
  private positionsByDriver = new Map<number, RawPosition[]>()
  private stintsByDriver = new Map<number, RawStint[]>()
  private raceControl: RaceControlMessage[] = []
  private weather: WeatherSample[] = []
  private startMs = 0
  private endMs = 0
  private totalLaps: number | null = null
  private stintCache: Stint[] = []
  private lapCacheKey = ''
  private lapCache: LapSample[] = []

  async listSessions(): Promise<SessionInfo[]> {
    const years = [new Date().getUTCFullYear(), new Date().getUTCFullYear() - 1, 2023]
    const uniqueYears = [...new Set(years)]
    const results: RawSession[] = []
    for (const y of uniqueYears) {
      try {
        const s = await getJson<RawSession>(`${OPENF1_BASE_URL}/sessions?year=${y}`)
        results.push(...s)
      } catch {
        /* skip year on error */
      }
      await delay(300)
      if (results.length > 0 && y !== 2023) break // latest year with data is enough
    }
    return results
      .map((r) => this.toSessionInfo(r))
      .sort((a, b) => toMs(b.dateStart) - toMs(a.dateStart))
  }

  private toSessionInfo(r: RawSession): SessionInfo {
    return {
      id: String(r.session_key),
      meetingId: String(r.meeting_key),
      name: r.session_name,
      type: mapSessionType(r.session_name),
      meetingName: null,
      circuitName: r.circuit_short_name ?? null,
      circuitShortName: r.circuit_short_name ?? null,
      countryName: r.country_name ?? null,
      countryCode: r.country_code ?? null,
      location: r.location ?? null,
      dateStart: r.date_start ?? null,
      dateEnd: r.date_end ?? null,
      gmtOffset: r.gmt_offset ?? null,
      year: r.year ?? null,
      totalLaps: null,
      provider: 'openf1'
    }
  }

  async loadSession(sessionId: string): Promise<SessionInfo> {
    const key = sessionId
    // Wave 1 (≤3 concurrent) — respect the 3 req/s rate limit.
    const [sessions, drivers, stints] = await Promise.all([
      getJson<RawSession>(`${OPENF1_BASE_URL}/sessions?session_key=${key}`),
      getJson<RawDriver>(`${OPENF1_BASE_URL}/drivers?session_key=${key}`),
      getJson<RawStint>(`${OPENF1_BASE_URL}/stints?session_key=${key}`)
    ])
    await delay(350)
    const [laps, intervals, weather] = await Promise.all([
      getJson<RawLap>(`${OPENF1_BASE_URL}/laps?session_key=${key}`),
      getJson<RawInterval>(`${OPENF1_BASE_URL}/intervals?session_key=${key}`).catch(() => []),
      getJson<RawWeather>(`${OPENF1_BASE_URL}/weather?session_key=${key}`).catch(() => [])
    ])
    await delay(350)
    const [positions, raceControl] = await Promise.all([
      getJson<RawPosition>(`${OPENF1_BASE_URL}/position?session_key=${key}`).catch(() => []),
      getJson<RawRaceControl>(`${OPENF1_BASE_URL}/race_control?session_key=${key}`).catch(() => [])
    ])

    const raw = sessions[0]
    if (!raw) throw new Error(`OpenF1 session ${key} not found`)
    this.session = this.toSessionInfo(raw)
    this.startMs = toMs(raw.date_start)
    this.endMs = toMs(raw.date_end)

    this.drivers = drivers.map((d) => ({
      number: d.driver_number,
      code: d.name_acronym,
      firstName: d.first_name ?? null,
      lastName: d.last_name ?? null,
      fullName: d.full_name ?? `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim(),
      broadcastName: d.broadcast_name ?? null,
      teamName: d.team_name ?? null,
      teamColour: d.team_colour ?? null,
      headshotUrl: d.headshot_url ?? null,
      countryCode: d.country_code ?? null
    }))

    this.indexByDriver(laps, this.lapsByDriver, (l) => l.lap_number, true)
    this.indexByDriver(intervals, this.intervalsByDriver, (i) => toMs(i.date))
    this.indexByDriver(positions, this.positionsByDriver, (p) => toMs(p.date))
    this.stintsByDriver.clear()
    for (const s of stints) {
      const arr = this.stintsByDriver.get(s.driver_number) ?? []
      arr.push(s)
      this.stintsByDriver.set(s.driver_number, arr)
    }
    this.stintCache = this.allStints()
    this.lapCacheKey = ''
    this.lapCache = []

    this.totalLaps = laps.reduce((m, l) => Math.max(m, l.lap_number), 0) || null
    if (this.session) this.session.totalLaps = this.session.type === 'race' ? this.totalLaps : null

    this.raceControl = raceControl
      .map((m, i) => {
        const flag = normalizeFlag(m.flag)
        return {
          id: `rc-${i}`,
          date: m.date,
          category: m.category,
          message: m.message,
          flag,
          scope: m.scope,
          sector: m.sector,
          driverNumber: m.driver_number,
          lapNumber: m.lap_number,
          severity: raceControlSeverity(m.category, flag, m.message)
        } as RaceControlMessage
      })
      .sort((a, b) => toMs(a.date) - toMs(b.date))

    this.weather = weather
      .map((w) => ({
        date: w.date,
        airTemp: w.air_temperature,
        trackTemp: w.track_temperature,
        humidity: w.humidity,
        pressure: w.pressure,
        windSpeed: w.wind_speed,
        windDirection: w.wind_direction,
        rainfall: (w.rainfall ?? 0) > 0
      }))
      .sort((a, b) => toMs(a.date) - toMs(b.date))

    return this.session
  }

  private indexByDriver<T extends { driver_number: number }>(
    items: T[],
    map: Map<number, T[]>,
    sortKey: (x: T) => number,
    ascendingKeyOnly = false
  ): void {
    map.clear()
    for (const it of items) {
      const arr = map.get(it.driver_number) ?? []
      arr.push(it)
      map.set(it.driver_number, arr)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => sortKey(a) - sortKey(b))
    }
    void ascendingKeyOnly
  }

  getDuration(): number {
    return this.endMs > this.startMs ? (this.endMs - this.startMs) / 1000 : 0
  }

  getSnapshotAt(t: number): RaceSnapshot {
    if (!this.session) throw new Error('OpenF1Provider: no session loaded')
    const duration = this.getDuration()
    const clock = clamp(t, 0, duration || t)
    const wall = this.startMs + clock * 1000

    const leaderCompleted = this.computeLeaderCompleted(wall)

    const timing: TimingEntry[] = this.drivers.map((d) =>
      this.buildTiming(d.number, wall, leaderCompleted)
    )

    // Order primarily by OpenF1 position; fall back to laps/lastLap.
    timing.sort((a, b) => {
      if (a.position != null && b.position != null) return a.position - b.position
      if (a.position != null) return -1
      if (b.position != null) return 1
      return (b.lapNumber ?? 0) - (a.lapNumber ?? 0)
    })
    timing.forEach((e, i) => (e.position = e.position ?? i + 1))
    assignCredibleFastestLap(timing)
    for (const entry of timing) {
      entry.isPersonalBestLap = entry.lastLap != null && entry.bestLap != null && entry.lastLap === entry.bestLap
    }

    const positions: PositionSample[] = timing.map((e) => {
      const laps = this.lapsByDriver.get(e.driverNumber) ?? []
      const cur = laps.find((l) => l.lap_number === e.lapNumber)
      const started = cur?.date_start ? toMs(cur.date_start) : 0
      const dur = (cur?.lap_duration ?? 0) * 1000
      const progress = started && dur ? clamp((wall - started) / dur, 0, 1) : 0
      return {
        driverNumber: e.driverNumber,
        date: new Date(wall).toISOString(),
        x: null,
        y: null,
        z: null,
        position: e.position,
        lapProgress: progress
      }
    })

    const raceControl = this.raceControl.filter((m) => toMs(m.date) <= wall)
    const weatherHistory = this.weather.filter((w) => toMs(w.date) <= wall)
    const currentWeather = nearestAtOrBefore(this.weather, wall, (w) => toMs(w.date))
    const currentLap = Math.min(this.totalLaps ?? leaderCompleted + 1, leaderCompleted + 1)

    return {
      session: this.session,
      drivers: this.drivers,
      timing,
      laps: this.allLapsUpTo(wall),
      stints: this.stintCache,
      raceControl,
      weather: currentWeather,
      weatherHistory,
      positions,
      availability: {
        timing: timing.length > 0,
        laps: this.lapsByDriver.size > 0,
        stints: this.stintsByDriver.size > 0,
        intervals: this.intervalsByDriver.size > 0,
        raceControl: this.raceControl.length > 0,
        weather: this.weather.length > 0,
        positions: false,
        positionProgress: this.positionsByDriver.size > 0 || this.lapsByDriver.size > 0,
        telemetry: false,
        live: false
      },
      clock,
      currentLap: this.session.type === 'race' ? currentLap : null,
      totalLaps: this.totalLaps,
      trackStatus: this.deriveTrackStatus(raceControl)
    }
  }

  private computeLeaderCompleted(wall: number): number {
    let max = 0
    for (const laps of this.lapsByDriver.values()) {
      let c = 0
      for (const l of laps) {
        if (this.lapEndMs(l) <= wall && this.lapEndMs(l) > 0) c = Math.max(c, l.lap_number)
      }
      max = Math.max(max, c)
    }
    return max
  }

  private lapEndMs(l: RawLap): number {
    const start = toMs(l.date_start)
    if (!start) return 0
    if (l.lap_duration && l.lap_duration > 0) return start + l.lap_duration * 1000
    return start // unknown duration → treat lap end at its start (conservative)
  }

  private buildTiming(driverNumber: number, wall: number, leaderCompleted: number): TimingEntry {
    const laps = this.lapsByDriver.get(driverNumber) ?? []
    const completed = laps.filter((l) => this.lapEndMs(l) <= wall && this.lapEndMs(l) > 0)
    const completedCount = completed.length ? Math.max(...completed.map((l) => l.lap_number)) : 0
    const lastLapObj = completed.length ? completed[completed.length - 1] : null
    const validDurations = completed
      .map((l) => l.lap_duration)
      .filter((d): d is number => d != null && d > 0)
    const bestLap = validDurations.length ? Math.min(...validDurations) : null

    const interval = nearestAtOrBefore(
      this.intervalsByDriver.get(driverNumber) ?? [],
      wall,
      (i) => toMs(i.date)
    )
    const position = nearestAtOrBefore(
      this.positionsByDriver.get(driverNumber) ?? [],
      wall,
      (p) => toMs(p.date)
    )

    const currentLapNumber = completedCount + 1
    const stint = (this.stintsByDriver.get(driverNumber) ?? []).find(
      (s) => currentLapNumber >= s.lap_start && currentLapNumber <= s.lap_end
    )
    const compound = stint ? normalizeCompound(stint.compound) : null
    const stintAge = stint ? currentLapNumber - stint.lap_start + stint.tyre_age_at_start : null
    // Laps since the set was fitted — excludes the age it already carried.
    const lapsThisStint = stint ? Math.max(0, currentLapNumber - stint.lap_start) : null
    const pitStops = Math.max(0, (stint?.stint_number ?? 1) - 1)

    const curLapObj = laps.find((l) => l.lap_number === currentLapNumber)
    const started = curLapObj?.date_start ? toMs(curLapObj.date_start) : 0
    const dur = (curLapObj?.lap_duration ?? 0) * 1000
    const fraction = started && dur ? clamp((wall - started) / dur, 0, 1) : 0
    const inPit = !!curLapObj?.is_pit_out_lap && fraction < 0.12

    // Retirement heuristic: far behind on laps AND no fresh lap for a while.
    const lastActivity = lastLapObj ? this.lapEndMs(lastLapObj) : 0
    const stale = wall - lastActivity > 4 * 60 * 1000
    const wayBehind = leaderCompleted - completedCount > 3
    const status: DriverStatus =
      this.totalLaps && completedCount >= this.totalLaps
        ? 'FINISHED'
        : stale && wayBehind && completedCount > 0
          ? 'STOPPED'
          : inPit
            ? 'IN_PIT'
            : 'RUNNING'

    const sector = (v: number | null | undefined): SectorTime => ({
      seconds: v ?? null,
      state: 'none'
    })

    const gapToLeader = normalizeGap(interval?.gap_to_leader)
    return {
      driverNumber,
      position: position?.position ?? null,
      gapToLeader: position?.position === 1 ? 0 : gapToLeader,
      intervalAhead: position?.position === 1 ? null : normalizeGap(interval?.interval),
      lastLap: lastLapObj?.lap_duration ?? null,
      bestLap,
      lapNumber: currentLapNumber,
      stintAge,
      lapsThisStint,
      compound,
      sector1: sector(lastLapObj?.duration_sector_1),
      sector2: sector(lastLapObj?.duration_sector_2),
      sector3: sector(lastLapObj?.duration_sector_3),
      status,
      inPit,
      pitStops,
      isFastestLap: false,
      isPersonalBestLap: false,
      penalty: null,
      underInvestigation: false,
      // STOPPED is only an inactivity heuristic here, not evidence of retirement.
      retired: false,
      energyPct: null,
      deployMode: null
    }
  }

  private deriveTrackStatus(rc: RaceControlMessage[]): TrackStatus {
    for (let i = rc.length - 1; i >= 0; i--) {
      const m = rc[i]
      const msg = m.message.toLowerCase()
      if (m.flag === 'GREEN' || msg.includes('track clear') || msg.includes('safety car in')) {
        return 'CLEAR'
      }
      if (msg.includes('red flag') || m.flag === 'RED') return 'RED'
      if (msg.includes('safety car')) return 'SAFETY_CAR'
      if (msg.includes('virtual safety car') || msg.includes('vsc')) return 'VSC'
      if (m.flag === 'YELLOW' || m.flag === 'DOUBLE_YELLOW') return 'YELLOW'
    }
    return 'CLEAR'
  }

  private allLapsUpTo(wall: number): LapSample[] {
    const completedCounts: number[] = []
    for (const laps of this.lapsByDriver.values()) {
      let count = 0
      while (count < laps.length && this.lapEndMs(laps[count]) <= wall && this.lapEndMs(laps[count]) > 0) {
        count++
      }
      completedCounts.push(count)
    }
    const cacheKey = completedCounts.join(',')
    if (cacheKey === this.lapCacheKey) return this.lapCache

    const out: LapSample[] = []
    for (const [driverNumber, laps] of this.lapsByDriver) {
      for (const l of laps) {
        if (this.lapEndMs(l) > wall || this.lapEndMs(l) === 0) continue
        out.push({
          driverNumber,
          lapNumber: l.lap_number,
          lapTime: l.lap_duration,
          sector1: l.duration_sector_1,
          sector2: l.duration_sector_2,
          sector3: l.duration_sector_3,
          speedI1: l.i1_speed,
          speedI2: l.i2_speed,
          speedST: l.st_speed,
          isPitOutLap: l.is_pit_out_lap,
          isPitInLap: false,
          compound: this.compoundAt(driverNumber, l.lap_number),
          dateStart: l.date_start,
          sessionTime: this.startMs > 0 ? (this.lapEndMs(l) - this.startMs) / 1000 : null
        })
      }
    }
    this.lapCacheKey = cacheKey
    this.lapCache = out
    return this.lapCache
  }

  private compoundAt(driverNumber: number, lap: number) {
    const stint = (this.stintsByDriver.get(driverNumber) ?? []).find(
      (s) => lap >= s.lap_start && lap <= s.lap_end
    )
    return stint ? normalizeCompound(stint.compound) : null
  }

  private allStints(): Stint[] {
    const out: Stint[] = []
    for (const [driverNumber, stints] of this.stintsByDriver) {
      for (const s of stints) {
        out.push({
          driverNumber,
          stintNumber: s.stint_number,
          lapStart: s.lap_start,
          lapEnd: s.lap_end,
          tyre: {
            compound: normalizeCompound(s.compound),
            ageAtStart: s.tyre_age_at_start,
            isNew: s.tyre_age_at_start === 0
          },
          degradationPerLap: null
        })
      }
    }
    return out
  }

  getDriverLaps(driverNumber: number): LapSample[] {
    const laps = this.lapsByDriver.get(driverNumber) ?? []
    return laps.map((l) => ({
      driverNumber,
      lapNumber: l.lap_number,
      lapTime: l.lap_duration,
      sector1: l.duration_sector_1,
      sector2: l.duration_sector_2,
      sector3: l.duration_sector_3,
      speedI1: l.i1_speed,
      speedI2: l.i2_speed,
      speedST: l.st_speed,
      isPitOutLap: l.is_pit_out_lap,
      isPitInLap: false,
      compound: this.compoundAt(driverNumber, l.lap_number),
      dateStart: l.date_start,
      sessionTime: this.startMs > 0 ? (this.lapEndMs(l) - this.startMs) / 1000 : null
    }))
  }
}
