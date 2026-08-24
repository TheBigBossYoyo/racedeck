import { useSessionStore } from '@renderer/store/sessionStore'
import { useSyncStore } from '@renderer/store/syncStore'
import { syncMath } from '@renderer/core/engines/SessionSyncEngine'

/**
 * Jump replay to a team-radio clip's broadcast moment (APP_IMPROVEMENT_ROADMAP.md
 * P2 item 23) — the same data-time→video-time conversion `TransportBar`'s
 * bookmark markers use, so the current sync offset is preserved rather than
 * reset (unlike `SessionSyncController`'s calibration-oriented `alignData`).
 */
export function seekToRadioClip(utc: string): void {
  const session = useSessionStore.getState()
  if (!session.snapshot?.session?.dateStart) return
  const startMs = Date.parse(session.snapshot.session.dateStart)
  const clipMs = Date.parse(utc)
  if (!Number.isFinite(startMs) || !Number.isFinite(clipMs)) return
  const dataTime = (clipMs - startMs) / 1000
  if (dataTime < 0) return
  const offset = useSyncStore.getState().sync.offsetSeconds
  const range = syncMath.dataRangeForVideoSession(session.duration, offset)
  const reachable = Math.min(range.max, Math.max(range.min, dataTime))
  session.seek(syncMath.videoTimeForData(reachable, offset))
}
