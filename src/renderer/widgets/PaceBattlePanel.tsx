import { Swords, ChevronsUp, ChevronsDown, Minus, Crosshair, ShieldAlert } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Badge } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useFocusDriver, pickDriver } from '@renderer/lib/useFocusDriver'
import { paceComparison, type PaceRival } from '@renderer/core/engines/StrategyEngine'
import { hexColor, cn } from '@renderer/lib/utils'

function RivalCard({
  rival,
  side,
  colorOf
}: {
  rival: PaceRival | null
  side: 'ahead' | 'behind'
  colorOf: (n: number) => string
}) {
  if (!rival) {
    return (
      <div className="rounded-lg border border-dashed border-hairline/25 px-2.5 py-2 text-center text-2xs text-fg-subtle">
        {side === 'ahead' ? 'Race leader — clear ahead' : 'Last runner — clear behind'}
      </div>
    )
  }
  const rate = rival.deltaPerLap
  // For the car ahead, "closing" = we're catching. For behind, "closing" = threat.
  const tone = rival.closing ? (side === 'ahead' ? 'good' : 'danger') : 'neutral'
  const Icon = side === 'ahead' ? Crosshair : ShieldAlert
  const trendIcon = rate == null ? <Minus className="h-3 w-3" /> : rate > 0.03 ? <ChevronsUp className="h-3 w-3" /> : rate < -0.03 ? <ChevronsDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />

  const verb =
    rate == null
      ? 'pace unknown'
      : side === 'ahead'
        ? rate > 0.03
          ? `catching · ${rate.toFixed(2)}s/lap faster`
          : rate < -0.03
            ? `dropping · ${Math.abs(rate).toFixed(2)}s/lap slower`
            : 'matched pace'
        : rate > 0.03
          ? `closing · ${rate.toFixed(2)}s/lap faster`
          : rate < -0.03
            ? `dropping back · ${Math.abs(rate).toFixed(2)}s/lap slower`
            : 'matched pace'

  const toneClass =
    tone === 'good' ? 'border-good/30 bg-good/[0.06]' : tone === 'danger' ? 'border-danger/30 bg-danger/[0.06]' : 'border-hairline/20 bg-white/[0.015]'

  return (
    <button
      onClick={() => pickDriver(rival.number)}
      className={cn('w-full rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:brightness-110', toneClass)}
    >
      <div className="flex items-center gap-2">
        <span className="grid h-4 w-4 place-items-center rounded text-fg-subtle">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="h-3.5 w-[3px] rounded-full" style={{ backgroundColor: colorOf(rival.number) }} />
        <span className="text-xs font-bold text-fg">{rival.code}</span>
        <span className="tnum ml-auto text-xs font-semibold text-fg">
          {rival.gapSec != null ? `${rival.gapSec.toFixed(1)}s` : '—'}
        </span>
      </div>
      <div className={cn('mt-0.5 flex items-center gap-1 pl-6 text-2xs', tone === 'good' ? 'text-good' : tone === 'danger' ? 'text-danger' : 'text-fg-muted')}>
        {trendIcon}
        <span>{verb}</span>
        {rival.closing && rival.lapsToResolve != null && (
          <Badge tone={tone === 'good' ? 'good' : 'danger'} className="ml-auto">
            ~{Math.ceil(rival.lapsToResolve)} laps
          </Badge>
        )}
      </div>
    </button>
  )
}

export function PaceBattlePanel() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const driver = useFocusDriver()

  if (!snapshot || driver == null) {
    return (
      <WidgetFrame title="Pace Battle" icon={<Swords />}>
        <EmptyState icon={<Swords />} title="No driver in focus" hint="Pick a driver to see how the fight ahead and behind is trending." />
      </WidgetFrame>
    )
  }

  const battle = paceComparison(snapshot, driver)
  const meta = new Map(snapshot.drivers.map((d) => [d.number, d]))
  const colorOf = (n: number) => hexColor(meta.get(n)?.teamColour ?? null)
  const self = meta.get(driver)

  return (
    <WidgetFrame
      title="Pace Battle"
      icon={<Swords />}
      subtitle={self ? `P${battle.position ?? '—'} ${self.code}` : 'focus driver'}
      actions={<Badge tone="warn">recent pace</Badge>}
      bodyClassName="flex flex-col gap-1.5"
    >
      {!battle.available ? (
        <EmptyState title="No comparison yet" hint="Interval and lap data are needed to compare pace." />
      ) : (
        <>
          <RivalCard rival={battle.ahead} side="ahead" colorOf={colorOf} />

          {/* Focus driver */}
          <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/[0.07] px-2.5 py-2">
            <span className="h-4 w-[3px] rounded-full" style={{ backgroundColor: colorOf(driver) }} />
            <span className="text-sm font-bold text-fg">{self?.code ?? `#${driver}`}</span>
            <span className="text-2xs text-fg-subtle">P{battle.position ?? '—'}</span>
            <span className="ml-auto text-2xs text-fg-muted">
              recent {battle.driverPace != null ? `${battle.driverPace.toFixed(3)}s` : '—'}
            </span>
          </div>

          <RivalCard rival={battle.behind} side="behind" colorOf={colorOf} />

          <p className="pt-0.5 text-2xs text-fg-subtle">
            Pace = median of recent clean laps. Closing rate and laps-to-resolve are estimates.
          </p>
        </>
      )}
    </WidgetFrame>
  )
}
