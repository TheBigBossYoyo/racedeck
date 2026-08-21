import { useMemo } from 'react'
import { Gauge, ArrowRight, TrendingDown, TrendingUp, Minus, CornerDownRight, Flag } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Badge } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useFocusDriver, pickDriver } from '@renderer/lib/useFocusDriver'
import { StrategyEngine, type PitVerdict, type RejoinCar } from '@renderer/core/engines/StrategyEngine'
import { cn, hexColor } from '@renderer/lib/utils'

const VERDICT_TONE: Record<PitVerdict, { text: string; ring: string; bg: string }> = {
  'BOX NOW': { text: 'text-good', ring: 'ring-good/40', bg: 'bg-good/10' },
  'UNDERCUT NOW': { text: 'text-accent', ring: 'ring-accent/40', bg: 'bg-accent/10' },
  'BOX SOON': { text: 'text-warn', ring: 'ring-warn/40', bg: 'bg-warn/10' },
  PREPARE: { text: 'text-warn', ring: 'ring-warn/30', bg: 'bg-warn/5' },
  'STAY OUT': { text: 'text-fg', ring: 'ring-hairline/40', bg: 'bg-white/[0.03]' }
}

const WINDOW = 4.5 // seconds each side of the rejoin point shown on the lane

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-hairline/20 bg-black/20 px-2 py-1.5">
      <div className="text-2xs uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className={cn('tnum text-sm font-semibold', tone ?? 'text-fg')}>{value}</div>
    </div>
  )
}

export function PitStopPredictor() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const getDriverLaps = useSessionStore((s) => s.getDriverLaps)
  const driver = useFocusDriver()

  const prediction = useMemo(() => {
    if (!snapshot || driver == null) return null
    return StrategyEngine.predictPitStop(snapshot, driver, getDriverLaps(driver))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, driver])

  const driverMeta = useMemo(
    () => new Map((snapshot?.drivers ?? []).map((d) => [d.number, d])),
    [snapshot]
  )

  if (!snapshot) {
    return (
      <WidgetFrame title="Pit-Now Simulator" icon={<Gauge />}>
        <EmptyState icon={<Gauge />} title="No session loaded" hint="Load a race to project pit stops." />
      </WidgetFrame>
    )
  }

  const pickList = snapshot.timing.slice(0, 20)
  const color = (n: number) => hexColor(driverMeta.get(n)?.teamColour ?? null)

  const pick = (n: number) => pickDriver(n)

  return (
    <WidgetFrame
      title="Pit-Now Simulator"
      icon={<Gauge />}
      subtitle="estimate"
      actions={<Badge tone="warn">projection</Badge>}
      bodyClassName="flex flex-col gap-2.5"
    >
      {/* Driver picker */}
      <div className="no-drag relative z-20 -mx-1 flex shrink-0 gap-1 overflow-x-auto overflow-y-hidden px-1 pb-1">
        {pickList.map((t) => {
          const active = t.driverNumber === driver
          return (
            <button
              key={t.driverNumber}
              onClick={() => pick(t.driverNumber)}
              aria-pressed={active}
              className={cn(
                'relative z-10 flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-bold transition-colors',
                active
                  ? 'border-accent/50 bg-accent/15 text-fg'
                  : 'border-hairline/25 text-fg-muted hover:bg-white/5'
              )}
            >
              <span className="h-3 w-[3px] rounded-full" style={{ backgroundColor: color(t.driverNumber) }} />
              <span className="tnum text-fg-subtle">{t.position}</span>
              {driverMeta.get(t.driverNumber)?.code ?? t.driverNumber}
            </button>
          )
        })}
      </div>

      {!prediction || !prediction.available ? (
        <EmptyState
          title="Projection unavailable"
          hint={prediction?.reason ?? 'Interval/gap data is needed to project a pit stop for this driver.'}
        />
      ) : (
        <PredictionBody
          prediction={prediction}
          colorOf={color}
          codeOf={(n) => driverMeta.get(n)?.code ?? `#${n}`}
        />
      )}
    </WidgetFrame>
  )
}

function PredictionBody({
  prediction: p,
  colorOf,
  codeOf
}: {
  prediction: NonNullable<ReturnType<typeof StrategyEngine.predictPitStop>>
  colorOf: (n: number) => string
  codeOf: (n: number) => string
}) {
  const tone = VERDICT_TONE[p.verdict]
  const lost = p.positionsLost ?? 0
  const posIcon =
    lost > 0 ? <TrendingDown className="h-3.5 w-3.5 text-danger" /> : lost < 0 ? <TrendingUp className="h-3.5 w-3.5 text-good" /> : <Minus className="h-3.5 w-3.5 text-fg-subtle" />

  return (
    <>
      {/* Verdict + position swing hero */}
      <div className={cn('flex items-stretch gap-2 rounded-xl p-2.5 ring-1', tone.bg, tone.ring)}>
        <div className="flex flex-col justify-center">
          <div className="text-2xs uppercase tracking-wide text-fg-subtle">Engine call</div>
          <div className={cn('text-lg font-extrabold leading-tight tracking-tight', tone.text)}>
            {p.verdict}
          </div>
          <div className="mt-0.5 flex items-center gap-1">
            <Badge tone={p.confidence === 'high' ? 'good' : p.confidence === 'medium' ? 'warn' : 'neutral'}>
              {p.confidence}
            </Badge>
            <Badge tone="neutral">EST</Badge>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 rounded-lg bg-black/25 px-3">
          <div className="text-center">
            <div className="text-2xs text-fg-subtle">now</div>
            <div className="tnum text-xl font-bold text-fg">P{p.currentPosition}</div>
          </div>
          <ArrowRight className="h-4 w-4 text-fg-subtle" />
          <div className="text-center">
            <div className="text-2xs text-fg-subtle">rejoin</div>
            <div className={cn('tnum text-xl font-bold', tone.text)}>P{p.projectedPosition}</div>
          </div>
          <div className="flex items-center gap-0.5 pl-1">
            {posIcon}
            <span className="tnum text-xs font-semibold text-fg-muted">
              {lost > 0 ? `-${lost}` : lost < 0 ? `+${-lost}` : '±0'}
            </span>
          </div>
        </div>
      </div>

      {/* Key numbers */}
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Pit loss" value={`~${p.pitLossSec.toFixed(0)}s`} tone={p.underNeutralization ? 'text-good' : undefined} />
        <Stat
          label="Chase ahead"
          value={p.gapToChaseAheadSec != null ? `+${p.gapToChaseAheadSec.toFixed(1)}s` : 'clear'}
        />
        <Stat
          label="Clear behind"
          value={p.clearAirBehindSec != null ? `${p.clearAirBehindSec.toFixed(1)}s` : '—'}
        />
      </div>

      {/* Rejoin lane visualizer */}
      <RejoinLane prediction={p} colorOf={colorOf} />

      {/* Undercut line */}
      {p.intervalToCarAheadSec != null && p.carAhead != null && (
        <div className="flex items-center gap-2 rounded-lg border border-hairline/20 bg-white/[0.02] px-2.5 py-1.5">
          <CornerDownRight className="h-3.5 w-3.5 text-accent" />
          <span className="text-[11px] text-fg-muted">
            Undercut vs <span className="font-semibold text-fg">{codeOf(p.carAhead)}</span>
          </span>
          <span className="tnum ml-auto text-[11px] font-semibold text-fg">
            net {p.undercutNetSec! >= 0 ? '+' : ''}
            {p.undercutNetSec!.toFixed(1)}s
          </span>
          <Badge tone={p.undercutViable ? 'good' : 'neutral'}>{p.undercutViable ? 'works' : 'short'}</Badge>
        </div>
      )}

      {/* Rationale */}
      <ul className="space-y-1">
        {p.rationale.map((r, i) => (
          <li key={i} className="flex gap-1.5 text-[11px] leading-snug text-fg-muted">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent/60" />
            {r}
          </li>
        ))}
      </ul>

      <p className="text-2xs text-fg-subtle">
        Projection assumes rivals hold station · pit loss ~{p.greenPitLossSec.toFixed(0)}s green ·
        recover in ~{p.recoveryLaps?.toFixed(0)} laps of fresh-tyre pace. All figures are estimates.
      </p>
    </>
  )
}

/** Horizontal "road" showing where the driver slots back in vs nearby cars. */
function RejoinLane({
  prediction: p,
  colorOf
}: {
  prediction: NonNullable<ReturnType<typeof StrategyEngine.predictPitStop>>
  colorOf: (n: number) => string
}) {
  // Position a car by its seconds relative to the rejoin point (− ahead, + behind).
  const posPct = (rel: number) => 50 - (Math.max(-WINDOW, Math.min(WINDOW, rel)) / WINDOW) * 46
  const cars: RejoinCar[] = p.traffic

  return (
    <div className="rounded-lg border border-hairline/20 bg-black/25 p-2">
      <div className="mb-1 flex items-center justify-between text-2xs text-fg-subtle">
        <span className="flex items-center gap-1">
          <Flag className="h-3 w-3" /> ahead on road
        </span>
        <span>rejoin traffic (±{WINDOW}s)</span>
        <span>behind</span>
      </div>
      <div className="relative h-9">
        {/* lane line */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-hairline/40" />
        {/* rejoin marker (the driver, fresh tyres) */}
        <div className="absolute left-1/2 top-0 flex h-full -translate-x-1/2 flex-col items-center">
          <div className="h-full w-px bg-accent/60" />
          <div className="absolute -top-0.5 rounded bg-accent px-1 py-0.5 text-[9px] font-bold text-black shadow-glow">
            {p.code}
          </div>
        </div>
        {/* traffic chips */}
        {cars.map((c) => (
          <div
            key={c.driverNumber}
            className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            style={{ left: `${posPct(c.relativeToRejoin)}%` }}
            title={`${c.code} ${c.relativeToRejoin >= 0 ? '+' : ''}${c.relativeToRejoin.toFixed(1)}s · ${c.compound ?? '?'} (${c.stintAge ?? '?'} laps)`}
          >
            <span
              className="grid h-4 min-w-4 place-items-center rounded border px-0.5 text-[9px] font-bold text-fg"
              style={{ borderColor: colorOf(c.driverNumber), backgroundColor: `${colorOf(c.driverNumber)}22` }}
            >
              {c.code}
            </span>
            <span className="tnum mt-0.5 text-[8px] text-fg-subtle">
              {c.relativeToRejoin >= 0 ? '+' : ''}
              {c.relativeToRejoin.toFixed(1)}
            </span>
          </div>
        ))}
        {cars.length === 0 && (
          <div className="absolute inset-0 grid place-items-center text-2xs text-fg-subtle">
            clear air on rejoin
          </div>
        )}
      </div>
    </div>
  )
}
