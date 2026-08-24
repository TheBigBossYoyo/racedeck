import { useMemo, useState } from 'react'
import { Star, TriangleAlert } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Badge, EmptyState, TyrePill, TeamStripe } from '@renderer/components/ui/primitives'
import { ErsBar } from '@renderer/components/ui/ErsGauge'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { formatGap, formatLapTime, formatStaleness, cn } from '@renderer/lib/utils'
import { pickDriver } from '@renderer/lib/useFocusDriver'
import { sectorDisplayState, type SectorDisplayState } from '@renderer/core/providers/f1normalize'
import type { TimingEntry } from '@shared/models'

/** TimingData is a lower-rate feed than Position/CarData; a longer quiet spell means it stopped. */
const TIMING_STALE_MS = 15_000

// Color is never the only encoding (APP_IMPROVEMENT_ROADMAP.md P2 item 30):
// each state also gets a distinct fill/ring pattern, not just a hue, so a
// color-vision-deficient viewer can still tell them apart by shape/fill.
const SECTOR_CLS: Record<SectorDisplayState, string> = {
  none: 'border border-fg-subtle/40 bg-transparent',
  active: 'border-2 border-warn bg-warn/25 animate-pulse',
  complete: 'bg-warn/60',
  'personal-best': 'bg-good',
  'session-best': 'bg-purple ring-2 ring-inset ring-white/70'
}

const SECTOR_LABEL: Record<SectorDisplayState, string> = {
  none: 'no time yet',
  active: 'in progress',
  complete: 'set',
  'personal-best': 'personal best',
  'session-best': 'session best'
}

type GridScope = 'all' | '10' | '5' | '3'

function SectorTriad({ e }: { e: TimingEntry }) {
  const s = [e.sector1, e.sector2, e.sector3]
  return (
    <div className="flex items-center gap-0.5">
      {s.map((sec, i) => {
        const state = sectorDisplayState(sec)
        const label = `Sector ${i + 1}: ${SECTOR_LABEL[state]}${sec.seconds ? `, ${sec.seconds.toFixed(3)}s` : ''}`
        return (
          <span
            key={i}
            role="img"
            aria-label={label}
            className={cn('h-1.5 w-3 rounded-sm transition-colors', SECTOR_CLS[state])}
            title={label}
          />
        )
      })}
    </div>
  )
}

export function TimingTower() {
  const [scope, setScope] = useState<GridScope>('all')
  const snapshot = useSessionStore((s) => s.snapshot)
  const focusDriver = useSessionStore((s) => s.focusDriver)
  const favorites = useSettingsStore((s) => s.favorites)
  const toggleFavorite = useSettingsStore((s) => s.toggleFavorite)
  const favoriteSet = useMemo(() => new Set(favorites), [favorites])

  const driverMap = useMemo(() => {
    const m = new Map<number, { code: string; team: string | null; color: string | null }>()
    snapshot?.drivers.forEach((d) =>
      m.set(d.number, { code: d.code, team: d.teamName, color: d.teamColour })
    )
    return m
  }, [snapshot?.drivers])

  const visibleTiming = useMemo(() => {
    if (!snapshot) return []
    const count = scope === 'all' ? snapshot.timing.length : Number(scope)
    return snapshot.timing.slice(0, count)
  }, [snapshot, scope])

  if (!snapshot || snapshot.timing.length === 0) {
    return (
      <WidgetFrame title="Timing Tower">
        <EmptyState title="No timing data" hint="Load a session to populate the timing tower." />
      </WidgetFrame>
    )
  }

  return (
    <WidgetFrame
      title="Timing Tower"
      subtitle={
        scope === 'all'
          ? `${snapshot.timing.length} cars`
          : `${visibleTiming.length} of ${snapshot.timing.length}`
      }
      noPadding
      accent
    >
      <div className="flex flex-col">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-1.5 border-b border-hairline/20 bg-bg-raised/95 px-2 py-1 backdrop-blur-xl">
          {snapshot.currentLap != null ? (
            <Badge tone="neutral" className="tnum whitespace-nowrap">
              L{snapshot.currentLap}
              {snapshot.totalLaps ? `/${snapshot.totalLaps}` : ''}
            </Badge>
          ) : (
            <span className="text-2xs text-fg-subtle">Session</span>
          )}
          {(() => {
            const stale = formatStaleness(snapshot.feedFreshness?.TimingData, TIMING_STALE_MS)
            return (
              stale && (
                <span title="Timing feed has stopped delivering new data">
                  <Badge tone="danger" className="whitespace-nowrap">
                    {stale}
                  </Badge>
                </span>
              )
            )
          })()}
          <span
            className="hidden text-[9px] font-semibold uppercase tracking-wide text-fg-subtle min-[1500px]:inline"
            title="Battery estimate and current Harvest / Deploy / Boost / Overtake mode"
          >
            BAT · MODE
          </span>
          <select
            aria-label="Timing Tower field scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as GridScope)}
            className="no-drag h-6 min-w-0 max-w-24 rounded-md border border-hairline/35 bg-black/15 px-1.5 text-2xs font-medium text-fg outline-none focus:border-accent/50"
          >
            <option value="all">Full grid</option>
            <option value="10">Top 10</option>
            <option value="5">Top 5</option>
            <option value="3">Top 3</option>
          </select>
        </div>
        {snapshot.availability.live && !snapshot.availability.telemetry && (
          <div className="border-b border-hairline/15 bg-warn/[0.06] px-2 py-1 text-[10px] leading-tight text-fg-muted">
            Battery &amp; deploy mode need live car telemetry, which F1 gates behind an F1 TV
            subscription. Sign in via Go Live to unlock them.
          </div>
        )}
        {visibleTiming.map((e) => {
          const d = driverMap.get(e.driverNumber)
          const fav = favoriteSet.has(e.driverNumber)
          const focused = focusDriver === e.driverNumber
          const dim = e.retired || e.status === 'RETIRED' || e.status === 'DNF'
          return (
            <div
              key={e.driverNumber}
              className={cn(
                'group relative flex items-center gap-2 border-b border-hairline/15 px-2 py-1.5 text-left transition-colors',
                focused ? 'bg-accent/10' : 'hover:bg-white/[0.03]',
                dim && 'opacity-45'
              )}
              style={{ contentVisibility: 'auto', containIntrinsicSize: '40px' }}
            >
              {e.isFastestLap && <span className="absolute inset-y-0 left-0 w-[2px] bg-purple" />}
              <button
                onClick={() => pickDriver(e.driverNumber)}
                aria-label={`Focus ${d?.code ?? e.driverNumber}`}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                {/* Position */}
                <span
                  className={cn(
                    'tnum grid h-6 w-6 shrink-0 place-items-center rounded-md text-xs font-bold',
                    e.position === 1 ? 'bg-accent/20 text-accent' : 'bg-white/5 text-fg-muted'
                  )}
                >
                  {e.position ?? '—'}
                </span>
                <TeamStripe color={d?.color ?? null} />

                {/* Driver + tyre + last */}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold tracking-wide text-fg">
                      {d?.code ?? e.driverNumber}
                    </span>
                    {e.isFastestLap && (
                      <span className="rounded bg-purple/15 px-1 text-[9px] font-bold text-purple ring-1 ring-purple/30">
                        FL
                      </span>
                    )}
                    {e.inPit && (
                      <span className="rounded bg-warn/20 px-1 text-[9px] font-bold uppercase text-warn">
                        Pit
                      </span>
                    )}
                    {dim && (
                      <span className="rounded bg-danger/20 px-1 text-[9px] font-bold uppercase text-danger">
                        Out
                      </span>
                    )}
                    {e.penalty && (
                      <span className="rounded bg-danger/20 px-1 text-[9px] font-bold text-danger">
                        {/^\d+s$/.test(e.penalty) ? `+${e.penalty}` : e.penalty}
                      </span>
                    )}
                    {e.underInvestigation && (
                      <TriangleAlert
                        className="h-3 w-3 text-warn"
                        role="img"
                        aria-label="Under investigation"
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <TyrePill compound={e.compound} age={e.stintAge} size="sm" />
                    <span className="tnum mono text-2xs text-fg-muted">
                      {formatLapTime(e.lastLap)}
                    </span>
                  </div>
                </div>

                {/* Gap + interval */}
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span
                    className={cn(
                      'tnum mono text-xs font-medium',
                      e.position === 1 ? 'text-accent' : 'text-fg'
                    )}
                  >
                    {e.position === 1 ? 'LEADER' : formatGap(e.gapToLeader)}
                  </span>
                  <span className="tnum mono text-[10px] text-fg-subtle">
                    {e.position === 1 ? formatLapTime(e.bestLap) : formatGap(e.intervalAhead)}
                  </span>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <SectorTriad e={e} />
                  <ErsBar
                    pct={e.energyPct}
                    mode={e.deployMode}
                    estimate={e.energyIsEstimate}
                    confidence={e.energyConfidence}
                    deploymentLimited={e.energyDeploymentLimited}
                    staleMs={snapshot.feedFreshness?.CarData}
                  />
                </div>
              </button>

              {/* Favorite star (appears on hover / when set) */}
              <button
                type="button"
                aria-label={`${fav ? 'Remove' : 'Add'} ${d?.code ?? e.driverNumber} ${fav ? 'from' : 'to'} favorites`}
                onClick={() => toggleFavorite(e.driverNumber)}
                className={cn(
                  'shrink-0 rounded p-0.5 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60',
                  fav ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
                )}
              >
                <Star
                  className={cn('h-3.5 w-3.5', fav ? 'fill-accent text-accent' : 'text-fg-muted')}
                />
              </button>
            </div>
          )
        })}
      </div>
    </WidgetFrame>
  )
}
