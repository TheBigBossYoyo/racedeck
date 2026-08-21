import { useMemo } from 'react'
import { Target, TrendingUp, Timer, ShieldAlert, Swords, Flame, ArrowDownUp, Users } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Badge } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { StrategyEngine, type InsightKind, type StrategyInsight } from '@renderer/core/engines/StrategyEngine'
import { cn } from '@renderer/lib/utils'
import { useFocusDriver } from '@renderer/lib/useFocusDriver'

const KIND_META: Record<InsightKind, { icon: React.ReactNode; tone: string }> = {
  undercut: { icon: <ArrowDownUp className="h-3.5 w-3.5" />, tone: 'text-accent' },
  overcut: { icon: <ArrowDownUp className="h-3.5 w-3.5" />, tone: 'text-accent' },
  'pit-window': { icon: <Timer className="h-3.5 w-3.5" />, tone: 'text-good' },
  'safety-car': { icon: <ShieldAlert className="h-3.5 w-3.5" />, tone: 'text-warn' },
  degradation: { icon: <Flame className="h-3.5 w-3.5" />, tone: 'text-danger' },
  battle: { icon: <Swords className="h-3.5 w-3.5" />, tone: 'text-purple' },
  rejoin: { icon: <TrendingUp className="h-3.5 w-3.5" />, tone: 'text-accent' },
  teammate: { icon: <Users className="h-3.5 w-3.5" />, tone: 'text-purple' }
}

const CONF_TONE = { high: 'good', medium: 'warn', low: 'neutral' } as const

function InsightRow({ ins }: { ins: StrategyInsight }) {
  const meta = KIND_META[ins.kind]
  return (
    <div className="rounded-lg border border-hairline/20 bg-white/[0.02] p-2.5">
      <div className="flex items-center gap-2">
        <span className={meta.tone}>{meta.icon}</span>
        <span className="text-xs font-semibold text-fg">{ins.title}</span>
        <div className="ml-auto flex items-center gap-1">
          <Badge tone={CONF_TONE[ins.confidence]}>{ins.confidence}</Badge>
          {/* Measured insights (e.g. pit-lane transits) must not be labelled
              estimates — the distinction is the point of the badge. */}
          <Badge tone={ins.isEstimate ? 'neutral' : 'good'}>
            {ins.isEstimate ? 'EST' : 'MEASURED'}
          </Badge>
        </div>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-fg-muted">{ins.detail}</p>
    </div>
  )
}

export function StrategyInsightsPanel() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const getDriverLaps = useSessionStore((s) => s.getDriverLaps)
  const focusDriver = useFocusDriver()
  const favorites = useSettingsStore((s) => s.favorites)

  const insights = useMemo(() => {
    if (!snapshot) return []
    const watch = focusDriver != null ? [focusDriver, ...favorites.filter((n) => n !== focusDriver)] : favorites
    const list = StrategyEngine.generateInsights(snapshot, (n) => getDriverLaps(n), watch)
    if (focusDriver != null) {
      const pit = StrategyEngine.pitNowAssistant(snapshot, focusDriver, getDriverLaps(focusDriver))
      return [pit, ...list.filter((i) => i.id !== pit.id)]
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, focusDriver, favorites])

  return (
    <WidgetFrame
      title="Strategy Insights"
      icon={<Target />}
      subtitle="estimates"
      actions={<Badge tone="warn">projections</Badge>}
    >
      {!snapshot || insights.length === 0 ? (
        <EmptyState
          icon={<Target />}
          title="No strategy calls yet"
          hint="Undercut windows, degradation warnings, safety-car opportunities and pit calls appear here as the race unfolds. Add favourite drivers to focus the analysis."
        />
      ) : (
        <div className="space-y-1.5">
          <p className={cn('mb-1 text-[10px] uppercase tracking-wide text-fg-subtle')}>
            All figures are estimates
          </p>
          {insights.map((ins) => (
            <InsightRow key={ins.id} ins={ins} />
          ))}
        </div>
      )}
    </WidgetFrame>
  )
}
