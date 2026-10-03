import type { RaceSnapshot } from '@renderer/core/model/snapshot'
import type { RaceBookmark } from '@renderer/core/engines/RaceBookmarks'
import type { UserAnnotation } from '@renderer/core/engines/UserAnnotations'
import { buildPitStopHistory, type PitStopRecord } from '@renderer/core/engines/PitHistory'
import { buildTyreRead } from '@renderer/core/engines/TyreRead'

/**
 * Race debrief export (APP_IMPROVEMENT_ROADMAP.md P2 item 27). A pure
 * structured builder plus a Markdown formatter — JSON export is just
 * `JSON.stringify(debrief)` on the same object. Every figure carries its
 * source/replay-timestamp: pit-lane durations are measured, tyre trends are a
 * fuel-corrected model estimate, SC/VSC and penalty tags are inferred from
 * nearby race-control text — never presented as more certain than they are.
 */

export interface DebriefDriverSummary {
  driverNumber: number
  code: string
  finalPosition: number | null
  pitStops: PitStopRecord[]
  /** e.g. "working (+0.08s/lap on current set)"; null without enough data. */
  tyreTrendHeadline: string | null
}

export interface Debrief {
  meetingName: string | null
  sessionName: string
  /** Data-clock seconds at which this debrief was generated. */
  generatedAtDataSec: number
  drivers: DebriefDriverSummary[]
  bookmarks: readonly RaceBookmark[]
  annotations: readonly UserAnnotation[]
  provenanceNote: string
}

function tyreTrendHeadlineFor(snapshot: RaceSnapshot, driverNumber: number): string | null {
  const entry = snapshot.timing.find((t) => t.driverNumber === driverNumber)
  if (!entry) return null
  const laps = snapshot.laps.filter((l) => l.driverNumber === driverNumber)
  const read = buildTyreRead(snapshot, entry, laps)
  if (read.degradationPerLap != null) {
    const sign = read.degradationPerLap >= 0 ? '+' : ''
    return `${read.condition ?? 'unknown'} (${sign}${read.degradationPerLap.toFixed(3)}s/lap on current set)`
  }
  if (read.degradationBlocker != null) return `not available (${read.degradationBlocker})`
  return null
}

/**
 * Build a structured debrief for the given (full-duration) snapshot and
 * bookmarks. `selectedDriverNumbers` defaults to every driver in the session.
 */
export function buildDebrief(
  snapshot: RaceSnapshot,
  bookmarks: readonly RaceBookmark[],
  selectedDriverNumbers?: readonly number[],
  annotations: readonly UserAnnotation[] = []
): Debrief {
  const targetNumbers =
    selectedDriverNumbers && selectedDriverNumbers.length > 0
      ? selectedDriverNumbers
      : snapshot.drivers.map((d) => d.number)
  const pitHistory = buildPitStopHistory(snapshot)

  const drivers: DebriefDriverSummary[] = targetNumbers
    .map((n): DebriefDriverSummary | null => {
      const meta = snapshot.drivers.find((d) => d.number === n)
      if (!meta) return null
      const entry = snapshot.timing.find((t) => t.driverNumber === n)
      return {
        driverNumber: n,
        code: meta.code,
        finalPosition: entry?.position ?? null,
        pitStops: pitHistory.filter((s) => s.driverNumber === n),
        tyreTrendHeadline: tyreTrendHeadlineFor(snapshot, n)
      }
    })
    .filter((d): d is DebriefDriverSummary => d != null)
    .sort((a, b) => (a.finalPosition ?? 999) - (b.finalPosition ?? 999))

  return {
    meetingName: snapshot.session.meetingName,
    sessionName: snapshot.session.name,
    generatedAtDataSec: snapshot.clock,
    drivers,
    bookmarks,
    annotations,
    provenanceNote:
      'Pit-lane durations are measured. SC/VSC and penalty tags are inferred from nearby ' +
      'race-control text, not directly measured. Tyre trends are a fuel-corrected model ' +
      'estimate, never a direct measurement.'
  }
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

/** Render a `Debrief` as Markdown. Pure formatting — no new computation. */
export function debriefToMarkdown(debrief: Debrief): string {
  const lines: string[] = []
  lines.push(`# Race Debrief — ${debrief.meetingName ?? 'Session'} (${debrief.sessionName})`)
  lines.push('')
  lines.push(`_Generated at ${formatClock(debrief.generatedAtDataSec)} (data-clock)._`)
  lines.push('')
  lines.push('## Drivers')
  for (const d of debrief.drivers) {
    lines.push('')
    lines.push(`### ${d.code} — P${d.finalPosition ?? '—'}`)
    if (d.tyreTrendHeadline) lines.push(`- Tyre trend: ${d.tyreTrendHeadline}`)
    if (d.pitStops.length > 0) {
      lines.push('- Pit stops:')
      for (const s of d.pitStops) {
        const tags = [
          s.underNeutralization ? 'SC/VSC' : null,
          s.servedPenalty ? 'penalty' : null
        ].filter(Boolean)
        const delta =
          s.deltaVsMedianSec != null
            ? ` (${s.deltaVsMedianSec >= 0 ? '+' : ''}${s.deltaVsMedianSec.toFixed(1)}s vs median)`
            : ''
        lines.push(
          `  - Lap ${s.lap ?? '—'}: ${s.durationSec.toFixed(1)}s${delta}${tags.length ? ` [${tags.join(', ')}]` : ''}`
        )
      }
    }
  }
  lines.push('')
  lines.push('## Timeline')
  for (const b of debrief.bookmarks) {
    lines.push(`- ${formatClock(b.t)} — ${b.label}`)
  }
  if (debrief.annotations.length > 0) {
    lines.push('')
    lines.push('## Notes')
    for (const a of debrief.annotations) {
      const code = debrief.drivers.find((d) => d.driverNumber === a.driverNumber)?.code
      const who = a.driverNumber != null ? ` [${code ?? `#${a.driverNumber}`}]` : ''
      const tag = a.tag ? ` (${a.tag})` : ''
      lines.push(`- ${formatClock(a.t)}${who}${tag} — ${a.text}`)
    }
  }
  lines.push('')
  lines.push('## Provenance')
  lines.push(debrief.provenanceNote)
  return lines.join('\n')
}
