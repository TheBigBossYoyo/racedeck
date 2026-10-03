import { useMemo } from 'react'
import { ArrowRight, Wrench } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Badge, EmptyState, TeamStripe, TyrePill } from '@renderer/components/ui/primitives'
import { buildPitEventLog, type PitLogEntry } from '@renderer/core/engines/PitEventLog'
import { pickDriver } from '@renderer/lib/useFocusDriver'
import { useSessionStore } from '@renderer/store/sessionStore'
import type { Driver } from '@shared/models'

/**
 * PitEventLogPanel — field-wide pit-stop log, newest first, only as far as the
 * playback clock has reached (IMPROVEMENT_OPPORTUNITIES.md #13). Every cell the
 * feed did not report reads "—": a lap, a compound or a pit-lane time is never
 * filled with a plausible default.
 */

function LapCell({ entry }: { entry: PitLogEntry }) {
  if (entry.lapIn == null) return <span className="text-fg-subtle">L—</span>
  return (
    <span className="tnum inline-flex items-center gap-0.5 text-fg-muted">
      L{entry.lapIn}
      <ArrowRight className="h-2.5 w-2.5 text-fg-subtle" aria-hidden="true" />
      {entry.lapOut != null ? `L${entry.lapOut}` : '—'}
    </span>
  )
}

function DurationCell({ seconds }: { seconds: number | null }) {
  if (seconds == null) {
    return (
      <span className="tnum text-fg-subtle" title="Pit-lane time not reported by this feed">
        —
      </span>
    )
  }
  return (
    <span className="tnum font-semibold text-fg" title="Measured pit-lane transit">
      {seconds.toFixed(1)}s
    </span>
  )
}

/**
 * Screen-reader name for a log row. The lap range, compounds and pit-lane time
 * are otherwise only visible cells the button's own label would hide; a field
 * the feed did not report is left out rather than read as a value.
 */
export function pitLogRowLabel(entry: PitLogEntry, code: string): string {
  return [
    code,
    entry.lapIn != null
      ? entry.lapOut != null
        ? `lap ${entry.lapIn} to lap ${entry.lapOut}`
        : `in on lap ${entry.lapIn}`
      : null,
    entry.compoundBefore != null && entry.compoundAfter != null
      ? `${entry.compoundBefore} to ${entry.compoundAfter} tyres`
      : null,
    entry.durationSec != null ? `${entry.durationSec.toFixed(1)} seconds in the pit lane` : null,
    entry.ongoing ? 'in the pits now' : null
  ]
    .filter((part): part is string => part != null)
    .join(', ')
}

function PitLogRow({ entry, driver }: { entry: PitLogEntry; driver: Driver | undefined }) {
  const code = driver?.code ?? `#${entry.driverNumber}`
  return (
    <li>
      <button
        type="button"
        onClick={() => pickDriver(entry.driverNumber)}
        aria-label={pitLogRowLabel(entry, code)}
        className="flex w-full items-stretch gap-2 rounded-md border border-hairline/15 bg-black/20 px-2 py-1 text-left text-[10px] hover:border-hairline/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <TeamStripe color={driver?.teamColour ?? null} />
        <span className="flex w-9 shrink-0 items-center text-xs font-semibold text-fg">{code}</span>
        <span className="flex w-16 shrink-0 items-center">
          <LapCell entry={entry} />
        </span>
        <span className="flex items-center gap-1">
          <TyrePill compound={entry.compoundBefore} size="sm" />
          <ArrowRight className="h-2.5 w-2.5 text-fg-subtle" aria-hidden="true" />
          <TyrePill compound={entry.compoundAfter} size="sm" />
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {entry.ongoing && <Badge tone="accent">In pit</Badge>}
          <DurationCell seconds={entry.durationSec} />
        </span>
      </button>
    </li>
  )
}

export function PitEventLogPanel() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const rows = useMemo(() => (snapshot ? buildPitEventLog(snapshot) : []), [snapshot])
  const drivers = useMemo(
    () => new Map((snapshot?.drivers ?? []).map((d) => [d.number, d])),
    [snapshot?.drivers]
  )

  const icon = <Wrench />
  if (!snapshot) {
    return (
      <WidgetFrame title="Pit Stop Log" icon={icon}>
        <EmptyState icon={icon} title="No session loaded" />
      </WidgetFrame>
    )
  }
  if (rows.length === 0) {
    return (
      <WidgetFrame title="Pit Stop Log" icon={icon}>
        <EmptyState
          icon={icon}
          title="No pit stops yet"
          hint="Stops appear here as the session clock passes them."
        />
      </WidgetFrame>
    )
  }

  return (
    <WidgetFrame
      title="Pit Stop Log"
      icon={icon}
      actions={
        <Badge tone="neutral">
          {rows.length} stop{rows.length === 1 ? '' : 's'}
        </Badge>
      }
    >
      <ol aria-label="Pit stops, newest first" className="space-y-1">
        {rows.map((entry) => (
          <PitLogRow key={entry.key} entry={entry} driver={drivers.get(entry.driverNumber)} />
        ))}
      </ol>
      <p className="mt-1.5 text-[10px] leading-snug text-fg-subtle">
        Time is measured pit-lane transit; — means this feed did not report it.
      </p>
    </WidgetFrame>
  )
}
