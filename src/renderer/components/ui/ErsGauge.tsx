import { BatteryCharging, Battery, Zap, Gauge } from 'lucide-react'
import type { EnergyMode } from '@shared/models'
import { cn } from '@renderer/lib/utils'

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

/** Charge-level colour: green high, amber mid, red low. */
function socColor(pct: number): string {
  if (pct >= 55) return '#22c55e'
  if (pct >= 25) return '#f59e0b'
  return '#ef4444'
}

/** Compact battery bar for a timing-tower row. */
export function ErsBar({
  pct,
  mode,
  estimate
}: {
  pct: number | null
  mode: EnergyMode | null
  estimate?: boolean
}) {
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
  const color = socColor(pct)
  const attack = mode === 'BOOST' || mode === 'OVERTAKE'
  const meta = mode ? MODE_META[mode] : null
  return (
    <div
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-md border bg-black/15 px-1.5',
        attack ? 'border-accent/45' : 'border-hairline/30'
      )}
      title={`Battery ${estimate ? '~' : ''}${Math.round(pct)}%${mode ? ` · ${MODE_META[mode].label}` : ''}${
        estimate ? " · estimated from throttle/braking patterns — F1's public feed has no battery data" : ''
      }`}
    >
      <Battery className="h-2.5 w-2.5" style={{ color }} />
      <div
        className="relative h-2.5 w-5 overflow-hidden rounded-[3px] border border-hairline/50 bg-black/25"
      >
        <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="tnum text-[9px] font-semibold" style={{ color }}>
        {estimate ? '~' : ''}{Math.round(pct)}%
      </span>
      {meta && (
        <span className={cn('rounded px-1 py-px text-[8px] font-bold tracking-wide', meta.tone, attack ? 'bg-accent/10' : 'bg-white/[0.04]')}>
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
  estimate
}: {
  pct: number | null
  mode: EnergyMode | null
  estimate?: boolean
}) {
  if (pct == null) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-hairline/25 bg-white/[0.02] px-2.5 py-2 text-2xs text-fg-subtle">
        <Battery className="h-4 w-4" /> Battery unavailable — this timing source does not expose state of charge
      </div>
    )
  }
  const color = socColor(pct)
  const m = mode ? MODE_META[mode] : null
  const Icon = mode === 'OVERTAKE' || mode === 'BOOST' || mode === 'DEPLOY' ? Zap : mode === 'HARVEST' ? BatteryCharging : Gauge
  return (
    <div className="rounded-lg border border-hairline/25 bg-white/[0.02] p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-fg-muted">
          <Battery className="h-3.5 w-3.5" /> Battery
          {estimate && (
            <span
              className="rounded bg-white/5 px-1 text-[9px] font-medium normal-case tracking-normal text-fg-subtle"
              title="Estimated from throttle/braking patterns — F1's public feed has no battery data"
            >
              est.
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
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
        <span className="tnum w-10 text-right text-sm font-bold" style={{ color }}>
          {Math.round(pct)}%
        </span>
      </div>
    </div>
  )
}
