import { useEffect, useMemo, useState } from 'react'
import { Trophy, ChevronUp, ChevronDown, Minus } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Badge, Segmented } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useStandingsStore } from '@renderer/store/standingsStore'
import { projectChampionship } from '@renderer/core/engines/ChampionshipEngine'
import { hexColor, cn } from '@renderer/lib/utils'

type Metric = 'drivers' | 'constructors'

function MovementChip({ delta }: { delta: number }) {
  if (delta === 0) {
    return <Minus className="h-3 w-3 text-fg-subtle" aria-label="no change" />
  }
  const up = delta > 0
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-2xs font-semibold', up ? 'text-good' : 'text-danger')}>
      {up ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      {Math.abs(delta)}
    </span>
  )
}

export function ChampionshipPanel() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const session = useSessionStore((s) => s.currentSession)
  const setFocus = useSessionStore((s) => s.setFocusDriver)
  const load = useStandingsStore((s) => s.load)
  const championship = useStandingsStore((s) => s.championship)
  const loading = useStandingsStore((s) => s.loading)
  const error = useStandingsStore((s) => s.error)
  const [metric, setMetric] = useState<Metric>('drivers')

  useEffect(() => {
    void load(session?.year ?? null, session?.dateStart ?? null)
  }, [load, session?.year, session?.dateStart])

  const projection = useMemo(
    () => (snapshot ? projectChampionship(championship, snapshot) : null),
    [championship, snapshot]
  )

  const subtitle = projection?.roundResolved
    ? `Round ${projection.round}/${projection.totalRounds}${projection.raceName ? ` · ${projection.raceName}` : ''}`
    : 'current standings'

  if (!snapshot) {
    return (
      <WidgetFrame title="Championship" icon={<Trophy />}>
        <EmptyState icon={<Trophy />} title="No session" hint="Championship implications appear with a loaded session." />
      </WidgetFrame>
    )
  }

  if (loading && !projection?.ok) {
    return (
      <WidgetFrame title="Championship" icon={<Trophy />} subtitle="loading…">
        <EmptyState icon={<Trophy />} title="Loading standings…" hint="Fetching the pre-race championship from public F1 data." />
      </WidgetFrame>
    )
  }

  if (!projection?.ok) {
    return (
      <WidgetFrame title="Championship" icon={<Trophy />}>
        <EmptyState
          icon={<Trophy />}
          title="Standings unavailable"
          hint={error ?? 'Championship standings will appear once the season has completed a round.'}
        />
      </WidgetFrame>
    )
  }

  const showConstructors = metric === 'constructors' && projection.constructors.length > 0
  const actions = (
    <div className="flex items-center gap-1.5">
      {projection.live && <Badge tone="good">live</Badge>}
      <Segmented<Metric>
        value={metric}
        onChange={setMetric}
        options={[
          { value: 'drivers', label: 'Drivers' },
          { value: 'constructors', label: 'Teams' }
        ]}
      />
    </div>
  )

  return (
    <WidgetFrame title="Championship" icon={<Trophy />} subtitle={subtitle} actions={actions}>
      <div className="space-y-1">
        {projection.leaderClinched && (
          <div className="flex items-center gap-1.5 rounded-lg border border-good/30 bg-good/10 px-2 py-1 text-2xs font-semibold text-good">
            <Trophy className="h-3.5 w-3.5" />
            {showConstructors ? projection.constructors[0]?.name : projection.drivers[0]?.name} has clinched the title.
          </div>
        )}

        {showConstructors
          ? projection.constructors.map((row) => {
              const color = hexColor(row.teamColour)
              return (
                <div
                  key={row.name}
                  className="flex items-center gap-2 rounded-lg border border-hairline/15 bg-white/[0.015] px-2 py-1.5"
                >
                  <span className="tnum w-4 text-center text-2xs font-bold text-fg-subtle">{row.projectedPosition}</span>
                  <span className="h-3.5 w-[3px] rounded-full" style={{ backgroundColor: color }} />
                  <span className="truncate text-xs font-semibold text-fg">{row.name}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {row.racePoints > 0 && <span className="tnum text-2xs font-semibold text-good">+{row.racePoints}</span>}
                    <span className="tnum w-9 text-right text-xs font-semibold text-fg">{row.projectedPoints}</span>
                    <span className="w-8 text-right"><MovementChip delta={row.positionDelta} /></span>
                  </span>
                </div>
              )
            })
          : projection.drivers.map((row) => {
              const color = hexColor(row.teamColour)
              const focusable = row.driverNumber != null
              return (
                <button
                  key={row.code + row.prePosition}
                  onClick={() => focusable && setFocus(row.driverNumber)}
                  disabled={!focusable}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border border-hairline/15 bg-white/[0.015] px-2 py-1.5 text-left transition-colors',
                    focusable && 'hover:bg-white/[0.04]',
                    row.status === 'eliminated' && 'opacity-45'
                  )}
                >
                  <span className="tnum w-4 text-center text-2xs font-bold text-fg-subtle">{row.projectedPosition}</span>
                  <span className="h-3.5 w-[3px] rounded-full" style={{ backgroundColor: color }} />
                  <span className="w-9 text-2xs font-bold text-fg">{row.code}</span>
                  <span className="truncate text-xs text-fg-muted">{row.name}</span>
                  {row.status === 'leader' && <Trophy className="h-3 w-3 shrink-0 text-warn" aria-label="championship leader" />}
                  <span className="ml-auto flex items-center gap-2">
                    {row.racePoints > 0 && <span className="tnum text-2xs font-semibold text-good">+{row.racePoints}</span>}
                    <span className="tnum w-9 text-right text-xs font-semibold text-fg">{row.projectedPoints}</span>
                    <span className="w-8 text-right"><MovementChip delta={row.positionDelta} /></span>
                  </span>
                </button>
              )
            })}

        <p className="pt-0.5 text-2xs text-fg-subtle">
          {projection.live
            ? 'Projected standings if the race finished now — provisional points on the pre-race baseline.'
            : 'Championship standings before this round.'}
          {projection.roundResolved && projection.remainingRounds > 0 && !projection.leaderClinched && (
            <> {projection.remainingRounds} round{projection.remainingRounds === 1 ? '' : 's'} remain ({projection.maxRemaining} pts).</>
          )}
          {' '}Source: public Jolpica F1 data.
        </p>
      </div>
    </WidgetFrame>
  )
}
