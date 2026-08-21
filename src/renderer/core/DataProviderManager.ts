import type { SessionInfo } from '@shared/models'
import type { DataProvider, ProviderCapabilities, RaceSnapshot, SessionTimeline } from './providers/types'
import { DemoProvider } from './providers/DemoProvider'
import { OpenF1Provider } from './providers/OpenF1Provider'
import { F1LiveProvider } from './providers/F1LiveProvider'

/**
 * DataProviderManager — the registry + active-provider switch.
 *
 * Ships with two safe providers: Demo (offline, bundled) and OpenF1 (historical
 * replay). A LIVE provider is intentionally NOT bundled — per the compliance
 * research, any live F1 TV-linked timing must be a user-connected concern. The
 * registry exposes capability flags so the UI can gate features and show risk.
 */
export class DataProviderManager {
  private providers = new Map<string, DataProvider>()
  private activeId: string
  private updateListener: (() => void) | null = null

  constructor() {
    const demo = new DemoProvider()
    const f1live = new F1LiveProvider()
    const openf1 = new OpenF1Provider()
    this.register(demo)
    this.register(f1live) // real F1 official data (featured real-data source)
    this.register(openf1)
    this.activeId = demo.capabilities.id // safe, offline default
  }

  register(provider: DataProvider): void {
    this.providers.set(provider.capabilities.id, provider)
    provider.onUpdate?.(() => {
      if (this.activeId === provider.capabilities.id) this.updateListener?.()
    })
  }

  get catalog(): ProviderCapabilities[] {
    return [...this.providers.values()].map((p) => p.capabilities)
  }

  get activeProviderId(): string {
    return this.activeId
  }

  get active(): DataProvider {
    const p = this.providers.get(this.activeId)
    if (!p) throw new Error(`No active provider: ${this.activeId}`)
    return p
  }

  setActive(id: string): ProviderCapabilities {
    if (!this.providers.has(id)) throw new Error(`Unknown provider: ${id}`)
    this.active.cancelPendingLoads?.()
    this.activeId = id
    return this.active.capabilities
  }

  listSessions(): Promise<SessionInfo[]> {
    return this.active.listSessions()
  }

  loadSession(sessionId: string): Promise<SessionInfo> {
    return this.active.loadSession(sessionId)
  }

  getSnapshotAt(t: number): RaceSnapshot {
    return this.active.getSnapshotAt(t)
  }

  getDuration(): number {
    return this.active.getDuration()
  }

  getInitialClock(): number {
    return this.active.getInitialClock?.() ?? 0
  }

  getTimeline(): SessionTimeline | null {
    return this.active.getTimeline?.() ?? null
  }

  setUpdateListener(listener: () => void): void {
    this.updateListener = listener
  }

  getDriverLaps(driverNumber: number) {
    return this.active.getDriverLaps?.(driverNumber) ?? []
  }

  getTelemetry(driverNumber: number, t: number, windowSec?: number) {
    return this.active.getTelemetry?.(driverNumber, t, windowSec) ?? []
  }
}
