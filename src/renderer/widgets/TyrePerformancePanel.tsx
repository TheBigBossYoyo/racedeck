import { useMemo } from 'react'
import { CircleGauge, TrendingDown } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Badge, TyrePill } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { compoundPerformance, bestTyrePerTeam } from '@renderer/core/engines/AnalyticsEngine'
import { formatLapTime, hexColor } from '@renderer/lib/utils'

export function TyrePerformancePanel() {
  const snapshot = useSessionStore((s) => s.snapshot)

  const { compounds, teams } = useMemo(() => {
    if (!snapshot) return { compounds: [], teams: [] }
    return {
      compounds: compoundPerformance(snapshot),
      teams: bestTyrePerTeam(snapshot)
    }
  }, [snapshot])

  if (!snapshot || compounds.length === 0) {
    return (
      <WidgetFrame title="Tyre Lab" icon={<CircleGauge />} subtitle="estimate">
        <EmptyState
          icon={<CircleGauge />}
          title="No tyre data yet"
          hint="Compound pace, degradation and each team's best tyre this weekend appear here as laps accumulate."
        />
      </WidgetFrame>
    )
  }

  return (
    <WidgetFrame title="Tyre Lab" icon={<CircleGauge />} subtitle="this event" actions={<Badge tone="warn">est</Badge>} bodyClassName="space-y-3">
      {/* Compound board */}
      <div>
        <div className="mb-1.5 grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-2 px-1 text-2xs uppercase tracking-wide text-fg-subtle">
          <span>compound</span>
          <span>pace</span>
          <span className="text-right">deg/lap</span>
          <span className="text-right">laps</span>
        </div>
        <div className="space-y-1">
          {compounds.map((c) => (
            <div
              key={c.compound}
              className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-2 rounded-lg border border-hairline/15 bg-white/[0.015] px-2 py-1.5"
            >
              <TyrePill compound={c.compound} />
              <div className="flex items-baseline gap-1.5">
                <span className="tnum text-xs font-semibold text-fg">{formatLapTime(c.pace)}</span>
                {c.deltaToBest != null && c.deltaToBest > 0.0005 && (
                  <span className="tnum text-2xs text-fg-subtle">+{c.deltaToBest.toFixed(3)}</span>
                )}
                {c.deltaToBest != null && c.deltaToBest <= 0.0005 && (
                  <span className="text-2xs font-medium text-good">fastest</span>
                )}
              </div>
              <span className="tnum flex items-center justify-end gap-0.5 text-right text-2xs text-warn">
                {c.degPerLap != null ? (
                  <>
                    <TrendingDown className="h-3 w-3" />
                    +{c.degPerLap.toFixed(2)}s
                  </>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </span>
              <span className="tnum text-right text-2xs text-fg-subtle">{c.laps}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Best tyre per team */}
      {teams.length > 0 && (
        <div>
          <div className="mb-1.5 px-1 text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
            Best tyre per team
          </div>
          <div className="grid grid-cols-2 gap-1">
            {teams.map((t) => (
              <div
                key={t.team}
                className="flex items-center gap-1.5 rounded-lg border border-hairline/15 bg-white/[0.015] px-2 py-1"
                title={t.byCompound.map((b) => `${b.compound} ${formatLapTime(b.pace)}`).join(' · ')}
              >
                <span className="h-3 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: hexColor(t.color) }} />
                <span className="min-w-0 flex-1 truncate text-2xs font-medium text-fg">{t.team}</span>
                {t.best && <TyrePill compound={t.best.compound} />}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-2xs text-fg-subtle">
        Pace = median of fastest clean laps on each compound. Degradation = median per-stint trend.
        Real laps only — estimates.
      </p>
    </WidgetFrame>
  )
}
