import { useMemo } from 'react'
import { Route, Flag, Trophy } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Badge, TyrePill } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useFocusDriver } from '@renderer/lib/useFocusDriver'
import { planRemainingStrategy, type StrategyPlan } from '@renderer/core/engines/StrategyEngine'
import { TYRE_LABELS } from '@shared/constants'
import { useTyreColors } from '@renderer/lib/useTyreColors'
import { cn } from '@renderer/lib/utils'

function PlanTimeline({ plan, currentLap, totalLaps }: { plan: StrategyPlan; currentLap: number; totalLaps: number }) {
  const remaining = Math.max(1, totalLaps - currentLap)
  const tyreColors = useTyreColors()
  return (
    <div className="relative mt-1.5">
      <div className="flex h-6 overflow-hidden rounded-md bg-black/30">
        {plan.segments.map((seg, i) => {
          const pct = (seg.laps / remaining) * 100
          const color = tyreColors[seg.compound]
          return (
            <div
              key={i}
              className="relative flex items-center justify-center border-r border-black/40 last:border-r-0"
              style={{ width: `${pct}%`, backgroundColor: `${color}2e` }}
              title={`${seg.compound} · laps ${seg.startLap}-${seg.startLap + seg.laps - 1} (${seg.laps} laps)`}
            >
              <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color, opacity: 0.9 }} />
              {pct > 12 && (
                <span className="text-[10px] font-bold" style={{ color }}>
                  {TYRE_LABELS[seg.compound]}
                  <span className="ml-0.5 text-fg-subtle">{seg.laps}</span>
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-fg-subtle">
        <span>L{currentLap}</span>
        <span>L{totalLaps}</span>
      </div>
    </div>
  )
}

function PlanRow({ plan, best }: { plan: StrategyPlan; best?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-lg border px-2.5 py-2',
        best ? 'border-good/30 bg-good/[0.06]' : 'border-hairline/20 bg-white/[0.015]'
      )}
    >
      <div className="flex items-center gap-2">
        {best ? (
          <Trophy className="h-3.5 w-3.5 text-good" />
        ) : (
          <span className="tnum text-2xs font-bold text-fg-subtle">{plan.stops}⏱</span>
        )}
        <span className={cn('text-xs font-semibold', best ? 'text-fg' : 'text-fg-muted')}>{plan.label}</span>
        <span className="ml-auto tnum text-xs font-semibold">
          {best ? <span className="text-good">optimal</span> : <span className="text-fg-muted">+{plan.deltaSec.toFixed(1)}s</span>}
        </span>
      </div>
    </div>
  )
}

export function StintPlanner() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const driver = useFocusDriver()

  const plan = useMemo(() => {
    if (!snapshot || driver == null) return null
    return planRemainingStrategy(snapshot, driver)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, driver])

  const code = driver != null ? snapshot?.drivers.find((d) => d.number === driver)?.code : null
  const buildingModel = !!plan?.reason && /opening stint|fresh|clean-lap data/i.test(plan.reason)

  if (!snapshot) {
    return (
      <WidgetFrame title="Stint Planner" icon={<Route />}>
        <EmptyState icon={<Route />} title="No session loaded" hint="Load a race to plan the remaining stints." />
      </WidgetFrame>
    )
  }

  return (
    <WidgetFrame
      title="Stint Planner"
      icon={<Route />}
      subtitle={code ? `${code} · optimal remaining` : 'optimal remaining'}
      actions={<Badge tone="warn">estimate</Badge>}
      bodyClassName="flex flex-col gap-2.5"
    >
      {!plan || !plan.available || !plan.recommended ? (
        buildingModel ? (
          <div className="flex h-full flex-col justify-center rounded-xl border border-accent/20 bg-accent/[0.04] p-4">
            <div className="flex items-center gap-2 text-accent">
              <Route className="h-5 w-5" />
              <span className="text-sm font-semibold">Building the pit window</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">
              {plan?.reason} RaceDeck waits for a meaningful stint sample instead of forcing a speculative early stop.
            </p>
            <div className="mt-3 flex items-center gap-2 text-2xs text-fg-subtle">
              <Badge tone="neutral">LOW EVIDENCE</Badge>
              <span>{snapshot.currentLap ? `Lap ${snapshot.currentLap}` : 'Opening phase'}</span>
            </div>
          </div>
        ) : (
          <EmptyState
            title="Plan unavailable"
            hint={plan?.reason ?? 'Need clean-lap and stint data to model the remaining race.'}
          />
        )
      ) : (
        <>
          <div className="flex items-center gap-2 text-2xs text-fg-muted">
            <span className="flex items-center gap-1">
              <Flag className="h-3 w-3" /> {plan.lapsRemaining} laps to go
            </span>
            <span className="flex items-center gap-1">
              on <TyrePill compound={plan.currentCompound} age={plan.currentAge} size="sm" />
            </span>
            <span className="ml-auto">used: {plan.usedCompounds.join(' · ') || '—'}</span>
          </div>
          <div className="flex items-center justify-between rounded-md border border-hairline/20 bg-black/15 px-2 py-1 text-2xs">
            <span className="text-fg-muted">{plan.ruleLabel}</span>
            <span className="font-semibold text-fg">
              {plan.minimumRemainingStops > 0
                ? `${plan.minimumRemainingStops} stop${plan.minimumRemainingStops === 1 ? '' : 's'} still required`
                : 'stop rule satisfied'}
            </span>
          </div>

          {/* Recommended plan */}
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
              Recommended
            </div>
            <PlanRow plan={plan.recommended} best />
            {snapshot.totalLaps && snapshot.currentLap && (
              <PlanTimeline plan={plan.recommended} currentLap={snapshot.currentLap} totalLaps={snapshot.totalLaps} />
            )}
            {!plan.recommended.usesTwoCompounds && (
              <p className="mt-1 text-2xs text-warn">Note: does not yet satisfy the two-compound rule.</p>
            )}
          </div>

          {/* Alternatives */}
          {plan.alternatives.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
                Alternatives
              </div>
              <div className="space-y-1">
                {plan.alternatives.map((alt, i) => (
                  <PlanRow key={i} plan={alt} />
                ))}
              </div>
            </div>
          )}

          <p className="text-2xs text-fg-subtle">
            Time-optimal over a pace + degradation model calibrated from this event's real laps. Pit
            loss ~21.5s. Event stop and compound rules enforced. All estimates.
          </p>
        </>
      )}
    </WidgetFrame>
  )
}
