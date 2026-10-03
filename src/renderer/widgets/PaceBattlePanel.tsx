import { useState } from 'react'
import {
  Swords,
  ChevronsUp,
  ChevronsDown,
  Minus,
  Crosshair,
  ShieldAlert,
  Users,
  X
} from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Badge, Button, FOCUS_RING } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useFocusDriver, pickDriver } from '@renderer/lib/useFocusDriver'
import {
  paceComparison,
  paceBattleBetween,
  type PaceRival,
  type PaceDuel,
  type PaceDuelSide
} from '@renderer/core/engines/StrategyEngine'
import { DriverSelect } from '@renderer/widgets/DriverComparisonCard'
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
  const trendIcon =
    rate == null ? (
      <Minus className="h-3 w-3" />
    ) : rate > 0.03 ? (
      <ChevronsUp className="h-3 w-3" />
    ) : rate < -0.03 ? (
      <ChevronsDown className="h-3 w-3" />
    ) : (
      <Minus className="h-3 w-3" />
    )

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
    tone === 'good'
      ? 'border-good/30 bg-good/[0.06]'
      : tone === 'danger'
        ? 'border-danger/30 bg-danger/[0.06]'
        : 'border-hairline/20 bg-white/[0.015]'

  return (
    <button
      onClick={() => pickDriver(rival.number)}
      className={cn(
        'w-full rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:brightness-110',
        FOCUS_RING,
        toneClass
      )}
    >
      <div className="flex items-center gap-2">
        <span className="grid h-4 w-4 place-items-center rounded text-fg-subtle">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span
          className="h-3.5 w-[3px] rounded-full"
          style={{ backgroundColor: colorOf(rival.number) }}
        />
        <span className="text-xs font-bold text-fg">{rival.code}</span>
        <span className="tnum ml-auto text-xs font-semibold text-fg">
          {rival.gapSec != null ? `${rival.gapSec.toFixed(1)}s` : '—'}
        </span>
      </div>
      <div
        className={cn(
          'mt-0.5 flex items-center gap-1 pl-6 text-2xs',
          tone === 'good' ? 'text-good' : tone === 'danger' ? 'text-danger' : 'text-fg-muted'
        )}
      >
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

/** One side of a manually-chosen pace duel — mirrors `RivalCard`'s look, adapted to `PaceDuelSide`'s degradation-aware fields. */
function DuelSideCard({ side, colorOf }: { side: PaceDuelSide; colorOf: (n: number) => string }) {
  return (
    <div className="rounded-lg border border-hairline/20 bg-white/[0.015] px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <span
          className="h-3.5 w-[3px] rounded-full"
          style={{ backgroundColor: colorOf(side.number) }}
        />
        <span className="text-sm font-bold text-fg">{side.code}</span>
        <span className="text-2xs text-fg-subtle">P{side.position ?? '—'}</span>
        <span className="ml-auto text-2xs text-fg-muted">
          recent {side.currentPace != null ? `${side.currentPace.toFixed(3)}s` : '—'}
        </span>
      </div>
      {side.degradationPerLap != null && (
        <div className="mt-0.5 pl-[18px] text-2xs text-fg-subtle">
          deg {side.degradationPerLap >= 0 ? '+' : ''}
          {side.degradationPerLap.toFixed(3)}s/lap
        </div>
      )}
    </div>
  )
}

const DUEL_TREND_META: Record<PaceDuel['trend'], { label: string; tone: string }> = {
  closing: { label: 'closing', tone: 'text-good' },
  opening: { label: 'opening', tone: 'text-danger' },
  stable: { label: 'stable', tone: 'text-fg-muted' }
}

/** Manually-chosen driver-pair duel — any two drivers, not just track-adjacent ones. */
function DuelSummary({ duel, colorOf }: { duel: PaceDuel; colorOf: (n: number) => string }) {
  if (!duel.available) {
    return (
      <EmptyState
        title="No comparison yet"
        hint="Interval and lap data are needed to compare pace."
      />
    )
  }
  const trendMeta = DUEL_TREND_META[duel.trend]
  return (
    <>
      <DuelSideCard side={duel.ahead} colorOf={colorOf} />
      <div className="flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/[0.05] px-2.5 py-1.5 text-2xs">
        <span className="text-fg-muted">Gap</span>
        <span className="tnum font-semibold text-fg">
          {duel.gapSec != null ? `${duel.gapSec.toFixed(1)}s` : '—'}
        </span>
        <span className={cn('ml-auto font-semibold', trendMeta.tone)}>{trendMeta.label}</span>
        {duel.lapsToResolve != null && (
          <Badge tone={duel.trend === 'closing' ? 'good' : 'neutral'}>
            ~{Math.ceil(duel.lapsToResolve)} laps
          </Badge>
        )}
      </div>
      <DuelSideCard side={duel.behind} colorOf={colorOf} />
      <p className="pt-0.5 text-2xs text-fg-subtle">
        Laps-to-resolve projects each driver's own current-stint tyre degradation trend forward, not
        just today's pace held flat.
      </p>
    </>
  )
}

export function PaceBattlePanel() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const driver = useFocusDriver()
  const [manualA, setManualA] = useState<number | null>(null)
  const [manualB, setManualB] = useState<number | null>(null)

  if (!snapshot || driver == null) {
    return (
      <WidgetFrame title="Pace Battle" icon={<Swords />}>
        <EmptyState
          icon={<Swords />}
          title="No driver in focus"
          hint="Pick a driver to see how the fight ahead and behind is trending."
        />
      </WidgetFrame>
    )
  }

  const meta = new Map(snapshot.drivers.map((d) => [d.number, d]))
  const colorOf = (n: number) => hexColor(meta.get(n)?.teamColour ?? null)
  const manualMode = manualA != null && manualB != null
  const drivers = snapshot.drivers

  const startManualPick = () => {
    const ahead = snapshot.timing.find((t) => t.driverNumber !== driver)
    setManualA(driver)
    setManualB(ahead?.driverNumber ?? drivers.find((d) => d.number !== driver)?.number ?? driver)
  }
  const stopManualPick = () => {
    setManualA(null)
    setManualB(null)
  }

  const battle = !manualMode ? paceComparison(snapshot, driver) : null
  const duel = manualMode ? paceBattleBetween(snapshot, manualA, manualB) : null
  const self = meta.get(driver)

  return (
    <WidgetFrame
      title="Pace Battle"
      icon={<Swords />}
      subtitle={
        manualMode
          ? 'chosen pair'
          : self
            ? `P${battle?.position ?? '—'} ${self.code}`
            : 'focus driver'
      }
      actions={
        manualMode ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={stopManualPick}
            title="Back to focused-driver mode"
          >
            <X className="h-3 w-3" /> Auto
          </Button>
        ) : (
          <Button size="xs" variant="outline" onClick={startManualPick}>
            <Users className="h-3 w-3" /> Compare
          </Button>
        )
      }
      bodyClassName="flex flex-col gap-1.5"
    >
      {manualMode && manualA != null && manualB != null && (
        <div className="mb-0.5 flex items-center justify-center gap-2">
          <DriverSelect
            drivers={drivers}
            value={manualA}
            onChange={setManualA}
            color={colorOf(manualA)}
            label="First driver"
          />
          <span className="text-2xs font-semibold uppercase tracking-widest text-fg-subtle">
            vs
          </span>
          <DriverSelect
            drivers={drivers}
            value={manualB}
            onChange={setManualB}
            color={colorOf(manualB)}
            label="Second driver"
          />
        </div>
      )}

      {manualMode && duel ? (
        <DuelSummary duel={duel} colorOf={colorOf} />
      ) : battle && !battle.available ? (
        <EmptyState
          title="No comparison yet"
          hint="Interval and lap data are needed to compare pace."
        />
      ) : battle ? (
        <>
          <RivalCard rival={battle.ahead} side="ahead" colorOf={colorOf} />

          {/* Focus driver */}
          <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/[0.07] px-2.5 py-2">
            <span
              className="h-4 w-[3px] rounded-full"
              style={{ backgroundColor: colorOf(driver) }}
            />
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
      ) : null}
    </WidgetFrame>
  )
}
