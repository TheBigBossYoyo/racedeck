import { Timer } from 'lucide-react'
import { Badge } from '@renderer/components/ui/primitives'
import type { PitStopRecord } from '@renderer/core/engines/PitHistory'
import { cn } from '@renderer/lib/utils'

function PositionChange({ before, after }: { before: number | null; after: number | null }) {
  if (before == null || after == null) return <span className="text-fg-subtle">—</span>
  const delta = before - after
  if (delta === 0)
    return (
      <span className="tnum text-fg-muted">
        P{before} → P{after}
      </span>
    )
  return (
    <span className={cn('tnum', delta > 0 ? 'text-good' : 'text-warn')}>
      P{before} → P{after}
    </span>
  )
}

/** One driver's pit-stop history (APP_IMPROVEMENT_ROADMAP.md P2 item 24). */
export function PitHistoryPanel({ stops }: { readonly stops: readonly PitStopRecord[] }) {
  if (stops.length === 0) return null
  return (
    <div className="rounded-lg border border-hairline/25 bg-white/[0.02] p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-muted">
        <Timer className="h-3.5 w-3.5" /> Pit History
      </div>
      <div className="space-y-1">
        {stops.map((stop, i) => (
          <div
            key={`${stop.lap ?? i}-${stop.driverNumber}`}
            className="flex items-center gap-2 rounded-md border border-hairline/15 bg-black/20 px-2 py-1 text-[10px]"
          >
            <span className="tnum w-10 shrink-0 text-fg-subtle">L{stop.lap ?? '—'}</span>
            <span className="tnum w-14 shrink-0 font-semibold text-fg">
              {stop.durationSec.toFixed(1)}s
            </span>
            <span
              className={cn(
                'tnum w-14 shrink-0',
                stop.deltaVsMedianSec == null
                  ? 'text-fg-subtle'
                  : stop.deltaVsMedianSec > 0
                    ? 'text-warn'
                    : 'text-good'
              )}
            >
              {stop.deltaVsMedianSec != null
                ? `${stop.deltaVsMedianSec > 0 ? '+' : ''}${stop.deltaVsMedianSec.toFixed(1)}s`
                : '—'}
            </span>
            <PositionChange before={stop.positionBefore} after={stop.positionAfter} />
            <span className="ml-auto flex items-center gap-1">
              {stop.underNeutralization && (
                <span title="A Safety Car/VSC message landed shortly before this stop">
                  <Badge tone="accent">SC/VSC</Badge>
                </span>
              )}
              {stop.servedPenalty && (
                <span title="A penalty/served message for this driver landed near this stop">
                  <Badge tone="warn">penalty</Badge>
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10px] leading-snug text-fg-subtle">
        Duration is measured pit-lane transit. SC/VSC and penalty tags are inferred from nearby
        race-control messages, not directly measured.
      </p>
    </div>
  )
}
