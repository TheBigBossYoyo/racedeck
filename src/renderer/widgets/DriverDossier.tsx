import { useMemo } from 'react'
import { IdCard, Crosshair, ShieldAlert, Gauge, Route, AlertTriangle } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Badge, TyrePill } from '@renderer/components/ui/primitives'
import { ErsGauge } from '@renderer/components/ui/ErsGauge'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useFocusDriver, pickDriver } from '@renderer/lib/useFocusDriver'
import {
  StrategyEngine,
  planRemainingStrategy,
  paceComparison
} from '@renderer/core/engines/StrategyEngine'
import type { AeroMode, SectorTime } from '@shared/models'
import { formatLapTime, formatGap, hexColor, cn } from '@renderer/lib/utils'

const SECTOR_TONE: Record<SectorTime['state'], string> = {
  none: 'text-fg',
  'personal-best': 'text-good',
  'session-best': 'text-purple'
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-hairline/15 bg-black/20 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className={cn('tnum text-xs font-semibold', tone ?? 'text-fg')}>{value}</div>
    </div>
  )
}

export function DriverDossier() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const getDriverLaps = useSessionStore((s) => s.getDriverLaps)
  const getTelemetry = useSessionStore((s) => s.getTelemetry)
  const driver = useFocusDriver()

  /** Speed marks for the focused driver, when the feed carries TimingStats. */
  const speeds = useMemo(
    () =>
      driver == null
        ? null
        : (snapshot?.sessionBests ?? []).find((b) => b.driverNumber === driver)?.speeds ?? null,
    [snapshot, driver]
  )

  const model = useMemo(() => {
    if (!snapshot || driver == null) return null
    const entry = snapshot.timing.find((t) => t.driverNumber === driver)
    const meta = snapshot.drivers.find((d) => d.number === driver)
    if (!entry || !meta) return null
    const laps = getDriverLaps(driver)
    const pit = StrategyEngine.predictPitStop(snapshot, driver, laps)
    const plan = planRemainingStrategy(snapshot, driver)
    const battle = paceComparison(snapshot, driver)
    const recent = laps
      .filter((l) => l.lapTime != null && l.lapTime > 0 && !l.isPitInLap && !l.isPitOutLap)
      .slice(-6)
      .reverse()
    // Current aeroMode from the tail of the short telemetry window (null when unavailable).
    let aeroMode: AeroMode | null = null
    if (snapshot.availability.telemetry) {
      const samples = getTelemetry(driver, 8)
      aeroMode = samples.length > 0 ? (samples[samples.length - 1].aeroMode ?? null) : null
    }
    return { entry, meta, pit, plan, battle, recent, bestLap: entry.bestLap, aeroMode }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, driver])

  if (!snapshot) {
    return (
      <WidgetFrame title="Driver Dossier" icon={<IdCard />}>
        <EmptyState icon={<IdCard />} title="No session loaded" hint="Load a race to open the driver dossier." />
      </WidgetFrame>
    )
  }

  const pickList = snapshot.timing.slice(0, 20)
  const colorOf = (n: number) => hexColor(snapshot.drivers.find((d) => d.number === n)?.teamColour ?? null)

  return (
    <WidgetFrame title="Driver Dossier" icon={<IdCard />} subtitle="everything, one driver" bodyClassName="flex flex-col gap-2">
      {/* Driver picker */}
      <div className="no-drag relative z-20 -mx-1 flex shrink-0 gap-1 overflow-x-auto overflow-y-hidden px-1 pb-1">
        {pickList.map((t) => {
          const active = t.driverNumber === driver
          return (
            <button
              key={t.driverNumber}
              onClick={() => pickDriver(t.driverNumber)}
              aria-pressed={active}
              className={cn(
                'relative z-10 flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-bold transition-colors',
                active ? 'border-accent/50 bg-accent/15 text-fg' : 'border-hairline/25 text-fg-muted hover:bg-white/5'
              )}
            >
              <span className="tnum text-fg-subtle">{t.position}</span>
              {snapshot.drivers.find((d) => d.number === t.driverNumber)?.code ?? t.driverNumber}
            </button>
          )
        })}
      </div>

      {!model ? (
        <EmptyState title="Driver not classified" hint="Pick a driver currently in the session." />
      ) : (
        <>
          {/* Identity */}
          <div
            className="flex items-center gap-2.5 rounded-xl p-2.5"
            style={{ background: `linear-gradient(90deg, ${colorOf(driver!)}22, transparent)` }}
          >
            <div className="tnum grid h-10 w-10 place-items-center rounded-lg bg-black/30 text-lg font-extrabold text-fg">
              {model.entry.position ?? '—'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-base font-extrabold tracking-tight text-fg">{model.meta.code}</span>
                <span className="truncate text-xs text-fg-muted">{model.meta.fullName}</span>
              </div>
              <div className="truncate text-2xs text-fg-subtle">{model.meta.teamName ?? '—'}</div>
            </div>
            <div className="ml-auto flex flex-col items-end gap-1">
              <TyrePill compound={model.entry.compound} age={model.entry.stintAge} />
              <div className="flex gap-1">
                {model.entry.isFastestLap && <Badge tone="purple">FL</Badge>}
                {model.entry.penalty && <Badge tone="danger">{model.entry.penalty}</Badge>}
                {model.entry.underInvestigation && <Badge tone="warn">INV</Badge>}
                {model.entry.status !== 'RUNNING' && (
                  <span
                    title={
                      model.entry.status === 'STOPPED'
                        ? 'The timing feed reports no current movement. This is transient and does not mean retired.'
                        : undefined
                    }
                  >
                    <Badge tone="neutral">
                      {model.entry.status === 'STOPPED' ? 'STOPPED ON TRACK' : model.entry.status}
                    </Badge>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-4 gap-1.5">
            <Stat label="Leader" value={formatGap(model.entry.gapToLeader)} />
            <Stat label="Ahead" value={formatGap(model.entry.intervalAhead)} />
            <Stat label="Behind" value={model.battle.behind?.gapSec != null ? `+${model.battle.behind.gapSec.toFixed(1)}` : '—'} />
            <Stat label="Stops" value={String(model.entry.pitStops ?? 0)} />
            <Stat label="Last" value={formatLapTime(model.entry.lastLap)} />
            <Stat label="Best" value={formatLapTime(model.entry.bestLap)} tone="text-purple" />
            <Stat label="Lap" value={model.entry.lapNumber != null ? `${model.entry.lapNumber}` : '—'} />
            <Stat label="Stint" value={model.entry.stintAge != null ? `${model.entry.stintAge}L` : '—'} />
          </div>

          {/* Sectors */}
          <div className="grid grid-cols-3 gap-1.5">
            {([model.entry.sector1, model.entry.sector2, model.entry.sector3] as SectorTime[]).map((s, i) => (
              <div key={i} className="rounded-lg border border-hairline/15 bg-black/20 px-2 py-1 text-center">
                <div className="text-[9px] uppercase tracking-wide text-fg-subtle">S{i + 1}</div>
                <div className={cn('tnum text-xs font-semibold', SECTOR_TONE[s.state])}>
                  {s.seconds != null ? s.seconds.toFixed(3) : '—'}
                </div>
              </div>
            ))}
          </div>

          {/* Speed marks (F1 TimingStats) — the two intermediates, finish line and
              speed trap, with where each ranks in the field. None of this can be
              derived from lap/sector timing; it only exists in this feed. */}
          {speeds && (
            <div>
              <div className="mb-1 text-[9px] uppercase tracking-wide text-fg-subtle">
                Best speeds (km/h · field rank)
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {([
                  ['I1', speeds.i1],
                  ['I2', speeds.i2],
                  ['FL', speeds.fl],
                  ['Trap', speeds.st]
                ] as const).map(([label, mark]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-hairline/15 bg-black/20 px-2 py-1 text-center"
                  >
                    <div className="text-[9px] uppercase tracking-wide text-fg-subtle">{label}</div>
                    <div
                      className={cn(
                        'tnum text-xs font-semibold',
                        mark.rank === 1 ? 'text-purple' : 'text-fg'
                      )}
                    >
                      {mark.value != null ? mark.value : '—'}
                    </div>
                    {mark.rank != null && (
                      <div className="text-[9px] tabular-nums text-fg-subtle">P{mark.rank}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Battery energy (2026) */}
          <ErsGauge
            pct={model.entry.energyPct}
            mode={model.entry.deployMode}
            estimate={model.entry.energyIsEstimate}
          />

          {/* Active aero — shown only when data is available */}
          {model.aeroMode != null && (
            <div className="flex items-center gap-2 rounded-lg border border-hairline/15 bg-black/20 px-2 py-1">
              <span className="text-[9px] uppercase tracking-wide text-fg-subtle">Active Aero</span>
              <span
                className={cn(
                  'ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold leading-none tracking-widest',
                  model.aeroMode === 'STRAIGHT'
                    ? 'bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/40'
                    : 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40'
                )}
                title={
                  model.aeroMode === 'STRAIGHT'
                    ? 'Straight Mode: low drag'
                    : 'Corner Mode: high downforce'
                }
              >
                {model.aeroMode === 'STRAIGHT' ? 'Straight Mode' : 'Corner Mode'}
              </span>
            </div>
          )}

          {/* Strategy chips */}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-lg border border-hairline/20 bg-white/[0.02] px-2 py-1.5">
              <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-fg-subtle">
                <Gauge className="h-3 w-3" /> pit now
              </div>
              <div className={cn('text-xs font-bold', model.pit.verdict === 'STAY OUT' ? 'text-fg' : 'text-accent')}>
                {model.pit.available ? model.pit.verdict : '—'}
              </div>
              {model.pit.available && model.pit.projectedPosition != null && (
                <div className="text-2xs text-fg-subtle">rejoin ~P{model.pit.projectedPosition}</div>
              )}
            </div>
            <div className="rounded-lg border border-hairline/20 bg-white/[0.02] px-2 py-1.5">
              <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-fg-subtle">
                <Route className="h-3 w-3" /> optimal plan
              </div>
              <div className="truncate text-xs font-bold text-fg" title={model.plan.recommended?.label}>
                {model.plan.recommended?.label ?? (model.plan.reason ? '—' : '…')}
              </div>
              <div className="truncate text-2xs text-fg-subtle" title={model.plan.ruleLabel}>
                {model.plan.ruleLabel}
                {model.plan.minimumRemainingStops > 0
                  ? ` · ${model.plan.minimumRemainingStops} required stop${model.plan.minimumRemainingStops === 1 ? '' : 's'} left`
                  : ' · rule satisfied'}
              </div>
              {model.plan.reason && !model.plan.available && (
                <div className="truncate text-2xs text-fg-subtle">{model.plan.reason}</div>
              )}
            </div>
          </div>

          {/* Pace battle mini */}
          <div className="space-y-1">
            <BattleLine icon={<Crosshair className="h-3 w-3" />} label="ahead" rival={model.battle.ahead} side="ahead" />
            <BattleLine icon={<ShieldAlert className="h-3 w-3" />} label="behind" rival={model.battle.behind} side="behind" />
          </div>

          {/* Recent laps */}
          {model.recent.length > 0 && (
            <div>
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-fg-subtle">Recent laps</div>
              <div className="space-y-0.5">
                {model.recent.map((l) => {
                  const delta = model.bestLap != null && l.lapTime != null ? l.lapTime - model.bestLap : null
                  return (
                    <div key={l.lapNumber} className="flex items-center gap-2 text-2xs">
                      <span className="tnum w-8 text-fg-subtle">L{l.lapNumber}</span>
                      <span className="tnum font-semibold text-fg">{formatLapTime(l.lapTime)}</span>
                      <TyrePill compound={l.compound} size="sm" />
                      <span className={cn('tnum ml-auto', delta != null && delta < 0.001 ? 'text-purple' : 'text-fg-subtle')}>
                        {delta != null ? (delta < 0.001 ? 'best' : `+${delta.toFixed(3)}`) : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <p className="text-2xs text-fg-subtle">
            <AlertTriangle className="mr-1 inline h-2.5 w-2.5" />
            Strategy figures are estimates.
          </p>
        </>
      )}
    </WidgetFrame>
  )
}

function BattleLine({
  icon,
  label,
  rival,
  side
}: {
  icon: React.ReactNode
  label: string
  rival: import('@renderer/core/engines/StrategyEngine').PaceRival | null
  side: 'ahead' | 'behind'
}) {
  if (!rival) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-hairline/15 px-2 py-1 text-2xs text-fg-subtle">
        {icon}
        {label}: clear
      </div>
    )
  }
  const tone = rival.closing ? (side === 'ahead' ? 'text-good' : 'text-danger') : 'text-fg-muted'
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-hairline/15 bg-white/[0.015] px-2 py-1 text-2xs">
      <span className="text-fg-subtle">{icon}</span>
      <span className="font-bold text-fg">{rival.code}</span>
      <span className="tnum text-fg-muted">{rival.gapSec != null ? `${rival.gapSec.toFixed(1)}s` : '—'}</span>
      <span className={cn('ml-auto', tone)}>
        {rival.deltaPerLap == null
          ? '—'
          : `${rival.deltaPerLap > 0 ? '+' : ''}${rival.deltaPerLap.toFixed(2)}s/lap${rival.closing && rival.lapsToResolve != null ? ` · ~${Math.ceil(rival.lapsToResolve)}L` : ''}`}
      </span>
    </div>
  )
}
