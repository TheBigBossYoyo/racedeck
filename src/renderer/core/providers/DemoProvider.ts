import type {
  Driver,
  LapSample,
  PositionSample,
  RaceControlMessage,
  Stint,
  TimingEntry,
  TyreCompound,
  SessionInfo,
  WeatherSample,
  TelemetrySample,
  DriverStatus,
  TrackStatus,
  SectorState
} from '@shared/models'
import { teamColorFor } from '@shared/constants'
import { clamp } from '@renderer/lib/utils'
import { ch45ToAeroMode } from '@shared/f1live'
import type { DataProvider, ProviderCapabilities, RaceSnapshot, SessionTimeline } from './types'
import { buildTimeline } from '@renderer/core/engines/SessionPhaseEngine'

/** Deterministic PRNG so the demo race is identical every run (stable tests). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface GridEntry {
  number: number
  code: string
  first: string
  last: string
  team: string
  pace: number // lap-time multiplier (1.0 = reference)
  plan: { stopLap: number; to: TyreCompound }[]
  startTyre: TyreCompound
}

const GRID: GridEntry[] = [
  { number: 1, code: 'VER', first: 'Max', last: 'Verstappen', team: 'Red Bull Racing', pace: 1.0, startTyre: 'MEDIUM', plan: [{ stopLap: 26, to: 'HARD' }] },
  { number: 4, code: 'NOR', first: 'Lando', last: 'Norris', team: 'McLaren', pace: 1.0015, startTyre: 'MEDIUM', plan: [{ stopLap: 24, to: 'HARD' }] },
  { number: 16, code: 'LEC', first: 'Charles', last: 'Leclerc', team: 'Ferrari', pace: 1.0022, startTyre: 'SOFT', plan: [{ stopLap: 18, to: 'HARD' }, { stopLap: 40, to: 'MEDIUM' }] },
  { number: 81, code: 'PIA', first: 'Oscar', last: 'Piastri', team: 'McLaren', pace: 1.0028, startTyre: 'MEDIUM', plan: [{ stopLap: 27, to: 'HARD' }] },
  { number: 55, code: 'SAI', first: 'Carlos', last: 'Sainz', team: 'Ferrari', pace: 1.0035, startTyre: 'SOFT', plan: [{ stopLap: 19, to: 'HARD' }, { stopLap: 41, to: 'MEDIUM' }] },
  { number: 63, code: 'RUS', first: 'George', last: 'Russell', team: 'Mercedes', pace: 1.0041, startTyre: 'MEDIUM', plan: [{ stopLap: 25, to: 'HARD' }] },
  { number: 44, code: 'HAM', first: 'Lewis', last: 'Hamilton', team: 'Mercedes', pace: 1.0048, startTyre: 'MEDIUM', plan: [{ stopLap: 28, to: 'HARD' }] },
  { number: 11, code: 'PER', first: 'Sergio', last: 'Perez', team: 'Red Bull Racing', pace: 1.0056, startTyre: 'SOFT', plan: [{ stopLap: 20, to: 'MEDIUM' }, { stopLap: 42, to: 'HARD' }] },
  { number: 14, code: 'ALO', first: 'Fernando', last: 'Alonso', team: 'Aston Martin', pace: 1.0063, startTyre: 'HARD', plan: [{ stopLap: 32, to: 'MEDIUM' }] },
  { number: 18, code: 'STR', first: 'Lance', last: 'Stroll', team: 'Aston Martin', pace: 1.0079, startTyre: 'HARD', plan: [{ stopLap: 30, to: 'MEDIUM' }] },
  { number: 10, code: 'GAS', first: 'Pierre', last: 'Gasly', team: 'Alpine', pace: 1.0085, startTyre: 'MEDIUM', plan: [{ stopLap: 29, to: 'HARD' }] },
  { number: 31, code: 'OCO', first: 'Esteban', last: 'Ocon', team: 'Alpine', pace: 1.0091, startTyre: 'MEDIUM', plan: [{ stopLap: 31, to: 'HARD' }] },
  { number: 23, code: 'ALB', first: 'Alex', last: 'Albon', team: 'Williams', pace: 1.0097, startTyre: 'SOFT', plan: [{ stopLap: 22, to: 'HARD' }] },
  { number: 22, code: 'TSU', first: 'Yuki', last: 'Tsunoda', team: 'RB', pace: 1.0103, startTyre: 'MEDIUM', plan: [{ stopLap: 26, to: 'HARD' }] },
  { number: 3, code: 'RIC', first: 'Daniel', last: 'Ricciardo', team: 'RB', pace: 1.0114, startTyre: 'MEDIUM', plan: [{ stopLap: 27, to: 'HARD' }] },
  { number: 77, code: 'BOT', first: 'Valtteri', last: 'Bottas', team: 'Kick Sauber', pace: 1.012, startTyre: 'HARD', plan: [{ stopLap: 34, to: 'MEDIUM' }] },
  { number: 24, code: 'ZHO', first: 'Guanyu', last: 'Zhou', team: 'Kick Sauber', pace: 1.0126, startTyre: 'HARD', plan: [{ stopLap: 33, to: 'MEDIUM' }] },
  { number: 20, code: 'MAG', first: 'Kevin', last: 'Magnussen', team: 'Haas', pace: 1.0132, startTyre: 'SOFT', plan: [{ stopLap: 21, to: 'HARD' }] },
  { number: 27, code: 'HUL', first: 'Nico', last: 'Hulkenberg', team: 'Haas', pace: 1.0138, startTyre: 'MEDIUM', plan: [{ stopLap: 28, to: 'HARD' }] },
  { number: 2, code: 'SAR', first: 'Logan', last: 'Sargeant', team: 'Williams', pace: 1.0151, startTyre: 'MEDIUM', plan: [{ stopLap: 30, to: 'HARD' }] }
]

const TOTAL_LAPS = 57
const BASE_LAP = 92.5 // reference leader lap time (s)
const PIT_LOSS = 21.5 // time lost in the pit lane (s)
const SC_START_LAP = 33
const SC_END_LAP = 36

const DEG_PER_LAP: Record<TyreCompound, number> = {
  SOFT: 0.075,
  MEDIUM: 0.045,
  HARD: 0.028,
  INTERMEDIATE: 0.05,
  WET: 0.06,
  UNKNOWN: 0.04
}

interface DriverSim {
  entry: GridEntry
  lapTimes: number[] // per-lap total time (index 0 = lap 1)
  cumEnd: number[] // cumulative time at completion of each lap
  compoundByLap: TyreCompound[] // compound in use on each lap (index 0 = lap 1)
  bestByLap: number[] // prefix minimum, avoids rescanning completed laps every tick
  stints: Stint[]
}

export class DemoProvider implements DataProvider {
  readonly capabilities: ProviderCapabilities = {
    id: 'demo',
    label: 'Demo Race',
    description:
      'Bundled synthetic Grand Prix. Fully offline, deterministic, and safe — ideal for exploring RaceDeck without a live session.',
    supportsHistorical: true,
    supportsLive: false,
    supportsReplay: true,
    requiresAuth: false,
    requiresSubscription: false,
    riskLevel: 'none',
    latencyClass: 'historical'
  }

  private sims: DriverSim[] = []
  private raceControl: RaceControlMessage[] = []
  private weather: WeatherSample[] = []
  private session: SessionInfo
  private duration = 0
  private startEpoch = Date.parse('2024-07-07T13:00:00Z')
  private driverCache: Driver[] = []
  private stintCache: Stint[] = []
  private lapCacheKey = ''
  private lapCache: LapSample[] = []

  constructor() {
    this.session = {
      id: 'demo-2024-gp',
      meetingId: 'demo-meeting',
      name: 'Race',
      type: 'race',
      meetingName: 'RaceDeck Demo Grand Prix',
      circuitName: 'Autódromo Virtuale',
      circuitShortName: 'Virtuale',
      countryName: 'Simland',
      countryCode: 'SIM',
      location: 'Sim City',
      dateStart: new Date(this.startEpoch).toISOString(),
      dateEnd: new Date(this.startEpoch + 2 * 3600 * 1000).toISOString(),
      gmtOffset: '+00:00:00',
      year: 2024,
      totalLaps: TOTAL_LAPS,
      provider: 'demo'
    }
    this.build()
  }

  async listSessions(): Promise<SessionInfo[]> {
    return [this.session]
  }

  async loadSession(): Promise<SessionInfo> {
    if (this.sims.length === 0) this.build()
    return this.session
  }

  getDuration(): number {
    return this.duration
  }

  // ── Simulation build ───────────────────────────────────────────────────────

  private build(): void {
    const rng = mulberry32(0xdec0de)
    this.sims = GRID.map((entry) => this.simulateDriver(entry, rng))
    this.driverCache = this.buildDrivers()
    this.stintCache = this.sims.flatMap((sim) => sim.stints)
    this.lapCacheKey = ''
    this.lapCache = []
    this.duration = Math.max(...this.sims.map((s) => s.cumEnd[TOTAL_LAPS - 1]))
    this.buildRaceControl()
    this.buildWeather(rng)
  }

  private simulateDriver(entry: GridEntry, rng: () => number): DriverSim {
    const lapTimes: number[] = []
    const compoundByLap: TyreCompound[] = []
    const stints: Stint[] = []

    let compound = entry.startTyre
    let stintStartLap = 1
    let stintNumber = 1
    let tyreAge = 0

    for (let lap = 1; lap <= TOTAL_LAPS; lap++) {
      // Handle scheduled pit stop at the START of this lap.
      const stop = entry.plan.find((p) => p.stopLap === lap)
      let pitThisLap = false
      if (stop) {
        stints.push({
          driverNumber: entry.number,
          stintNumber,
          lapStart: stintStartLap,
          lapEnd: lap - 1,
          tyre: { compound, ageAtStart: 0, isNew: true },
          degradationPerLap: DEG_PER_LAP[compound]
        })
        compound = stop.to
        stintStartLap = lap
        stintNumber += 1
        tyreAge = 0
        pitThisLap = true
      }

      const deg = DEG_PER_LAP[compound] * tyreAge
      const fuelEffect = 0.02 * (TOTAL_LAPS - lap) // lighter car → faster later
      const noise = (rng() - 0.5) * 0.35
      const opening = lap <= 1 ? 3.2 : 0 // slow first lap
      let lapTime = BASE_LAP * entry.pace + deg - fuelEffect + noise + opening
      if (pitThisLap) lapTime += PIT_LOSS

      // Safety car neutralization → everyone circulates slowly & bunched.
      if (lap >= SC_START_LAP && lap <= SC_END_LAP) {
        lapTime = BASE_LAP * 1.38 + (rng() - 0.5) * 0.2
      }

      lapTimes.push(lapTime)
      compoundByLap.push(compound)
      tyreAge += 1
    }

    // close the final stint
    stints.push({
      driverNumber: entry.number,
      stintNumber,
      lapStart: stintStartLap,
      lapEnd: TOTAL_LAPS,
      tyre: { compound, ageAtStart: 0, isNew: true },
      degradationPerLap: DEG_PER_LAP[compound]
    })

    const cumEnd: number[] = []
    let acc = 0
    for (const t of lapTimes) {
      acc += t
      cumEnd.push(acc)
    }

    const bestByLap: number[] = []
    let best = Number.POSITIVE_INFINITY
    for (const lapTime of lapTimes) {
      best = Math.min(best, lapTime)
      bestByLap.push(best)
    }

    return { entry, lapTimes, cumEnd, compoundByLap, bestByLap, stints }
  }

  private buildRaceControl(): void {
    const at = (lap: number) => new Date(this.startEpoch + this.timeAtLeaderLap(lap) * 1000).toISOString()
    const msgs: Omit<RaceControlMessage, 'id'>[] = [
      { date: at(0), category: 'Flag', message: 'GREEN LIGHT - PIT EXIT OPEN', flag: 'GREEN', scope: 'Track', sector: null, driverNumber: null, lapNumber: 1, severity: 'notice' },
      { date: at(1), category: 'Overtake', message: 'OVERTAKE MODE ENABLED', flag: 'NONE', scope: 'Track', sector: null, driverNumber: null, lapNumber: 3, severity: 'info' },
      { date: at(12), category: 'CarEvent', message: 'CAR 20 (MAG) TIME 5S PENALTY - TRACK LIMITS', flag: 'NONE', scope: 'Driver', sector: null, driverNumber: 20, lapNumber: 12, severity: 'warning' },
      { date: at(SC_START_LAP - 0.4), category: 'Flag', message: 'YELLOW IN SECTOR 2', flag: 'YELLOW', scope: 'Sector', sector: 2, driverNumber: null, lapNumber: SC_START_LAP, severity: 'warning' },
      { date: at(SC_START_LAP - 0.2), category: 'SafetyCar', message: 'SAFETY CAR DEPLOYED', flag: 'NONE', scope: 'Track', sector: null, driverNumber: null, lapNumber: SC_START_LAP, severity: 'critical' },
      { date: at(SC_END_LAP - 0.6), category: 'SafetyCar', message: 'SAFETY CAR IN THIS LAP', flag: 'NONE', scope: 'Track', sector: null, driverNumber: null, lapNumber: SC_END_LAP, severity: 'notice' },
      { date: at(SC_END_LAP), category: 'Flag', message: 'GREEN - TRACK CLEAR', flag: 'GREEN', scope: 'Track', sector: null, driverNumber: null, lapNumber: SC_END_LAP, severity: 'notice' },
      { date: at(SC_END_LAP + 0.05), category: 'Overtake', message: 'OVERTAKE MODE ENABLED', flag: 'NONE', scope: 'Track', sector: null, driverNumber: null, lapNumber: SC_END_LAP + 1, severity: 'info' },
      { date: at(48), category: 'CarEvent', message: 'CAR 11 (PER) UNDER INVESTIGATION - FORCING ANOTHER DRIVER OFF TRACK', flag: 'NONE', scope: 'Driver', sector: null, driverNumber: 11, lapNumber: 48, severity: 'warning' }
    ]
    this.raceControl = msgs.map((m, i) => ({ ...m, id: `rc-${i}` }))
  }

  private buildWeather(rng: () => number): void {
    const samples: WeatherSample[] = []
    for (let i = 0; i <= Math.ceil(this.duration / 300); i++) {
      const tSec = i * 300
      samples.push({
        date: new Date(this.startEpoch + tSec * 1000).toISOString(),
        airTemp: 26 + Math.sin(i / 3) * 1.5 + (rng() - 0.5) * 0.4,
        trackTemp: 41 + Math.sin(i / 3) * 3 + (rng() - 0.5) * 0.8,
        humidity: 48 + Math.cos(i / 4) * 6,
        pressure: 1012 + (rng() - 0.5),
        windSpeed: 2.4 + rng() * 1.5,
        windDirection: 210 + Math.round((rng() - 0.5) * 30),
        rainfall: false
      })
    }
    this.weather = samples
  }

  /** Approx time (s) when the leader reaches a given (possibly fractional) lap. */
  private timeAtLeaderLap(lap: number): number {
    if (lap <= 0) return 0
    // Use the fastest driver's cumulative curve as a leader proxy.
    const leader = this.sims.reduce((best, s) =>
      s.cumEnd[TOTAL_LAPS - 1] < best.cumEnd[TOTAL_LAPS - 1] ? s : best
    )
    const whole = Math.floor(lap)
    const frac = lap - whole
    const endPrev = whole === 0 ? 0 : leader.cumEnd[Math.min(whole, TOTAL_LAPS) - 1]
    if (frac === 0) return endPrev
    const nextLapTime = leader.lapTimes[Math.min(whole, TOTAL_LAPS - 1)]
    return endPrev + nextLapTime * frac
  }

  // ── Snapshot reconstruction ─────────────────────────────────────────────────

  getSnapshotAt(t: number): RaceSnapshot {
    const clock = clamp(t, 0, this.duration)
    const wall = this.startEpoch + clock * 1000

    type Prog = { sim: DriverSim; progress: number; completed: number; lapTime: number }
    const progs: Prog[] = this.sims.map((sim) => {
      let completed = 0
      while (completed < TOTAL_LAPS && sim.cumEnd[completed] <= clock) completed++
      const lapStart = completed === 0 ? 0 : sim.cumEnd[completed - 1]
      const idx = Math.min(completed, TOTAL_LAPS - 1)
      const lapTime = sim.lapTimes[idx]
      const fraction = completed >= TOTAL_LAPS ? 0 : clamp((clock - lapStart) / lapTime, 0, 1)
      const progress = completed >= TOTAL_LAPS ? TOTAL_LAPS : completed + fraction
      return { sim, progress, completed, lapTime }
    })

    const order = [...progs].sort((a, b) => b.progress - a.progress)
    const leader = order[0]
    const currentLap = Math.min(TOTAL_LAPS, (leader?.completed ?? 0) + 1)
    const isSC = currentLap >= SC_START_LAP && currentLap <= SC_END_LAP

    const gapById = new Map<number, number>()
    for (const p of order) {
      const avgPace = p.lapTime || BASE_LAP
      const gap = (leader.progress - p.progress) * avgPace
      gapById.set(p.sim.entry.number, Math.max(0, gap))
    }
    const fastestDriver = this.globalFastest(order).number

    const timing: TimingEntry[] = order.map((p, i) => {
      const num = p.sim.entry.number
      const completedLaps = p.completed
      const lastLap = completedLaps >= 1 ? p.sim.lapTimes[completedLaps - 1] : null
      const bestLap = completedLaps >= 1 ? p.sim.bestByLap[completedLaps - 1] : null
      const gap = gapById.get(num) ?? 0
      const ahead = i === 0 ? null : gapById.get(order[i - 1].sim.entry.number) ?? 0
      const interval = i === 0 ? null : Math.max(0, gap - (ahead ?? 0))
      const lapForCompound = Math.min(TOTAL_LAPS, completedLaps + 1)
      const compound = p.sim.compoundByLap[lapForCompound - 1] ?? null
      const stint = p.sim.stints.find(
        (s) => lapForCompound >= s.lapStart && lapForCompound <= (s.lapEnd ?? TOTAL_LAPS)
      )
      // Demo stints always start on new tyres, so set age and stint laps coincide.
      const stintAge = stint ? lapForCompound - stint.lapStart : null
      const pitStops = p.sim.stints.filter((s) => (s.lapEnd ?? TOTAL_LAPS) < lapForCompound).length
      const inPit =
        !!p.sim.entry.plan.find((pl) => pl.stopLap === lapForCompound) &&
        (p.progress - completedLaps) < 0.06

      const status: DriverStatus =
        p.progress >= TOTAL_LAPS ? 'FINISHED' : inPit ? 'IN_PIT' : 'RUNNING'

      const isFastest = fastestDriver === num && bestLap != null

      const sectorState = (s: number): SectorState => {
        if (isSC) return 'none'
        // Purely presentational demo highlight (deterministic, not faked timing).
        return (completedLaps + s) % 11 === 0 ? 'session-best' : (completedLaps + s) % 5 === 0 ? 'personal-best' : 'none'
      }
      const sectorTime = (fracOfLap: number): number | null => {
        if (lastLap == null) return null
        return lastLap * fracOfLap + (fracOfLap - 0.33) * 1.5
      }

      // ── 2026 battery model (synthetic but plausible): battery charges under
      // braking, depletes on deployment, uses Boost on straights, and exposes
      // Overtake only when the car is inside the one-second eligibility window. ──
      const lapFrac = p.progress - Math.floor(p.progress)
      const phase = ((num % 7) / 7) * Math.PI * 2
      // Base state-of-charge oscillates around the lap (harvest ↔ deploy).
      let energyPct: number | null = clamp(
        58 + 34 * Math.sin(lapFrac * Math.PI * 2 + phase),
        6,
        100
      )
      const attacking = interval != null && interval <= 1.0
      let deployMode: 'HARVEST' | 'BALANCED' | 'DEPLOY' | 'BOOST' | 'OVERTAKE'
      const cosSlope = Math.cos(lapFrac * Math.PI * 2 + phase)
      if (attacking && (energyPct ?? 0) > 12) {
        deployMode = 'OVERTAKE'
        energyPct = clamp(energyPct - 14, 4, 100) // Overtake Mode drains the pack faster
      } else if (cosSlope < -0.35) deployMode = 'HARVEST'
      else if (cosSlope > 0.7) deployMode = 'BOOST'
      else if (cosSlope > 0.35) deployMode = 'DEPLOY'
      else deployMode = 'BALANCED'
      if (status !== 'RUNNING' && status !== 'IN_PIT') {
        energyPct = null
      }

      return {
        driverNumber: num,
        position: i + 1,
        gapToLeader: i === 0 ? 0 : gap >= p.lapTime * 1 && leader.progress - p.progress >= 1 ? '+1 LAP' : gap,
        intervalAhead: interval == null ? null : interval,
        lastLap,
        bestLap,
        lapNumber: Math.min(TOTAL_LAPS, completedLaps + (p.progress >= TOTAL_LAPS ? 0 : 1)),
        stintAge,
        lapsThisStint: stintAge,
        compound,
        sector1: { seconds: sectorTime(0.31), state: sectorState(1) },
        sector2: { seconds: sectorTime(0.4), state: sectorState(2) },
        sector3: { seconds: sectorTime(0.29), state: sectorState(3) },
        status,
        inPit,
        pitStops,
        isFastestLap: isFastest,
        isPersonalBestLap: lastLap != null && bestLap != null && Math.abs(lastLap - bestLap) < 0.01,
        penalty: num === 20 && currentLap >= 12 ? '5s' : null,
        underInvestigation: num === 11 && currentLap >= 48 && currentLap < 52,
        retired: false,
        energyPct: energyPct == null ? null : Math.round(energyPct),
        deployMode: energyPct == null ? null : deployMode
      }
    })

    const positions: PositionSample[] = order.map((p, i) => ({
      driverNumber: p.sim.entry.number,
      date: new Date(wall).toISOString(),
      x: null,
      y: null,
      z: null,
      position: i + 1,
      lapProgress: p.progress - Math.floor(p.progress)
    }))

    const raceControl = this.raceControl.filter((m) => Date.parse(m.date) <= wall)
    const weatherHistory = this.weather.filter((w) => Date.parse(w.date) <= wall)
    const weather = weatherHistory.length ? weatherHistory[weatherHistory.length - 1] : this.weather[0] ?? null

    const trackStatus: TrackStatus = isSC ? 'SAFETY_CAR' : 'CLEAR'

    return {
      session: this.session,
      drivers: this.driverCache,
      timing,
      laps: this.allLapsUpTo(progs),
      stints: this.stintCache,
      raceControl,
      weather,
      weatherHistory,
      positions,
      availability: {
        timing: true,
        laps: true,
        stints: true,
        intervals: true,
        raceControl: true,
        weather: true,
        positions: false,
        positionProgress: true,
        telemetry: true,
        live: false
      },
      clock,
      currentLap,
      totalLaps: TOTAL_LAPS,
      trackStatus
    }
  }

  private globalFastest(
    order: { sim: DriverSim; completed: number }[]
  ): { number: number; time: number } {
    let best = { number: order[0]?.sim.entry.number ?? 0, time: Infinity }
    for (const p of order) {
      const time = p.completed >= 1 ? p.sim.bestByLap[p.completed - 1] : Number.POSITIVE_INFINITY
      if (time < best.time) best = { number: p.sim.entry.number, time }
    }
    return best
  }

  private allLapsUpTo(progs: { sim: DriverSim; completed: number }[]): LapSample[] {
    const cacheKey = progs.map((progress) => progress.completed).join(',')
    if (cacheKey === this.lapCacheKey) return this.lapCache
    const out: LapSample[] = []
    for (const p of progs) {
      for (let lap = 1; lap <= p.completed; lap++) {
        out.push(this.lapSample(p.sim, lap))
      }
    }
    this.lapCacheKey = cacheKey
    this.lapCache = out
    return this.lapCache
  }

  private lapSample(sim: DriverSim, lap: number): LapSample {
    const lt = sim.lapTimes[lap - 1]
    const compound = sim.compoundByLap[lap - 1]
    const isPitIn = !!sim.entry.plan.find((p) => p.stopLap === lap + 1)
    const isPitOut = !!sim.entry.plan.find((p) => p.stopLap === lap)
    return {
      driverNumber: sim.entry.number,
      lapNumber: lap,
      lapTime: lt,
      sector1: lt * 0.31,
      sector2: lt * 0.4,
      sector3: lt * 0.29,
      speedI1: 302 + Math.round((sim.entry.pace - 1) * -400),
      speedI2: 285 + Math.round((sim.entry.pace - 1) * -350),
      speedST: 328 + Math.round((sim.entry.pace - 1) * -500),
      isPitOutLap: isPitOut,
      isPitInLap: isPitIn,
      compound,
      dateStart: new Date(this.startEpoch + (lap === 1 ? 0 : sim.cumEnd[lap - 2]) * 1000).toISOString(),
      sessionTime: sim.cumEnd[lap - 1]
    }
  }

  getDriverLaps(driverNumber: number): LapSample[] {
    const sim = this.sims.find((s) => s.entry.number === driverNumber)
    if (!sim) return []
    return sim.lapTimes.map((_, i) => this.lapSample(sim, i + 1))
  }

  getTimeline(): SessionTimeline {
    // Synthesize the two series from the deterministic sim: green from lights
    // out, a safety-car window mid-race, no pre/post padding.
    const trackStatus: { t: number; status: TrackStatus }[] = [
      { t: 0, status: 'CLEAR' },
      { t: this.timeAtLeaderLap(SC_START_LAP - 1), status: 'SAFETY_CAR' },
      { t: this.timeAtLeaderLap(SC_END_LAP), status: 'CLEAR' }
    ]
    const lapCount: { t: number; current: number | null; total: number | null }[] = []
    for (let lap = 1; lap <= TOTAL_LAPS; lap++) {
      lapCount.push({ t: this.timeAtLeaderLap(lap - 1), current: lap, total: TOTAL_LAPS })
    }
    return buildTimeline({ duration: this.duration, type: 'race', trackStatus, lapCount })
  }

  getTelemetry(driverNumber: number, t: number, windowSec = 8): TelemetrySample[] {
    const sim = this.sims.find((s) => s.entry.number === driverNumber)
    if (!sim) return []
    const samples: TelemetrySample[] = []
    const n = 60
    for (let i = 0; i < n; i++) {
      const phase = (i / n) * Math.PI * 2
      const speed = 210 + Math.sin(phase) * 90 + Math.sin(phase * 3) * 20
      const throttle = clamp(60 + Math.sin(phase + 0.5) * 45, 0, 100)
      const brake = throttle < 25 ? clamp(70 - throttle, 0, 100) : 0
      const gear = clamp(Math.round(2 + (speed / 320) * 6), 1, 8)
      const drs = Math.sin(phase) > 0.6 ? 12 : 0
      samples.push({
        driverNumber,
        date: new Date(this.startEpoch + (t - windowSec + (i / n) * windowSec) * 1000).toISOString(),
        speed: Math.round(speed),
        throttle: Math.round(throttle),
        brake: Math.round(brake),
        gear,
        rpm: 9000 + Math.round((speed / 320) * 3000),
        drs,
        drsActive: drs >= 10,
        aeroMode: ch45ToAeroMode(drs)
      })
    }
    return samples
  }

  private buildDrivers(): Driver[] {
    return GRID.map((g) => ({
      number: g.number,
      code: g.code,
      firstName: g.first,
      lastName: g.last,
      fullName: `${g.first} ${g.last}`,
      broadcastName: `${g.first[0]} ${g.last.toUpperCase()}`,
      teamName: g.team,
      teamColour: teamColorFor(g.team),
      headshotUrl: null,
      countryCode: null
    }))
  }
}
