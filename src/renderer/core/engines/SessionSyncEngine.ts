import { SYNC_MAX_OFFSET, SYNC_MIN_OFFSET } from '@shared/constants'
import type { RaceControlMessage, SyncState } from '@shared/models'

/**
 * Sync math — pure, deterministic, unit-tested.
 *
 * Model: the TOD broadcast is delayed behind the live data by `offset` seconds.
 * To align the dashboard with what the user SEES on the video, the app renders
 * the data snapshot at `dataTime = videoLiveTime - offset`.
 *
 * The sync wizard directly seeks the dashboard to a selected event. Fine tuning
 * then adjusts this offset without attempting to derive a video position.
 */
export const syncMath = {
  clampOffset(value: number): number {
    return Math.min(SYNC_MAX_OFFSET, Math.max(SYNC_MIN_OFFSET, value))
  },

  /** Nudge the current offset by a delta, clamped to the valid range. */
  adjust(current: number, delta: number): number {
    return this.clampOffset(current + delta)
  },

  /** The bounded data-clock time that lines up with the delayed video. */
  dataTimeForVideo(videoLiveSec: number, offset: number, duration = Number.POSITIVE_INFINITY): number {
    return Math.min(Math.max(0, duration), Math.max(0, videoLiveSec - offset))
  },

  /** Inverse: which video position corresponds to a given data-clock time. */
  videoTimeForData(dataSec: number, offset: number): number {
    return dataSec + offset
  },

  /**
   * Broadcast delay implied by a live alignment: the user marks an event they
   * SEE on the (delayed) video while the data has already advanced to
   * `liveEdgeSec`. The gap between the two is exactly the offset that holds the
   * dashboard back to match the video — no seeking, so the view stays pinned to
   * the live edge. Clamped to the valid range.
   */
  offsetForLiveAlignment(liveEdgeSec: number, eventDataSec: number): number {
    return this.clampOffset(liveEdgeSec - eventDataSec)
  },

  /** Data-time bounds reachable while the video clock remains inside the session. */
  dataRangeForVideoSession(duration: number, offset: number): { min: number; max: number } {
    const boundedDuration = Math.max(0, duration)
    return {
      min: this.dataTimeForVideo(0, offset, boundedDuration),
      max: this.dataTimeForVideo(boundedDuration, offset, boundedDuration)
    }
  }
} as const

export interface SyncCandidate {
  id: string
  label: string
  /** Data-clock time (seconds since session start) of this event. */
  dataSec: number
  /** Distance (s) from the current dashboard position — lower = more likely. */
  distance: number
  category: string
}

export function candidatesForDisplay(
  candidates: SyncCandidate[],
  showAll: boolean,
  previewLimit = 12
): SyncCandidate[] {
  return showAll ? candidates : candidates.slice(0, previewLimit)
}

/** Event types the wizard can match against race-control history. */
export type SyncEventType =
  | 'race-start'
  | 'safety-car'
  | 'vsc'
  | 'yellow-flag'
  | 'red-flag'
  | 'pit'
  | 'fastest-lap'
  | 'lap-change'
  | 'race-control'

function matchesEventType(msg: RaceControlMessage, type: SyncEventType): boolean {
  const m = msg.message.toLowerCase()
  switch (type) {
    case 'race-start':
      return msg.flag === 'GREEN' && (msg.lapNumber ?? 0) <= 1
    case 'safety-car':
      return m.includes('safety car') && !m.includes('virtual')
    case 'vsc':
      return m.includes('virtual safety car') || m.includes('vsc')
    case 'yellow-flag':
      return msg.flag === 'YELLOW' || msg.flag === 'DOUBLE_YELLOW'
    case 'red-flag':
      return msg.flag === 'RED' || m.includes('red flag')
    case 'pit':
      return m.includes('pit')
    case 'fastest-lap':
      return m.includes('fastest lap')
    case 'race-control':
      return true
    case 'lap-change':
      return false
    default:
      return true
  }
}

/**
 * SessionSyncEngine — holds the active SyncState and produces wizard candidates.
 * Persistence is handled by the sync store; this class is the logic core.
 */
export class SessionSyncEngine {
  private state: SyncState

  constructor(initial?: Partial<SyncState>) {
    this.state = {
      offsetSeconds: 0,
      broadcaster: 'TOD',
      scopeKey: null,
      updatedAt: new Date().toISOString(),
      calibrating: false,
      ...initial
    }
  }

  getState(): SyncState {
    return { ...this.state }
  }

  setOffset(seconds: number): SyncState {
    this.state = {
      ...this.state,
      offsetSeconds: syncMath.clampOffset(seconds),
      updatedAt: new Date().toISOString()
    }
    return this.getState()
  }

  nudge(delta: number): SyncState {
    return this.setOffset(syncMath.adjust(this.state.offsetSeconds, delta))
  }

  setBroadcaster(broadcaster: string): SyncState {
    this.state = { ...this.state, broadcaster, updatedAt: new Date().toISOString() }
    return this.getState()
  }

  setScopeKey(scopeKey: string | null): SyncState {
    this.state = { ...this.state, scopeKey, updatedAt: new Date().toISOString() }
    return this.getState()
  }

  setCalibrating(calibrating: boolean): SyncState {
    this.state = { ...this.state, calibrating }
    return this.getState()
  }

  /**
   * Build ranked candidates from race-control history for a marked event.
   * `markLiveSec` is the live data-clock time when the user pressed "mark".
   */
  buildCandidates(
    messages: RaceControlMessage[],
    markLiveSec: number,
    sessionStartMs: number,
    type: SyncEventType = 'race-control'
  ): SyncCandidate[] {
    const currentOffset = this.state.offsetSeconds
    return messages
      .filter((m) => matchesEventType(m, type))
      .map((m) => {
        const providerTime = m.sessionTime
        const parsedTime = Date.parse(m.date)
        const dataSec = typeof providerTime === 'number' && Number.isFinite(providerTime)
          ? Math.max(0, providerTime)
          : Number.isFinite(parsedTime) && Number.isFinite(sessionStartMs)
            ? Math.max(0, (parsedTime - sessionStartMs) / 1000)
            : null
        if (dataSec == null) return null
        const currentDataTime = syncMath.dataTimeForVideo(markLiveSec, currentOffset)
        return {
          id: m.id,
          label: m.message,
          dataSec,
          distance: Math.abs(dataSec - currentDataTime),
          category: m.category
        }
      })
      .filter((candidate): candidate is SyncCandidate => candidate != null)
      .sort((a, b) => a.distance - b.distance)
  }
}
