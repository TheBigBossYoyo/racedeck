import type { RaceControlMessage } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'

/**
 * AlertEngine — edge-triggered alerting. It diffs consecutive snapshots so each
 * event fires once (on transition), never continuously. Rules are configurable
 * and can be scoped to favorite drivers.
 */

export type AlertType =
  | 'yellow-flag'
  | 'safety-car'
  | 'vsc'
  | 'red-flag'
  | 'green-flag'
  | 'pit-stop'
  | 'fastest-lap'
  | 'favorite-event'
  | 'weather'
  | 'interval-change'
  | 'penalty'
  | 'investigation'
  | 'quali-elimination'

export interface AlertConfig {
  yellowFlag: boolean
  safetyCar: boolean
  redFlag: boolean
  pitStop: boolean
  fastestLap: boolean
  favoriteEvent: boolean
  weather: boolean
  intervalChange: boolean
  penalty: boolean
  qualiElimination: boolean
  favorites: number[]
  intervalThresholdSec: number
}

export interface AlertEvent {
  id: string
  type: AlertType
  title: string
  detail: string
  severity: 'info' | 'notice' | 'warning' | 'critical'
  driverNumbers: number[]
  at: string
  seenAt: number
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  yellowFlag: true,
  safetyCar: true,
  redFlag: true,
  pitStop: true,
  fastestLap: true,
  favoriteEvent: true,
  weather: true,
  intervalChange: true,
  penalty: true,
  qualiElimination: true,
  favorites: [],
  intervalThresholdSec: 3
}

export class AlertEngine {
  private config: AlertConfig
  private prev: RaceSnapshot | null = null
  private seenRc = new Set<string>()
  private rainingBefore = false
  private pitBefore = new Map<number, boolean>()
  private eliminationWarned = new Set<number>()

  constructor(config: Partial<AlertConfig> = {}) {
    this.config = { ...DEFAULT_ALERT_CONFIG, ...config }
  }

  setConfig(config: Partial<AlertConfig>): void {
    this.config = { ...this.config, ...config }
  }

  getConfig(): AlertConfig {
    return { ...this.config }
  }

  reset(): void {
    this.prev = null
    this.seenRc.clear()
    this.rainingBefore = false
    this.pitBefore.clear()
    this.eliminationWarned.clear()
  }

  /** Feed the latest snapshot; returns any newly triggered alerts. */
  ingest(next: RaceSnapshot): AlertEvent[] {
    const events: AlertEvent[] = []
    const now = Date.now()
    const code = (n: number) =>
      next.drivers.find((d) => d.number === n)?.code ?? `#${n}`
    const fav = (n: number) => this.config.favorites.includes(n)

    // ── New race-control messages (edge via id set) ──
    for (const rc of next.raceControl) {
      if (this.seenRc.has(rc.id)) continue
      this.seenRc.add(rc.id)
      // Skip backfilled messages before we had any prev (avoid dumping history).
      if (this.prev === null) continue
      const mapped = this.mapRaceControl(rc, now, code)
      if (mapped) events.push(mapped)
    }

    // ── Weather / rain edge ──
    if (this.config.weather && next.weather) {
      if (next.weather.rainfall && !this.rainingBefore) {
        events.push(
          this.make('weather', 'Rain detected', 'Rainfall on track — expect crossover to intermediates soon.', 'warning', [], next.weather.date, now)
        )
      }
      this.rainingBefore = next.weather.rainfall
    }

    // ── Pit stops (favorites) ──
    if (this.config.pitStop) {
      for (const t of next.timing) {
        const was = this.pitBefore.get(t.driverNumber) ?? false
        if (t.inPit && !was && (this.config.favorites.length === 0 ? false : fav(t.driverNumber))) {
          events.push(
            this.make('pit-stop', `${code(t.driverNumber)} pits`, `${code(t.driverNumber)} entered the pit lane (lap ${t.lapNumber ?? '—'}).`, 'notice', [t.driverNumber], next.session.dateStart ?? new Date(now).toISOString(), now)
          )
        }
        this.pitBefore.set(t.driverNumber, t.inPit)
      }
    }

    // ── Major interval change (favorites) ──
    if (this.config.intervalChange && this.prev) {
      for (const t of next.timing) {
        if (!fav(t.driverNumber)) continue
        const before = this.prev.timing.find((p) => p.driverNumber === t.driverNumber)
        const g0 = typeof before?.gapToLeader === 'number' ? before?.gapToLeader : null
        const g1 = typeof t.gapToLeader === 'number' ? t.gapToLeader : null
        if (g0 != null && g1 != null && Math.abs(g1 - g0) >= this.config.intervalThresholdSec) {
          const dir = g1 > g0 ? 'lost' : 'gained'
          events.push(
            this.make('interval-change', `${code(t.driverNumber)} ${dir} ${Math.abs(g1 - g0).toFixed(1)}s`, `Gap to leader moved from +${g0.toFixed(1)}s to +${g1.toFixed(1)}s.`, 'info', [t.driverNumber], new Date(now).toISOString(), now)
          )
        }
      }
    }

    // ── Qualifying elimination risk (favorites) ──
    if (this.config.qualiElimination && next.session.type.includes('qualifying')) {
      const dropZoneFrom = 16
      for (const t of next.timing) {
        if (!fav(t.driverNumber)) continue
        if ((t.position ?? 0) >= dropZoneFrom && !this.eliminationWarned.has(t.driverNumber)) {
          this.eliminationWarned.add(t.driverNumber)
          events.push(
            this.make('quali-elimination', `${code(t.driverNumber)} in the drop zone`, `Currently P${t.position} — elimination risk. Needs a lap.`, 'warning', [t.driverNumber], new Date(now).toISOString(), now)
          )
        }
        if ((t.position ?? 99) < dropZoneFrom) this.eliminationWarned.delete(t.driverNumber)
      }
    }

    this.prev = next
    return events
  }

  private mapRaceControl(
    rc: RaceControlMessage,
    now: number,
    code: (n: number) => string
  ): AlertEvent | null {
    const m = rc.message.toLowerCase()
    const withFav = rc.driverNumber != null && this.config.favorites.includes(rc.driverNumber)
    const push = (type: AlertType, title: string, sev: AlertEvent['severity']) =>
      this.make(type, title, rc.message, sev, rc.driverNumber != null ? [rc.driverNumber] : [], rc.date, now)

    if ((m.includes('red flag') || rc.flag === 'RED') && this.config.redFlag) {
      return push('red-flag', 'RED FLAG', 'critical')
    }
    if (m.includes('safety car') && !m.includes('virtual') && this.config.safetyCar) {
      return push('safety-car', m.includes('in this lap') ? 'Safety Car coming in' : 'SAFETY CAR', 'critical')
    }
    if ((m.includes('virtual safety car') || m.includes('vsc')) && this.config.safetyCar) {
      return push('vsc', 'Virtual Safety Car', 'warning')
    }
    if ((rc.flag === 'YELLOW' || rc.flag === 'DOUBLE_YELLOW') && this.config.yellowFlag) {
      return push('yellow-flag', rc.sector ? `Yellow — Sector ${rc.sector}` : 'Yellow flag', 'warning')
    }
    if (m.includes('penalty') && this.config.penalty) {
      return push('penalty', withFav ? `Penalty: ${code(rc.driverNumber!)}` : 'Penalty issued', 'warning')
    }
    if (m.includes('investigation') && this.config.penalty) {
      return push('investigation', withFav ? `Investigation: ${code(rc.driverNumber!)}` : 'Under investigation', 'warning')
    }
    if (m.includes('fastest lap') && this.config.fastestLap) {
      return push('fastest-lap', 'Fastest lap', 'notice')
    }
    if (rc.flag === 'GREEN' && this.config.yellowFlag) {
      return push('green-flag', 'Track clear', 'notice')
    }
    if (withFav && this.config.favoriteEvent) {
      return push('favorite-event', `${code(rc.driverNumber!)} event`, 'info')
    }
    return null
  }

  private make(
    type: AlertType,
    title: string,
    detail: string,
    severity: AlertEvent['severity'],
    driverNumbers: number[],
    at: string,
    now: number
  ): AlertEvent {
    return {
      id: `${type}-${at}-${driverNumbers.join('_')}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      title,
      detail,
      severity,
      driverNumbers,
      at,
      seenAt: now
    }
  }
}
