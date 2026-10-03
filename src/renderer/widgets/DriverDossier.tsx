import { useMemo } from 'react'
import {
  IdCard,
  Crosshair,
  ShieldAlert,
  Gauge,
  Route,
  AlertTriangle,
  Radio,
  Play,
  Pause
} from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Badge, TyrePill, FOCUS_RING_INSET } from '@renderer/components/ui/primitives'
import { ErsGauge } from '@renderer/components/ui/ErsGauge'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useFocusDriver, pickDriver } from '@renderer/lib/useFocusDriver'
import {
  StrategyEngine,
  planRemainingStrategy,
  paceComparison
} from '@renderer/core/engines/StrategyEngine'
import { buildTyreRead } from '@renderer/core/engines/TyreRead'
import { sectorDegradationTrend } from '@renderer/core/engines/SectorDegradation'
import { estimateFuelCoefficient } from '@renderer/core/engines/FuelModel'
import { buildPitStopHistory } from '@renderer/core/engines/PitHistory'
import { PitHistoryPanel } from '@renderer/widgets/driverDossier/PitHistoryPanel'
import { useRadioPlaybackStore } from '@renderer/store/radioPlaybackStore'
import { seekToRadioClip } from '@renderer/lib/seekToRadioClip'
import { TranscribeAction } from '@renderer/widgets/TeamRadioPanel'
import { isTranscriptionReady } from '@shared/ai'
import { TyrePanel } from '@renderer/widgets/driverDossier/TyrePanel'
import {
  BattleLine,
  DossierStat as Stat,
  SpeedMarks
} from '@renderer/widgets/driverDossier/DossierDetails'
import type { AeroMode, SectorTime } from '@shared/models'
import { formatLapTime, formatGap, hexColor, cn } from '@renderer/lib/utils'
import { formatClockShort } from '@renderer/lib/units'

const SECTOR_TONE: Record<SectorTime['state'], string> = {
  none: 'text-fg',
  'personal-best': 'text-good',
  'session-best': 'text-purple'
}

/** Non-colour form of a sector's state; `none` needs no marker. */
const SECTOR_STATE_LABEL: Partial<Record<SectorTime['state'], string>> = {
  'personal-best': 'personal best',
  'session-best': 'session best'
}

/**
 * A driver's own team-radio clips (APP_IMPROVEMENT_ROADMAP.md P2 item 23),
 * each clickable to seek + play through the shared `radioPlaybackStore` so
 * this and `TeamRadioPanel` never talk over each other.
 */
function DossierRadioList({ clips }: { clips: { url: string; utc: string }[] }) {
  const playingUrl = useRadioPlaybackStore((s) => s.playingUrl)
  const togglePlayback = useRadioPlaybackStore((s) => s.toggle)
  const ai = useSettingsStore((s) => s.ai)
  const transcriptionOk = isTranscriptionReady(ai)
  const clockUnit = useSettingsStore((s) => s.units.clock)
  const play = (url: string, utc: string) => {
    togglePlayback(url)
    seekToRadioClip(utc)
  }
  return (
    <div className="rounded-lg border border-hairline/25 bg-white/[0.02] p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-muted">
        <Radio className="h-3.5 w-3.5" /> Radio
      </div>
      <div className="space-y-1">
        {clips.map((clip) => {
          const isPlaying = playingUrl === clip.url
          return (
            <div
              key={clip.url}
              className={cn(
                'rounded-md border px-2 py-1 text-[10px] transition-colors',
                isPlaying
                  ? 'border-accent/40 bg-accent/10'
                  : 'border-hairline/15 bg-black/20 hover:border-hairline/35'
              )}
            >
              <button
                type="button"
                onClick={() => play(clip.url, clip.utc)}
                aria-label={`${isPlaying ? 'Pause' : 'Play'} radio clip at ${formatClockShort(clip.utc, clockUnit)}`}
                aria-pressed={isPlaying}
                className={cn('flex w-full items-center gap-2 rounded text-left', FOCUS_RING_INSET)}
              >
                {isPlaying ? (
                  <Pause className="h-3 w-3 shrink-0 text-accent" />
                ) : (
                  <Play className="h-3 w-3 shrink-0 text-fg-muted" />
                )}
                <span className="tnum ml-auto text-fg-subtle">
                  {formatClockShort(clip.utc, clockUnit)}
                </span>
              </button>
              {transcriptionOk && <TranscribeAction url={clip.url} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function DriverDossier() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const getDriverLaps = useSessionStore((s) => s.getDriverLaps)
  const getTelemetry = useSessionStore((s) => s.getTelemetry)
  const speedUnit = useSettingsStore((s) => s.units.speed)
  const driver = useFocusDriver()

  /** Speed marks for the focused driver, when the feed carries TimingStats. */
  const speeds = useMemo(
    () =>
      driver == null
        ? null
        : ((snapshot?.sessionBests ?? []).find((b) => b.driverNumber === driver)?.speeds ?? null),
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
    const tyre = buildTyreRead(snapshot, entry, laps)
    const bestSectorMarks = snapshot.sessionBests?.find(
      (b) => b.driverNumber === driver
    )?.bestSectors
    const bestSectorsSec: [number | null, number | null, number | null] = [
      bestSectorMarks?.[0]?.value ?? null,
      bestSectorMarks?.[1]?.value ?? null,
      bestSectorMarks?.[2]?.value ?? null
    ]
    const sectors = sectorDegradationTrend(
      laps,
      6,
      estimateFuelCoefficient(snapshot),
      bestSectorsSec
    )
    const pitHistory = buildPitStopHistory(snapshot).filter((s) => s.driverNumber === driver)
    const radioClips = (snapshot.teamRadio ?? []).filter((c) => c.driverNumber === driver)
    return {
      entry,
      meta,
      pit,
      plan,
      battle,
      recent,
      bestLap: entry.bestLap,
      aeroMode,
      tyre,
      sectors,
      pitHistory,
      radioClips
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, driver])

  if (!snapshot) {
    return (
      <WidgetFrame title="Driver Dossier" icon={<IdCard />}>
        <EmptyState
          icon={<IdCard />}
          title="No session loaded"
          hint="Load a race to open the driver dossier."
        />
      </WidgetFrame>
    )
  }

  const pickList = snapshot.timing.slice(0, 20)

  return (
    <WidgetFrame
      title="Driver Dossier"
      icon={<IdCard />}
      subtitle="everything, one driver"
      bodyClassName="flex flex-col gap-2"
    >
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
                FOCUS_RING_INSET,
                active
                  ? 'border-accent/50 bg-accent/15 text-fg'
                  : 'border-hairline/25 text-fg-muted hover:bg-white/5'
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
            style={{
              background: `linear-gradient(90deg, ${hexColor(model.meta.teamColour)}22, transparent)`
            }}
          >
            <div className="tnum grid h-10 w-10 place-items-center rounded-lg bg-black/30 text-lg font-extrabold text-fg">
              {model.entry.position ?? '—'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-base font-extrabold tracking-tight text-fg">
                  {model.meta.code}
                </span>
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
            <Stat
              label="Behind"
              value={
                model.battle.behind?.gapSec != null
                  ? `+${model.battle.behind.gapSec.toFixed(1)}`
                  : '—'
              }
            />
            <Stat label="Stops" value={String(model.entry.pitStops ?? 0)} />
            <Stat label="Last" value={formatLapTime(model.entry.lastLap)} />
            <Stat label="Best" value={formatLapTime(model.entry.bestLap)} tone="text-purple" />
            <Stat
              label="Lap"
              value={model.entry.lapNumber != null ? `${model.entry.lapNumber}` : '—'}
            />
            <Stat
              label="Stint"
              value={model.entry.stintAge != null ? `${model.entry.stintAge}L` : '—'}
            />
          </div>

          {/* Sectors */}
          <div className="grid grid-cols-3 gap-1.5">
            {([model.entry.sector1, model.entry.sector2, model.entry.sector3] as SectorTime[]).map(
              (s, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-hairline/15 bg-black/20 px-2 py-1 text-center"
                >
                  <div
                    className="text-[9px] uppercase tracking-wide text-fg-subtle"
                    title={SECTOR_STATE_LABEL[s.state]}
                  >
                    S{i + 1}
                  </div>
                  <div className={cn('tnum text-xs font-semibold', SECTOR_TONE[s.state])}>
                    {s.seconds != null ? s.seconds.toFixed(3) : '—'}
                    {SECTOR_STATE_LABEL[s.state] && (
                      <span className="sr-only"> ({SECTOR_STATE_LABEL[s.state]})</span>
                    )}
                  </div>
                </div>
              )
            )}
          </div>

          {/* Speed marks (F1 TimingStats) — the two intermediates, finish line and
              speed trap, with where each ranks in the field. None of this can be
              derived from lap/sector timing; it only exists in this feed. */}
          {speeds && <SpeedMarks speeds={speeds} speedUnit={speedUnit} />}

          {/* Tyre read — age, wear trend and what it means, in one glance */}
          <TyrePanel read={model.tyre} sectors={model.sectors} />

          {/* Battery energy (2026) */}
          <ErsGauge
            pct={model.entry.energyPct}
            mode={model.entry.deployMode}
            estimate={model.entry.energyIsEstimate}
            confidence={model.entry.energyConfidence}
            deploymentLimited={model.entry.energyDeploymentLimited}
            staleMs={snapshot.feedFreshness?.CarData}
            trend={model.entry.energyTrend}
            trendDeltaPct={model.entry.energyTrendDeltaPct}
            deployBudgetPct={model.entry.energyDeployBudgetPct}
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

          {/* Overtake eligibility — why it is/isn't available, never implying the
              driver's button press is observed. */}
          {model.entry.energyEligibilityReason != null && (
            <div
              className="flex items-center gap-2 rounded-lg border border-hairline/15 bg-black/20 px-2 py-1 text-2xs"
              title={model.entry.energyEligibilityReason}
            >
              <span className="text-[9px] uppercase tracking-wide text-fg-subtle">Overtake</span>
              <span
                className={cn(
                  'truncate',
                  model.entry.deployMode === 'OVERTAKE' ? 'text-good' : 'text-fg-muted'
                )}
              >
                {model.entry.energyEligibilityReason}
                {model.entry.energyEligibleForSec != null &&
                  ` · ${model.entry.energyEligibleForSec.toFixed(0)}s`}
              </span>
            </div>
          )}

          <PitHistoryPanel stops={model.pitHistory} />

          {model.radioClips.length > 0 && <DossierRadioList clips={model.radioClips} />}

          {/* Strategy chips */}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-lg border border-hairline/20 bg-white/[0.02] px-2 py-1.5">
              <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-fg-subtle">
                <Gauge className="h-3 w-3" /> pit now
              </div>
              <div
                className={cn(
                  'text-xs font-bold',
                  model.pit.verdict === 'STAY OUT' ? 'text-fg' : 'text-accent'
                )}
              >
                {model.pit.available ? model.pit.verdict : '—'}
              </div>
              {model.pit.available && model.pit.projectedPosition != null && (
                <div className="text-2xs text-fg-subtle">
                  rejoin ~P{model.pit.projectedPosition}
                </div>
              )}
            </div>
            <div className="rounded-lg border border-hairline/20 bg-white/[0.02] px-2 py-1.5">
              <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-fg-subtle">
                <Route className="h-3 w-3" /> optimal plan
              </div>
              <div
                className="truncate text-xs font-bold text-fg"
                title={model.plan.recommended?.label}
              >
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
            <BattleLine
              icon={<Crosshair className="h-3 w-3" />}
              label="ahead"
              rival={model.battle.ahead}
              side="ahead"
            />
            <BattleLine
              icon={<ShieldAlert className="h-3 w-3" />}
              label="behind"
              rival={model.battle.behind}
              side="behind"
            />
          </div>

          {/* Recent laps */}
          {model.recent.length > 0 && (
            <div>
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-fg-subtle">
                Recent laps
              </div>
              <div className="space-y-0.5">
                {model.recent.map((l) => {
                  const delta =
                    model.bestLap != null && l.lapTime != null ? l.lapTime - model.bestLap : null
                  return (
                    <div key={l.lapNumber} className="flex items-center gap-2 text-2xs">
                      <span className="tnum w-8 text-fg-subtle">L{l.lapNumber}</span>
                      <span className="tnum font-semibold text-fg">{formatLapTime(l.lapTime)}</span>
                      <TyrePill compound={l.compound} size="sm" />
                      <span
                        className={cn(
                          'tnum ml-auto',
                          delta != null && delta < 0.001 ? 'text-purple' : 'text-fg-subtle'
                        )}
                      >
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
