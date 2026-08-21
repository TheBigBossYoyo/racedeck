import { useEffect, useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, TyrePill } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { formatGap, formatLapTime, formatDelta, hexColor, cn } from '@renderer/lib/utils'
import type { Driver, TimingEntry } from '@shared/models'

function DriverSelect({
  drivers,
  value,
  onChange,
  color
}: {
  drivers: Driver[]
  value: number
  onChange: (n: number) => void
  color: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="no-drag cursor-pointer rounded-md border border-hairline/30 bg-black/30 px-1.5 py-1 text-sm font-bold text-fg outline-none focus:border-accent/50"
      >
        {drivers.map((d) => (
          <option key={d.number} value={d.number} className="bg-bg-overlay">
            {d.code}
          </option>
        ))}
      </select>
    </div>
  )
}

function Row({
  label,
  a,
  b,
  betterA,
  betterB
}: {
  label: string
  a: React.ReactNode
  b: React.ReactNode
  betterA?: boolean
  betterB?: boolean
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-hairline/10 py-1.5">
      <span className={cn('tnum mono text-right text-sm', betterA ? 'font-semibold text-good' : 'text-fg')}>
        {a}
      </span>
      <span className="text-[9px] uppercase tracking-wider text-fg-subtle">{label}</span>
      <span className={cn('tnum mono text-left text-sm', betterB ? 'font-semibold text-good' : 'text-fg')}>
        {b}
      </span>
    </div>
  )
}

export function DriverComparisonCard() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const focusDriver = useSessionStore((s) => s.focusDriver)
  const getDriverLaps = useSessionStore((s) => s.getDriverLaps)

  const drivers = snapshot?.drivers ?? []
  const timing = snapshot?.timing ?? []

  const teammateOf = (n: number): number | null => {
    const team = drivers.find((d) => d.number === n)?.teamName
    if (!team) return null
    return drivers.find((d) => d.number !== n && d.teamName === team)?.number ?? null
  }

  const [aNum, setANum] = useState<number | null>(null)
  const [bNum, setBNum] = useState<number | null>(null)

  useEffect(() => {
    if (timing.length === 0) return
    const a = focusDriver ?? timing[0].driverNumber
    setANum(a)
    setBNum((prev) => prev ?? teammateOf(a) ?? timing.find((t) => t.driverNumber !== a)?.driverNumber ?? a)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDriver, timing.length])

  const bestLapOf = (n: number): number | null => {
    const laps = getDriverLaps(n)
      .map((l) => l.lapTime)
      .filter((t): t is number => t != null && t > 0)
    return laps.length ? Math.min(...laps) : null
  }

  const data = useMemo(() => {
    if (aNum == null || bNum == null) return null
    const a = timing.find((t) => t.driverNumber === aNum)
    const b = timing.find((t) => t.driverNumber === bNum)
    if (!a || !b) return null
    return { a, b, bestA: bestLapOf(aNum), bestB: bestLapOf(bNum) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aNum, bNum, timing])

  if (!snapshot || timing.length === 0 || !data || aNum == null || bNum == null) {
    return (
      <WidgetFrame title="Driver Comparison" icon={<Users />}>
        <EmptyState title="No drivers" hint="Load a session and click a driver in the timing tower." />
      </WidgetFrame>
    )
  }

  const { a, b, bestA, bestB } = data
  const colorA = hexColor(drivers.find((d) => d.number === aNum)?.teamColour ?? null)
  const colorB = hexColor(drivers.find((d) => d.number === bNum)?.teamColour ?? null)

  const gapA = typeof a.gapToLeader === 'number' ? a.gapToLeader : null
  const gapB = typeof b.gapToLeader === 'number' ? b.gapToLeader : null
  const headToHead = gapA != null && gapB != null ? gapA - gapB : null

  const sectorDelta = (i: 1 | 2 | 3): number | null => {
    const sa = i === 1 ? a.sector1 : i === 2 ? a.sector2 : a.sector3
    const sb = i === 1 ? b.sector1 : i === 2 ? b.sector2 : b.sector3
    if (sa.seconds == null || sb.seconds == null) return null
    return sa.seconds - sb.seconds
  }

  return (
    <WidgetFrame title="Driver Comparison" icon={<Users />}>
      <div className="flex items-center justify-between px-1 pb-2">
        <DriverSelect drivers={drivers} value={aNum} onChange={setANum} color={colorA} />
        <span className="text-2xs font-semibold uppercase tracking-widest text-fg-subtle">vs</span>
        <DriverSelect drivers={drivers} value={bNum} onChange={setBNum} color={colorB} />
      </div>

      {headToHead != null && (
        <div className="mb-2 rounded-lg border border-accent/20 bg-accent/[0.06] py-2 text-center">
          <span className="tnum text-lg font-bold text-accent">
            {formatDelta(Math.abs(headToHead))}s
          </span>
          <span className="ml-2 text-xs text-fg-muted">
            {headToHead < 0
              ? `${drivers.find((d) => d.number === aNum)?.code} ahead`
              : `${drivers.find((d) => d.number === bNum)?.code} ahead`}
          </span>
        </div>
      )}

      <div className="flex flex-col">
        <Row label="Pos" a={`P${a.position ?? '—'}`} b={`P${b.position ?? '—'}`} betterA={(a.position ?? 99) < (b.position ?? 99)} betterB={(b.position ?? 99) < (a.position ?? 99)} />
        <Row label="Gap → P1" a={formatGap(a.gapToLeader)} b={formatGap(b.gapToLeader)} />
        <Row label="Last" a={formatLapTime(a.lastLap)} b={formatLapTime(b.lastLap)} betterA={num(a.lastLap) < num(b.lastLap)} betterB={num(b.lastLap) < num(a.lastLap)} />
        <Row label="Best" a={formatLapTime(bestA)} b={formatLapTime(bestB)} betterA={num(bestA) < num(bestB)} betterB={num(bestB) < num(bestA)} />
        <Row
          label="Tyre"
          a={<TyrePill compound={a.compound} age={a.stintAge} size="sm" />}
          b={<TyrePill compound={b.compound} age={b.stintAge} size="sm" />}
        />
        <Row label="Stops" a={a.pitStops ?? 0} b={b.pitStops ?? 0} />
        {([1, 2, 3] as const).map((i) => {
          const d = sectorDelta(i)
          return (
            <Row
              key={i}
              label={`S${i} Δ`}
              a={d != null && d < 0 ? formatDelta(d) : ''}
              b={d != null && d > 0 ? formatDelta(d) : ''}
              betterA={d != null && d < 0}
              betterB={d != null && d > 0}
            />
          )
        })}
      </div>
    </WidgetFrame>
  )
}

function num(v: number | null): number {
  return v == null ? Infinity : v
}
