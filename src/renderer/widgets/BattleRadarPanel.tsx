import { useMemo } from 'react'
import { Swords, Zap, TrendingUp, Users, Flame } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Badge, TyrePill, EmptyState } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { computeBattles, type Battle, type BattleVerdict } from '@renderer/core/engines/BattleEngine'
import { useFocusDriver, pickDriver } from '@renderer/lib/useFocusDriver'
import { cn } from '@renderer/lib/utils'

const VERDICT_TONE: Record<BattleVerdict, 'good' | 'accent' | 'warn' | 'neutral'> = {
  'PASS LIKELY': 'good',
  OVERTAKE: 'accent',
  CLOSING: 'warn',
  HOLDING: 'neutral'
}

export function BattleRadarPanel() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const favorites = useSettingsStore((s) => s.favorites)
  const focus = useFocusDriver()

  const report = useMemo(
    () => (snapshot ? computeBattles(snapshot, { favorites }) : null),
    [snapshot, favorites]
  )

  if (!snapshot || !report) {
    return (
      <WidgetFrame title="Battle Radar" icon={<Swords />}>
        <EmptyState icon={<Swords />} title="No session loaded" />
      </WidgetFrame>
    )
  }

  const battles = [...report.battles].sort((a, b) => b.intensity - a.intensity)

  return (
    <WidgetFrame
      title="Battle Radar"
      icon={<Swords />}
      actions={
        <Badge tone={battles.length ? 'accent' : 'neutral'}>
          {battles.length} fight{battles.length === 1 ? '' : 's'}
        </Badge>
      }
    >
      {report.trains.length > 0 && (
        <div className="mb-2 space-y-1">
          {report.trains.map((train, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded-lg border border-accent/25 bg-accent/5 px-2 py-1"
            >
              <Zap className="h-3 w-3 shrink-0 text-accent" />
              <span className="text-2xs font-semibold uppercase tracking-wide text-accent">Overtake train</span>
              <span className="tnum truncate text-2xs text-fg-muted">
                {train.map((n) => codeOf(snapshot, n)).join(' → ')}
              </span>
            </div>
          ))}
        </div>
      )}

      {battles.length === 0 ? (
        <EmptyState
          icon={<Swords />}
          title="No close battles right now"
          hint="Fights appear when cars run within ~2s of each other."
        />
      ) : (
        <div className="space-y-1.5">
          {battles.map((b) => (
            <BattleRow
              key={b.id}
              b={b}
              focus={focus}
              fav={favorites.includes(b.attacker) || favorites.includes(b.defender)}
              onPick={() => pickDriver(b.attacker)}
            />
          ))}
        </div>
      )}
    </WidgetFrame>
  )
}

function BattleRow({
  b,
  focus,
  fav,
  onPick
}: {
  b: Battle
  focus: number | null
  fav: boolean
  onPick: () => void
}) {
  const isFocus = focus === b.attacker || focus === b.defender
  return (
    <button
      onClick={onPick}
      className={cn(
        'group w-full rounded-lg border px-2 py-1.5 text-left transition-colors',
        isFocus ? 'border-accent/40 bg-accent/5' : 'border-transparent hover:border-hairline/30 hover:bg-white/[0.03]'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="tnum w-7 shrink-0 text-center text-2xs font-semibold text-fg-subtle">
          P{b.forPosition}
        </span>
        {/* defender ← attacker */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="inline-flex items-center gap-1">
            <span className="text-xs font-semibold text-fg">{b.defenderCode}</span>
            <TyrePill compound={b.defenderCompound} size="sm" />
          </span>
          <span className="tnum shrink-0 rounded bg-white/[0.06] px-1 text-2xs text-fg-muted">
            {b.interval.toFixed(1)}s
          </span>
          <span className="inline-flex items-center gap-1">
            <TyrePill compound={b.attackerCompound} size="sm" />
            <span className="text-xs font-semibold text-fg">{b.attackerCode}</span>
          </span>
          {fav && <span className="h-1.5 w-1.5 rounded-full bg-accent/70" title="Favourite involved" />}
        </div>
        <Badge tone={VERDICT_TONE[b.verdict]}>{b.verdict}</Badge>
      </div>

      <div className="mt-1 flex items-center gap-2.5 pl-9 text-2xs">
        {b.inOvertakeRange && (
          <span className="inline-flex items-center gap-0.5 text-accent" title="Overtake Mode range (2026 DRS replacement — within-1s ERS boost)">
            <Zap className="h-2.5 w-2.5" /> Overtake
          </span>
        )}
        {b.closingPerLap != null && b.closingPerLap > 0.03 ? (
          <span className="inline-flex items-center gap-0.5 text-warn">
            <TrendingUp className="h-2.5 w-2.5" /> closing {b.closingPerLap.toFixed(2)}s/lap
            {b.lapsToPass != null && b.lapsToPass < 30 ? ` · ~${Math.ceil(b.lapsToPass)} lap${Math.ceil(b.lapsToPass) === 1 ? '' : 's'}` : ''}
          </span>
        ) : (
          <span className="text-fg-subtle">gap steady</span>
        )}
        {b.tyreEdge != null && Math.abs(b.tyreEdge) >= 4 && (
          <span className={cn('inline-flex items-center gap-0.5', b.tyreEdge > 0 ? 'text-good' : 'text-fg-subtle')}>
            {b.tyreEdge > 0 ? `+${b.tyreEdge} lap fresher` : `${-b.tyreEdge} lap older`}
          </span>
        )}
        {b.isTeammates && (
          <span className="inline-flex items-center gap-0.5 text-purple">
            <Users className="h-2.5 w-2.5" /> teammates
          </span>
        )}
        {/* intensity bar */}
        <span className="ml-auto flex items-center gap-1 text-fg-subtle">
          <Flame className={cn('h-2.5 w-2.5', b.intensity > 0.6 ? 'text-danger' : b.intensity > 0.3 ? 'text-warn' : 'text-fg-subtle')} />
          <span className="h-1 w-10 overflow-hidden rounded-full bg-white/[0.06]">
            <span
              className={cn('block h-full rounded-full', b.intensity > 0.6 ? 'bg-danger' : b.intensity > 0.3 ? 'bg-warn' : 'bg-fg-subtle/60')}
              style={{ width: `${Math.max(6, b.intensity * 100)}%` }}
            />
          </span>
        </span>
      </div>
    </button>
  )
}

function codeOf(snapshot: { drivers: { number: number; code: string }[] }, n: number): string {
  return snapshot.drivers.find((d) => d.number === n)?.code ?? `#${n}`
}
