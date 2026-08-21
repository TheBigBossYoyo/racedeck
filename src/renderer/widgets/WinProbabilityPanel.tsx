import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Trophy,
  RefreshCw,
  Loader2,
  TrendingUp,
  TrendingDown,
  Radio,
  Settings2,
  History
} from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Badge, Segmented, EmptyState, StatusDot } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useAppStore } from '@renderer/store/appStore'
import {
  useMarketStore,
  matchOutcomesToDrivers,
  marketQueryForSession
} from '@renderer/store/marketStore'
import { WinProbabilityEngine, type WinChance } from '@renderer/core/engines/WinProbabilityEngine'
import { normalizeReplayMarketPrices } from '@shared/market'
import { useFocusDriver, pickDriver } from '@renderer/lib/useFocusDriver'
import { cn, hexColor } from '@renderer/lib/utils'
import { useSampledValue } from '@renderer/lib/useSampledValue'

type Metric = 'win' | 'podium' | 'points'

const METRIC_OPTS: { value: Metric; label: string }[] = [
  { value: 'win', label: 'Win' },
  { value: 'podium', label: 'Podium' },
  { value: 'points', label: 'Points' }
]

const pctOf = (c: WinChance, m: Metric): number =>
  m === 'win' ? c.winPct : m === 'podium' ? c.podiumPct : c.pointsPct

const formatPct = (value: number): string => {
  if (value > 0 && value < 0.1) return '<0.1%'
  return `${value >= 1 ? value.toFixed(0) : value.toFixed(1)}%`
}

const REFRESH_MS = 45_000

export function WinProbabilityPanel() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const effectiveDataTime = useSessionStore((s) => s.effectiveDataTime())
  const focus = useFocusDriver()
  const market = useSettingsStore((s) => s.market)
  const setRoute = useAppStore((s) => s.setRoute)
  const [metric, setMetric] = useState<Metric>('win')
  const [syncOdds, setSyncOdds] = useState(false)

  const {
    result,
    loading,
    error,
    historyByToken,
    historyLoading,
    historyErrorByToken,
    refresh,
    loadHistory
  } = useMarketStore(
    useShallow((state) => ({
      result: state.result,
      loading: state.loading,
      error: state.error,
      historyByToken: state.historyByToken,
      historyLoading: state.historyLoading,
      historyErrorByToken: state.historyErrorByToken,
      refresh: state.refresh,
      loadHistory: state.loadHistory
    }))
  )

  const modelSnapshot = useSampledValue(snapshot, 1_000, snapshot?.session.id ?? null)
  const model = useMemo(
    () => (modelSnapshot ? WinProbabilityEngine.compute(modelSnapshot) : null),
    [modelSnapshot]
  )

  const query = snapshot ? marketQueryForSession(snapshot.session) : ''
  const slug = market.slugOverride.trim()
  const startMsRaw = snapshot?.session.dateStart ? Date.parse(snapshot.session.dateStart) : NaN
  const targetDateMs = Number.isFinite(startMsRaw) ? startMsRaw : undefined

  // Fetch / poll market odds when enabled. Query keyed on the current GP; the
  // race date disambiguates the right weekend when several GP markets are open.
  useEffect(() => {
    if (!market.enabled) return
    if (!query && !slug) return
    void refresh({ query, slug, targetDateMs })
    if (!market.autoRefresh) return
    const id = window.setInterval(() => void refresh({ query, slug, targetDateMs }), REFRESH_MS)
    return () => window.clearInterval(id)
  }, [market.enabled, market.autoRefresh, query, slug, targetDateMs, refresh])

  const matched = useMemo(() => {
    if (!snapshot || !result?.ok) return null
    return matchOutcomesToDrivers(result.outcomes, snapshot.drivers)
  }, [snapshot, result])

  const eventClosed = !!result?.event?.closed

  useEffect(() => {
    setSyncOdds(eventClosed)
  }, [result?.event?.slug, eventClosed])

  // Wall-clock instant of the synced race moment (for replay-synced odds).
  const momentUnix = targetDateMs != null
    ? targetDateMs / 1000 + effectiveDataTime
    : null

  // Closed markets retain replay data more reliably when Polymarket receives an
  // absolute time window around the session rather than interval=max.
  useEffect(() => {
    if (!syncOdds || !matched) return
    for (const o of matched.byDriver.values()) {
      if (o.yesTokenId) void loadHistory(o.yesTokenId, momentUnix ?? undefined)
    }
  }, [syncOdds, matched, loadHistory, momentUnix])

  const replayFairByDriver = useMemo(() => {
    if (!syncOdds || !matched || momentUnix == null) return new Map<number, number>()
    const tokens = [...matched.byDriver]
      .filter((entry): entry is [number, typeof entry[1] & { yesTokenId: string }] => !!entry[1].yesTokenId)
      .map(([driverNumber, outcome]) => ({ driverNumber, yesTokenId: outcome.yesTokenId }))
    return normalizeReplayMarketPrices(tokens, historyByToken, historyErrorByToken, momentUnix)
  }, [syncOdds, matched, momentUnix, historyByToken, historyErrorByToken])

  if (!snapshot) {
    return (
      <WidgetFrame title="Win Probability" icon={<Trophy />}>
        <EmptyState icon={<Trophy />} title="No session loaded" />
      </WidgetFrame>
    )
  }

  if (!model?.available) {
    return (
      <WidgetFrame title="Win Probability" icon={<Trophy />}>
        <EmptyState
          icon={<Trophy />}
          title="No win projection yet"
          hint={model?.reason ?? 'Needs a race with classified runners and gaps.'}
        />
      </WidgetFrame>
    )
  }

  const chances = [...model.chances].sort((a, b) => pctOf(b, metric) - pctOf(a, metric)).slice(0, 10)
  const maxPct = Math.max(1, ...chances.map((c) => pctOf(c, metric)))

  const marketProb = (
    driverNumber: number
  ): { live: number | null; moment: number | null; loading: boolean; error: string | null } => {
    const o = matched?.byDriver.get(driverNumber)
    if (!o) return { live: null, moment: null, loading: false, error: null }
    const moment = replayFairByDriver.get(driverNumber) ?? null
    // Both live and replay prices are normalized across the matched driver field.
    return {
      live: o.fairProbability,
      moment,
      loading: o.yesTokenId ? !!historyLoading[o.yesTokenId] : false,
      error: o.yesTokenId ? historyErrorByToken[o.yesTokenId] ?? null : 'No history token.'
    }
  }

  return (
    <WidgetFrame
      title="Win Probability"
      icon={<Trophy />}
      actions={
        <div className="flex items-center gap-1.5">
          {market.enabled && matched && (
            <button
              onClick={() => setSyncOdds((v) => !v)}
              title="Read market odds at the synced race moment (loads price history)"
              className={cn(
                'no-drag inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium transition-colors',
                syncOdds
                  ? 'border-purple/40 bg-purple/15 text-purple'
                  : 'border-hairline/30 text-fg-subtle hover:text-fg'
              )}
            >
              <History className="h-3 w-3" /> Sync
            </button>
          )}
          <Segmented value={metric} options={METRIC_OPTS} onChange={setMetric} />
        </div>
      }
    >
      <div className="space-y-2.5">
        {/* Source / status strip */}
        <div className="flex items-center justify-between gap-2 text-2xs">
          <div className="flex items-center gap-1.5 text-fg-subtle">
            <span className="rounded bg-white/5 px-1.5 py-0.5 font-medium text-fg-muted">Model</span>
            <span>
              Lap {snapshot.currentLap ?? '—'}
              {snapshot.totalLaps ? `/${snapshot.totalLaps}` : ''}
              {model.lapsRemaining != null ? ` · ${model.lapsRemaining} to go` : ''}
            </span>
            <Badge tone={model.dataQuality === 'high' ? 'good' : model.dataQuality === 'medium' ? 'warn' : 'neutral'}>
              {model.dataQuality.toUpperCase()} · {model.confidencePct.toFixed(0)}%
            </Badge>
            {model.neutralized && <Badge tone="warn">Neutralized</Badge>}
          </div>
          <MarketStatus
            enabled={market.enabled}
            loading={loading}
            error={error}
            hasResult={!!result?.ok}
            matchedCount={matched ? matched.byDriver.size : 0}
            unmatchedCount={matched?.unmatched.length ?? 0}
            title={result?.event?.title ?? null}
            closed={eventClosed}
            replayOdds={syncOdds}
            onRefresh={() => void refresh({ query, slug, targetDateMs })}
            onSettings={() => setRoute('settings')}
          />
        </div>

        {/* Driver rows */}
        <div className="space-y-1">
          {chances.map((c) => {
            const pct = pctOf(c, metric)
            const mkt = market.enabled
              ? marketProb(c.driverNumber)
              : { live: null, moment: null, loading: false, error: null }
            const shown = syncOdds ? mkt.moment : mkt.live
            const marketPct = shown != null ? shown * 100 : null
            const edge = marketPct != null ? pct - marketPct : null
            const color = hexColor(c.teamColour)
            const isFocus = c.driverNumber === focus
            return (
              <button
                key={c.driverNumber}
                onClick={() => pickDriver(c.driverNumber)}
                className={cn(
                  'group flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors',
                  isFocus
                    ? 'border-accent/40 bg-accent/5'
                    : 'border-transparent hover:border-hairline/30 hover:bg-white/[0.03]'
                )}
              >
                <span className="tnum w-5 shrink-0 text-center text-2xs font-semibold text-fg-subtle">
                  {c.position ?? '—'}
                </span>
                <span
                  className="h-4 w-[3px] shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate text-xs font-semibold text-fg">{c.code}</span>
                      <span
                        className="tnum shrink-0 text-2xs text-fg-subtle"
                        title="Expected championship points (full finishing distribution × the points table)"
                      >
                        {c.expectedPoints.toFixed(1)} xPts
                      </span>
                      {c.dnfPct >= 5 && (
                        <span
                          className="tnum shrink-0 text-2xs text-warn/70"
                          title="Estimated chance of not finishing (reliability) over the remaining laps"
                        >
                          {c.dnfPct.toFixed(0)}% DNF
                        </span>
                      )}
                    </span>
                    <span
                      className="tnum shrink-0 text-xs font-bold text-fg"
                      title={metric === 'points' ? 'Estimated chance of finishing in a points-paying position' : undefined}
                    >
                      {formatPct(pct)}
                    </span>
                  </div>
                  {/* model bar */}
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, (pct / maxPct) * 100)}%`,
                        backgroundColor: color,
                        opacity: isFocus ? 1 : 0.85
                      }}
                    />
                  </div>
                  {c.factors.length > 0 && (
                    <div className="mt-1 flex min-w-0 gap-1 overflow-hidden">
                      {c.factors.slice(0, 2).map((factor) => (
                        <span
                          key={factor}
                          className="truncate rounded border border-hairline/20 bg-black/20 px-1 py-0.5 text-[9px] text-fg-subtle"
                        >
                          {factor}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* market row */}
                  {marketPct != null && (
                    <div className="mt-1 flex items-center gap-1.5 text-2xs">
                      <span className="flex items-center gap-0.5 text-fg-subtle">
                        <Radio className="h-2.5 w-2.5" />
                        {syncOdds ? 'Replay odds' : eventClosed ? 'Final market' : 'Live market'}
                      </span>
                      <span className="tnum font-medium text-fg-muted">{formatPct(marketPct)}</span>
                      {edge != null && Math.abs(edge) >= 1 && (
                        <span
                          className={cn(
                            'inline-flex items-center gap-0.5 tnum font-medium',
                            edge > 0 ? 'text-good' : 'text-danger'
                          )}
                          title="Model minus market — positive = model rates them higher than the market"
                        >
                          {edge > 0 ? (
                            <TrendingUp className="h-2.5 w-2.5" />
                          ) : (
                            <TrendingDown className="h-2.5 w-2.5" />
                          )}
                          {edge > 0 ? '+' : ''}
                          {edge.toFixed(0)}
                        </span>
                      )}
                    </div>
                  )}
                  {market.enabled && matched?.byDriver.has(c.driverNumber) && syncOdds && marketPct == null && (
                    <div className="mt-1 flex items-center gap-1 text-[9px] text-fg-subtle">
                      {mkt.loading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <History className="h-2.5 w-2.5" />}
                      <span>{mkt.loading ? 'Loading replay odds…' : mkt.error ?? 'No replay price at this moment'}</span>
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <p className="pt-0.5 text-[10px] leading-snug text-fg-subtle">
          Model estimate from track position, gaps, pace &amp; laps remaining — not a prediction. xPts =
          expected championship points; DNF = reliability risk.
          {market.enabled &&
            ` Market odds are public Polymarket data (third-party); ${
              syncOdds ? 'historical prices are read at this replay moment.' : 'live prices are de-vigged for comparison.'
            }`}
        </p>
      </div>
    </WidgetFrame>
  )
}

function MarketStatus({
  enabled,
  loading,
  error,
  hasResult,
  matchedCount,
  unmatchedCount,
  title,
  closed,
  replayOdds,
  onRefresh,
  onSettings
}: {
  enabled: boolean
  loading: boolean
  error: string | null
  hasResult: boolean
  matchedCount: number
  unmatchedCount: number
  title: string | null
  closed: boolean
  replayOdds: boolean
  onRefresh: () => void
  onSettings: () => void
}) {
  if (!enabled) {
    return (
      <button
        onClick={onSettings}
        title="Enable Polymarket win odds in Settings"
        className="no-drag inline-flex items-center gap-1 rounded-md border border-hairline/30 px-1.5 py-0.5 text-2xs text-fg-subtle hover:text-fg"
      >
        <Settings2 className="h-3 w-3" /> Add market
      </button>
    )
  }
  if (loading && !hasResult) {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-fg-subtle">
        <Loader2 className="h-3 w-3 animate-spin" /> Polymarket…
      </span>
    )
  }
  if (error && !hasResult) {
    return (
      <button
        onClick={onRefresh}
        title={error}
        className="no-drag inline-flex items-center gap-1 rounded-md border border-warn/30 px-1.5 py-0.5 text-2xs text-warn/90 hover:bg-warn/5"
      >
        <RefreshCw className="h-3 w-3" /> No market
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <StatusDot tone={matchedCount === 0 ? 'warn' : closed ? 'neutral' : 'good'} pulse={!closed && matchedCount > 0} />
      <span
        className="max-w-[120px] truncate text-2xs text-fg-muted"
        title={title ? `${title}${closed ? ' (final)' : ' (live)'}` : 'Polymarket'}
      >
        {matchedCount
          ? `${replayOdds ? 'Replay' : closed ? 'Final' : 'Market'} · ${matchedCount}${unmatchedCount ? `/${matchedCount + unmatchedCount}` : ''}`
          : 'No driver match'}
      </span>
      <button onClick={onRefresh} title="Refresh odds" className="no-drag text-fg-subtle hover:text-fg">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
      </button>
    </div>
  )
}
