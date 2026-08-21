import { useMemo } from 'react'
import { Users } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Badge } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { teamPace } from '@renderer/core/engines/AnalyticsEngine'
import { formatLapTime, hexColor, cn } from '@renderer/lib/utils'

export function TeamPacePanel() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const setFocus = useSessionStore((s) => s.setFocusDriver)

  const rows = useMemo(() => (snapshot ? teamPace(snapshot) : []), [snapshot])

  if (!snapshot || rows.length === 0) {
    return (
      <WidgetFrame title="Team Pace" icon={<Users />} subtitle="estimate">
        <EmptyState
          icon={<Users />}
          title="Not enough clean laps yet"
          hint="Team pace ranks each team by its fastest car's representative clean-lap pace."
        />
      </WidgetFrame>
    )
  }

  // Scale bars by delta to the fastest team (cap at ~1.5s for a readable range).
  const maxDelta = Math.max(0.4, ...rows.map((r) => r.deltaToBest))

  return (
    <WidgetFrame title="Team Pace" icon={<Users />} subtitle="fastest car · clean laps" actions={<Badge tone="warn">est</Badge>}>
      <div className="space-y-1">
        {rows.map((r, i) => {
          const color = hexColor(r.color)
          const fillPct = 100 - (r.deltaToBest / maxDelta) * 78
          return (
            <div key={r.team} className="rounded-lg border border-hairline/15 bg-white/[0.015] px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="tnum w-4 text-center text-2xs font-bold text-fg-subtle">{i + 1}</span>
                <span className="h-3.5 w-[3px] rounded-full" style={{ backgroundColor: color }} />
                <span className="truncate text-xs font-semibold text-fg">{r.team}</span>
                <span className="tnum ml-auto text-xs font-semibold text-fg">{formatLapTime(r.pace)}</span>
                <span
                  className={cn(
                    'tnum w-14 text-right text-2xs',
                    i === 0 ? 'text-good' : 'text-fg-subtle'
                  )}
                >
                  {i === 0 ? 'fastest' : `+${r.deltaToBest.toFixed(3)}`}
                </span>
              </div>
              {/* pace bar */}
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/25">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${fillPct}%`, backgroundColor: color, opacity: 0.85 }}
                />
              </div>
              {/* drivers */}
              <div className="mt-1 flex gap-3">
                {r.drivers.map((d) => (
                  <button
                    key={d.number}
                    onClick={() => setFocus(d.number)}
                    className="flex items-center gap-1 text-2xs text-fg-muted transition-colors hover:text-fg"
                  >
                    <span className="font-bold">{d.code}</span>
                    <span className="tnum text-fg-subtle">{formatLapTime(d.pace)}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        <p className="pt-0.5 text-2xs text-fg-subtle">
          Pace = median of each team's fastest clean laps. Filters pit and neutralised laps. Estimate.
        </p>
      </div>
    </WidgetFrame>
  )
}
