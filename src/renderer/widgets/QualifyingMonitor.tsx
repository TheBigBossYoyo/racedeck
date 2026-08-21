import { useMemo } from 'react'
import { Clock3, Gauge, TimerReset } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Badge, EmptyState } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { qualifyingPhaseClockAt } from '@renderer/core/engines/SessionPhaseEngine'
import {
  buildQualifyingBoard,
  buildQualifyingFocusProjection,
  estimateTrackEvolution,
  type QualifyingRunState
} from '@renderer/core/engines/QualifyingEngine'
import { cn, formatDuration, formatLapTime, hexColor } from '@renderer/lib/utils'
import { pickDriver } from '@renderer/lib/useFocusDriver'
import type { SectorState } from '@shared/models'

const SECTOR_TONE: Record<SectorState, string> = {
  none: 'bg-fg-subtle/20',
  'personal-best': 'bg-good',
  'session-best': 'bg-purple'
}

const STATE_TONE: Record<QualifyingRunState, string> = {
  'HOT LAP': 'text-good bg-good/10',
  'PREP LAP': 'text-sky-400 bg-sky-400/10',
  COOLDOWN: 'text-accent bg-accent/10',
  'OUT LAP': 'text-sky-400 bg-sky-400/10',
  'IN PITS': 'text-warn bg-warn/10',
  READY: 'text-fg-subtle bg-white/[0.04]',
  OUT: 'text-danger bg-danger/10'
}

export function QualifyingMonitor() {
  const snapshot = useSessionStore((state) => state.snapshot)
  const duration = useSessionStore((state) => state.duration)
  const clock = useSessionStore((state) => state.clock)
  const timeline = useSessionStore((state) => state.timeline)
  const focusDriver = useSessionStore((state) => state.focusDriver)

  const board = useMemo(() => snapshot ? buildQualifyingBoard(snapshot) : null, [snapshot])
  const driverMap = useMemo(
    () => new Map(snapshot?.drivers.map((driver) => [driver.number, driver]) ?? []),
    [snapshot?.drivers]
  )
  const focusProjection = useMemo(
    () => snapshot && focusDriver != null ? buildQualifyingFocusProjection(snapshot, focusDriver) : null,
    [snapshot, focusDriver]
  )
  const evolution = useMemo(() => {
    if (!snapshot) return null
    return estimateTrackEvolution(snapshot.laps)
  }, [snapshot])

  if (!snapshot || !snapshot.session.type.includes('qualifying') || !board) {
    return (
      <WidgetFrame title="Qualifying Monitor" icon={<TimerReset />}>
        <EmptyState
          title="Qualifying session required"
          hint="Load qualifying or sprint qualifying to see cutline, run state and sector performance."
        />
      </WidgetFrame>
    )
  }

  const phaseClock = timeline ? qualifyingPhaseClockAt(timeline, snapshot.clock) : null
  const inBreak = phaseClock?.kind === 'break'
  // Prefer the feed's authoritative ExtrapolatedClock — it is the same countdown
  // the world broadcast shows and, unlike a duration-minus-elapsed estimate, it
  // freezes on red flags. Fall back to the segment-derived clock, then the raw
  // session length, only when the feed carries no clock.
  const extraClock = snapshot.sessionClock ?? null
  const remaining = inBreak
    ? 0
    : extraClock
      ? extraClock.remaining
      : phaseClock?.isPhase
        ? phaseClock.remaining
        : Math.max(0, duration - clock)
  const showingPhaseTimer = !inBreak && (extraClock != null || Boolean(phaseClock?.isPhase))
  const timerTitle = showingPhaseTimer
    ? `${(phaseClock?.isPhase ? phaseClock.kind : `Q${board.stage}`).toUpperCase()} time remaining`
    : inBreak
      ? 'Between qualifying phases'
      : 'Session time remaining (phase clock unavailable)'
  const timerTone = showingPhaseTimer && remaining < 20
    ? 'danger'
    : inBreak
      ? 'neutral'
      : 'accent'
  return (
    <WidgetFrame
      title="Qualifying Monitor"
      subtitle={`Q${board.stage}${board.cutoffPosition ? ` · Cut P${board.cutoffPosition}` : ' · Pole shootout'}`}
      icon={<TimerReset />}
      actions={
        <span title={timerTitle}>
          <Badge tone={timerTone}>{inBreak ? 'INTERMISSION' : formatDuration(remaining)}</Badge>
        </span>
      }
      noPadding
    >
      <div className="sticky top-0 z-10 grid grid-cols-3 gap-1 border-b border-hairline/20 bg-bg-raised/95 p-1.5 backdrop-blur-xl">
        <Summary label="Session best" value={formatLapTime(board.fastestTime)} icon={<Gauge />} tone="text-purple" />
        <Summary
          label={board.cutoffPosition ? `P${board.cutoffPosition} cutoff` : 'Final segment'}
          value={board.cutoffTime != null ? formatLapTime(board.cutoffTime) : 'No cutline'}
          icon={<TimerReset />}
        />
        <Summary
          label="Track evolution"
          value={evolution == null ? 'Building…' : `~${evolution.deltaSeconds >= 0 ? '+' : ''}${evolution.deltaSeconds.toFixed(3)}s`}
          icon={<Clock3 />}
          tone={evolution != null && evolution.deltaSeconds < 0 ? 'text-good' : 'text-fg'}
          title={evolution == null ? 'Waiting for paired early/late clean laps.' : `Median early-to-late delta across ${evolution.pairedDrivers} drivers.`}
        />
      </div>

      {focusProjection && (() => {
        const focusedDriver = driverMap.get(focusProjection.driverNumber)
        const focusedRow = board.rows.find((row) => row.driverNumber === focusProjection.driverNumber)
        return (
          <div className="border-b border-hairline/25 bg-black/10 p-2">
            <div className="mb-1.5 flex items-center gap-2">
              <span
                className="h-5 w-1 rounded-full"
                style={{ backgroundColor: hexColor(focusedDriver?.teamColour) }}
              />
              <span className="text-sm font-extrabold text-fg">
                {focusedDriver?.code ?? focusProjection.driverNumber}
              </span>
              <span className="tnum text-2xs text-fg-muted">
                L{focusProjection.lapNumber ?? '—'}
              </span>
              {focusedRow && (
                <span
                  className={cn('rounded px-1.5 py-0.5 text-[8px] font-bold', STATE_TONE[focusedRow.state])}
                  title={focusedRow.stateIsEstimate ? 'Inferred state' : focusedRow.state}
                >
                  {focusedRow.stateIsEstimate ? '~' : ''}{focusedRow.state}
                </span>
              )}
              {focusProjection.active && (
                <Badge tone="accent" className="ml-auto">~P{focusProjection.projectedPosition ?? '—'} · {focusProjection.confidence}</Badge>
              )}
            </div>

            <div className="mb-1.5 grid grid-cols-3 gap-1">
              <FocusStat label="Live sector sum" value={formatLapTime(focusProjection.currentLapTime)} />
              <FocusStat label="Personal best" value={formatLapTime(focusProjection.bestLap)} tone="text-purple" />
              <FocusStat
                label="Projected lap"
                value={focusProjection.projectedLap == null ? 'Waiting for hot lap' : `~${formatLapTime(focusProjection.projectedLap)}`}
                tone={focusProjection.projectedLap != null ? 'text-accent' : 'text-fg-subtle'}
              />
            </div>

            <div className="grid grid-cols-[72px_repeat(3,1fr)] gap-x-1 gap-y-0.5 text-[9px]">
              <span className="text-fg-subtle" />
              {['S1', 'S2', 'S3'].map((label) => (
                <span key={label} className="text-center font-semibold uppercase tracking-wide text-fg-subtle">{label}</span>
              ))}
              <SectorRow label="Current" values={focusProjection.currentSectors} />
              <SectorRow label="Best" values={focusProjection.bestSectors} tone="text-purple" />
              {focusProjection.active && (
                <SectorRow label="~Projected" values={focusProjection.projectedSectors} tone="text-accent" />
              )}
            </div>
            {focusProjection.active && (
              <p className="mt-1 text-[8px] text-fg-subtle">
                Estimate from completed sectors and clean-lap sector medians; position ranks the projected best against current classification.
              </p>
            )}
          </div>
        )
      })()}

      <div className="min-w-[440px]">
        <div className="sticky top-[55px] z-[9] grid grid-cols-[28px_62px_78px_64px_54px_1fr] gap-1 border-b border-hairline/25 bg-bg-raised/95 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-fg-subtle backdrop-blur-xl">
          <span className="text-center">P</span>
          <span>Driver</span>
          <span>Best</span>
          <span className="text-right">Gap</span>
          <span className="text-right">Cut</span>
          <span className="text-right">Sectors / run</span>
        </div>
        {board.rows.map((row) => {
          const driver = driverMap.get(row.driverNumber)
          const focused = focusDriver === row.driverNumber
          return (
            <button
              key={row.driverNumber}
              onClick={() => pickDriver(row.driverNumber)}
              className={cn(
                'relative grid w-full grid-cols-[28px_62px_78px_64px_54px_1fr] items-center gap-1 border-b border-hairline/15 px-2 py-1.5 text-left transition-colors hover:bg-white/[0.03]',
                focused && 'bg-accent/10',
                row.atRisk && 'bg-danger/[0.045]',
                board.cutoffPosition != null && row.position === board.cutoffPosition + 1 && 'border-t-2 border-t-danger/60'
              )}
            >
              {row.fastest && <span className="absolute inset-y-0 left-0 w-0.5 bg-purple" />}
              <span className={cn('tnum text-center text-xs font-bold', row.bubble ? 'text-warn' : 'text-fg-muted')}>
                {row.position}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: hexColor(driver?.teamColour) }} />
                <span className={cn('truncate text-xs font-bold', row.fastest ? 'text-purple' : 'text-fg')}>
                  {driver?.code ?? row.driverNumber}
                </span>
              </span>
              <span className="tnum mono text-[11px] font-medium text-fg">{formatLapTime(row.bestLap)}</span>
              <span className="tnum text-right text-2xs text-fg-muted">
                {row.gapToFastest == null ? '—' : row.gapToFastest === 0 ? 'FASTEST' : `+${row.gapToFastest.toFixed(3)}`}
              </span>
              <span
                className={cn(
                  'tnum text-right text-2xs font-semibold',
                  row.deltaToCutoff == null ? 'text-fg-subtle' : row.deltaToCutoff <= 0 ? 'text-good' : 'text-danger'
                )}
                title="Delta to the current elimination cutline"
              >
                {row.deltaToCutoff == null
                  ? '—'
                  : `${row.deltaToCutoff > 0 ? '+' : ''}${row.deltaToCutoff.toFixed(3)}`}
              </span>
              <span className="flex min-w-0 items-center justify-end gap-1.5">
                {row.atRisk && (
                  <span className="rounded bg-danger/15 px-1 py-0.5 text-[8px] font-bold text-danger">DROP</span>
                )}
                <span className="flex gap-0.5">
                  {row.sectors.map((sector, index) => (
                    <span key={index} className={cn('h-1.5 w-3 rounded-sm', SECTOR_TONE[sector])} />
                  ))}
                </span>
                <span
                  className={cn('min-w-14 rounded px-1 py-0.5 text-center text-[8px] font-bold', STATE_TONE[row.state])}
                  title={row.stateIsEstimate ? 'Inferred from completed-lap pace; driver intent is not exposed by the feed.' : row.state}
                >
                  {row.stateIsEstimate ? '~' : ''}{row.state}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </WidgetFrame>
  )
}

function FocusStat({ label, value, tone = 'text-fg' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-hairline/15 bg-black/15 px-1.5 py-1">
      <div className="truncate text-[8px] uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className={cn('tnum truncate text-[11px] font-bold', tone)}>{value}</div>
    </div>
  )
}

function SectorRow({
  label,
  values,
  tone = 'text-fg'
}: {
  label: string
  values: [number | null, number | null, number | null]
  tone?: string
}) {
  return (
    <>
      <span className="font-semibold uppercase tracking-wide text-fg-subtle">{label}</span>
      {values.map((value, index) => (
        <span key={index} className={cn('tnum rounded bg-white/[0.025] px-1 py-0.5 text-center', tone)}>
          {value == null ? '—' : value.toFixed(3)}
        </span>
      ))}
    </>
  )
}

function Summary({
  label,
  value,
  icon,
  tone = 'text-fg',
  title
}: {
  label: string
  value: string
  icon: React.ReactNode
  tone?: string
  title?: string
}) {
  return (
    <div className="min-w-0 rounded-md border border-hairline/20 bg-black/10 px-1.5 py-1" title={title}>
      <div className="flex items-center gap-1 truncate text-[8px] font-semibold uppercase tracking-wide text-fg-subtle [&>svg]:h-2.5 [&>svg]:w-2.5">
        {icon}{label}
      </div>
      <div className={cn('tnum truncate text-[11px] font-bold', tone)}>{value}</div>
    </div>
  )
}
