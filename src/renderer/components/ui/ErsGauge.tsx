import { BatteryCharging, Battery, TrendingDown, TrendingUp, Minus, Zap, Gauge } from 'lucide-react'
import type { EnergyMode } from '@shared/models'
import { cn, formatStaleness } from '@renderer/lib/utils'

const TREND_META: Record<
  'charging' | 'stable' | 'draining',
  { readonly Icon: typeof TrendingUp; readonly tone: string; readonly label: string }
> = {
  charging: { Icon: TrendingUp, tone: 'text-good', label: 'charging' },
  stable: { Icon: Minus, tone: 'text-fg-subtle', label: 'stable' },
  draining: { Icon: TrendingDown, tone: 'text-danger', label: 'draining' }
}

/** CarData is a ~1 Hz high-rate feed; this many quiet ms means it stopped. */
const CARDATA_STALE_MS = 5_000

/**
 * Battery UI for the 2026 (~50%-electric) power unit: estimated state of charge + the
 * current deployment mode. `ErsBar` is the compact timing-tower cell; `ErsGauge`
 * is the detailed focused-driver readout. Real sessions are explicitly marked as estimates because
 * the public F1 feed does not expose battery state of charge.
 */

export const MODE_META: Record<EnergyMode, { label: string; short: string; tone: string }> = {
  HARVEST: { label: 'Harvesting', short: 'HRV', tone: 'text-sky-400' },
  BALANCED: { label: 'Balanced', short: 'BAL', tone: 'text-fg-muted' },
  DEPLOY: { label: 'Deploying', short: 'DEP', tone: 'text-good' },
  BOOST: { label: 'Boost', short: 'BST', tone: 'text-sky-400' },
  OVERTAKE: { label: 'Overtake', short: 'OT', tone: 'text-accent' }
}

type SocTone = {
  readonly color: string
  readonly textClass: string
}

/** Theme-aware charge tone: green high, amber mid, red low. */
function socTone(pct: number): SocTone {
  if (pct >= 55) return { color: 'rgb(var(--good))', textClass: 'text-good' }
  if (pct >= 25) return { color: 'rgb(var(--warn))', textClass: 'text-warn' }
  return { color: 'rgb(var(--danger))', textClass: 'text-danger' }
}

export type ErsConfidenceLevel = 'low' | 'medium' | 'high'

/**
 * How the estimate is qualified in the UI. A `low`-confidence reading is still
 * mostly the seed assumption, so it is shown differently from a settled one
 * rather than presented with the same authority.
 */
const CONFIDENCE_META: Record<ErsConfidenceLevel, { label: string; blurb: string }> = {
  low: {
    label: 'warming up',
    blurb: 'Only a few telemetry frames so far — this is still close to the starting assumption.'
  },
  medium: {
    label: 'settling',
    blurb: 'Enough telemetry to move off the starting assumption, but still refining.'
  },
  high: { label: 'settled', blurb: 'A full run of telemetry is behind this estimate.' }
}

/** Explanation shown when this lap's deployment allowance is spent. */
const DEPLOYMENT_LIMITED_BLURB =
  "This lap's deployment allowance is used up, so the car is on reserve deployment until it crosses the line."

/** Compact battery bar for a timing-tower row. */
export function ErsBar({
  pct,
  mode,
  estimate,
  confidence,
  deploymentLimited,
  staleMs
}: {
  pct: number | null
  mode: EnergyMode | null
  estimate?: boolean
  confidence?: ErsConfidenceLevel | null
  deploymentLimited?: boolean
  /** Ms since CarData last updated (live sessions only); undefined outside live. */
  staleMs?: number | null
}) {
  const stale = formatStaleness(staleMs, CARDATA_STALE_MS)
  if (pct == null) {
    return (
      <div
        className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md border border-hairline/30 bg-black/15 px-1.5 text-[8px] font-bold tracking-wide text-fg-subtle"
        title="Battery and deployment unavailable — this timing source does not expose enough telemetry"
      >
        <Battery className="h-2.5 w-2.5" /> BAT — · MODE —
      </div>
    )
  }
  const tone = socTone(pct)
  const attack = mode === 'BOOST' || mode === 'OVERTAKE'
  const meta = mode ? MODE_META[mode] : null
  // A reading that is still mostly the seed assumption is dimmed rather than
  // shown with the same authority as a settled one.
  const unsettled = estimate === true && confidence === 'low'
  const title = [
    `Battery ${estimate ? '~' : ''}${Math.round(pct)}%${mode ? ` · ${MODE_META[mode].label}` : ''}`,
    estimate
      ? "estimated from throttle/braking patterns — F1's public feed has no battery data"
      : null,
    estimate && confidence ? CONFIDENCE_META[confidence].blurb : null,
    deploymentLimited ? DEPLOYMENT_LIMITED_BLURB : null
  ]
    .filter((part): part is string => part != null)
    .join(' · ')
  return (
    <div
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-md border bg-black/15 px-1.5',
        attack ? 'border-accent/45' : 'border-hairline/30'
      )}
      title={title}
    >
      <Battery className={cn('h-2.5 w-2.5', tone.textClass)} />
      <div className="relative h-2.5 w-5 overflow-hidden rounded-[3px] border border-hairline/50 bg-black/25">
        <div
          className={cn('absolute inset-y-0 left-0', unsettled && 'opacity-50')}
          style={{ width: `${pct}%`, backgroundColor: tone.color }}
        />
      </div>
      <span
        className={cn('tnum text-[9px] font-semibold', tone.textClass, unsettled && 'opacity-60')}
      >
        {estimate ? '~' : ''}
        {Math.round(pct)}%
      </span>
      {deploymentLimited && (
        // The bare percentage cannot explain itself; this says WHY it is flat.
        <span className="rounded bg-warn/10 px-1 py-px text-[8px] font-bold tracking-wide text-warn">
          LIM
        </span>
      )}
      {stale && (
        <span
          className="rounded bg-danger/10 px-1 py-px text-[8px] font-bold tracking-wide text-danger"
          title={`${stale} — telemetry has stopped updating, this reading may no longer be current`}
        >
          STALE
        </span>
      )}
      {meta && (
        <span
          className={cn(
            'rounded px-1 py-px text-[8px] font-bold tracking-wide',
            meta.tone,
            attack ? 'bg-accent/10' : 'bg-white/[0.04]'
          )}
        >
          {meta.short}
        </span>
      )}
    </div>
  )
}

/** Detailed battery readout for the focused-driver dossier. */
export function ErsGauge({
  pct,
  mode,
  estimate,
  confidence,
  deploymentLimited,
  staleMs,
  trend,
  trendDeltaPct,
  deployBudgetPct
}: {
  pct: number | null
  mode: EnergyMode | null
  estimate?: boolean
  confidence?: ErsConfidenceLevel | null
  deploymentLimited?: boolean
  /** Ms since CarData last updated (live sessions only); undefined outside live. */
  staleMs?: number | null
  /** Direction of recent battery change, from `deriveEnergyTrend`. */
  trend?: 'charging' | 'stable' | 'draining'
  /** Percentage-point change behind `trend`; null/undefined without enough history. */
  trendDeltaPct?: number | null
  /** Percentage of this lap's deployment allowance still unspent, 0-100. */
  deployBudgetPct?: number
}) {
  const stale = formatStaleness(staleMs, CARDATA_STALE_MS)
  if (pct == null) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-hairline/25 bg-white/[0.02] px-2.5 py-2 text-2xs text-fg-subtle">
        <Battery className="h-4 w-4" /> Battery unavailable — this timing source does not expose
        state of charge
      </div>
    )
  }
  const tone = socTone(pct)
  const m = mode ? MODE_META[mode] : null
  const Icon =
    mode === 'OVERTAKE' || mode === 'BOOST' || mode === 'DEPLOY'
      ? Zap
      : mode === 'HARVEST'
        ? BatteryCharging
        : Gauge
  const quality = estimate === true && confidence != null ? CONFIDENCE_META[confidence] : null
  const unsettled = confidence === 'low' && estimate === true
  return (
    <div className="rounded-lg border border-hairline/25 bg-white/[0.02] p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-fg-muted">
          <Battery className="h-3.5 w-3.5" /> Battery
          {stale && (
            <span
              className="rounded bg-danger/10 px-1 text-[9px] font-bold normal-case tracking-normal text-danger"
              title={`${stale} — telemetry has stopped updating, this reading may no longer be current`}
            >
              {stale}
            </span>
          )}
          {estimate && (
            <span
              className="rounded bg-white/5 px-1 text-[9px] font-medium normal-case tracking-normal text-fg-subtle"
              title="Estimated from throttle/braking patterns — F1's public feed has no battery data"
            >
              est.
            </span>
          )}
          {/* An estimate that has barely started is labelled as such, so a
              number close to the seed is never read as a measured value. */}
          {quality && (
            <span
              className={cn(
                'rounded px-1 text-[9px] font-medium normal-case tracking-normal',
                unsettled ? 'bg-warn/10 text-warn' : 'bg-white/5 text-fg-subtle'
              )}
              title={quality.blurb}
            >
              {quality.label}
            </span>
          )}
        </span>
        {m && (
          <span className={cn('flex items-center gap-1 text-2xs font-bold', m.tone)}>
            <Icon className="h-3 w-3" /> {m.label}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-black/20 ring-1 ring-hairline/25">
          <div
            className={cn(
              'absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 motion-reduce:transition-none',
              unsettled && 'opacity-50'
            )}
            style={{ width: `${pct}%`, backgroundColor: tone.color }}
          />
        </div>
        <span
          className={cn(
            'tnum w-10 text-right text-sm font-bold',
            tone.textClass,
            unsettled && 'opacity-70'
          )}
        >
          {estimate ? '~' : ''}
          {Math.round(pct)}%
        </span>
        {trend &&
          (() => {
            const trendMeta = TREND_META[trend]
            const TrendIcon = trendMeta.Icon
            return (
              <span
                className={cn('flex items-center gap-0.5 text-2xs font-semibold', trendMeta.tone)}
                title={
                  trendDeltaPct != null
                    ? `${trendMeta.label}, ${trendDeltaPct > 0 ? '+' : ''}${trendDeltaPct.toFixed(1)}pts over the last ~8s`
                    : trendMeta.label
                }
              >
                <TrendIcon className="h-3 w-3" />
                {trendDeltaPct != null && (
                  <span className="tnum">
                    {trendDeltaPct > 0 ? '+' : ''}
                    {Math.round(trendDeltaPct)}
                  </span>
                )}
              </span>
            )
          })()}
      </div>
      {deployBudgetPct != null && (
        <div
          className="mt-1.5 flex items-center gap-2"
          title="Deployment allowance remaining for the current lap"
        >
          <span className="w-14 shrink-0 text-[9px] uppercase tracking-wide text-fg-subtle">
            Lap deploy
          </span>
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-black/20 ring-1 ring-hairline/25">
            <div
              className={cn(
                'absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 motion-reduce:transition-none',
                deployBudgetPct <= 0 ? 'bg-danger/70' : 'bg-accent/60'
              )}
              style={{ width: `${deployBudgetPct}%` }}
            />
          </div>
          <span className="tnum w-8 shrink-0 text-right text-[10px] font-semibold text-fg-muted">
            {Math.round(deployBudgetPct)}%
          </span>
        </div>
      )}
      {/* A flat, low battery is otherwise unexplainable from the bar alone. */}
      {deploymentLimited && (
        <p
          className="mt-1.5 flex items-start gap-1 text-[10px] leading-snug text-warn/90"
          title={DEPLOYMENT_LIMITED_BLURB}
        >
          <Zap className="mt-px h-2.5 w-2.5 shrink-0" />
          Lap deployment allowance spent — on reserve until the next lap.
        </p>
      )}
    </div>
  )
}
