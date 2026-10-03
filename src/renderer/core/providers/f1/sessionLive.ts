import type { F1SessionData } from '@shared/f1live'
import { isF1SessionLive } from '@shared/f1-session-state'

/** Whether the loaded session payload describes a session that is running now. */
export function isSessionDataLive(data: F1SessionData | null): boolean {
  if (!data) return false
  return isF1SessionLive({
    path: data.summary.path,
    archiveStatus: data.summary.archiveStatus,
    startDate: data.summary.startDate,
    endDate: data.summary.endDate,
    liveStreamActive: data.summary.liveStreamActive
  })
}
