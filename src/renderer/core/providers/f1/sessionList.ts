import type { SessionInfo } from '@shared/models'
import { hasBridge, bridge } from '@renderer/lib/ipc'

/** The archive's session listing, mapped to `SessionInfo`. Moved from F1LiveProvider.ts. */
export async function listF1Sessions(): Promise<SessionInfo[]> {
  if (!hasBridge()) return []
  const year = new Date().getUTCFullYear()
  const years = [year, year - 1]
  const all: SessionInfo[] = []
  for (const y of years) {
    try {
      const list = await bridge().f1.listSessions(y)
      for (const s of list) {
        all.push({
          id: s.path,
          meetingId: String(s.key),
          name: s.name,
          type: mapType(s.type),
          meetingName: s.meetingName,
          circuitName: s.circuitShortName,
          circuitShortName: s.circuitShortName,
          countryName: s.countryName,
          countryCode: s.countryCode,
          location: s.location,
          dateStart: s.startDate,
          dateEnd: s.endDate,
          gmtOffset: s.gmtOffset,
          year: s.year,
          totalLaps: null,
          provider: 'f1live'
        })
      }
    } catch {
      /* skip a year that fails */
    }
    if (all.length > 0) break // latest season with data is enough
  }
  return all.sort((a, b) => Date.parse(b.dateStart ?? '') - Date.parse(a.dateStart ?? ''))
}

function mapType(type: string): SessionInfo['type'] {
  const s = type.toLowerCase()
  if (s.includes('sprint') && s.includes('qual')) return 'sprint-qualifying'
  if (s.includes('sprint')) return 'sprint'
  if (s.includes('qual')) return 'qualifying'
  if (s.includes('practice')) return 'practice'
  if (s.includes('race')) return 'race'
  return 'unknown'
}
