import { useMemo } from 'react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, TeamStripe } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { TYRE_LABELS } from '@shared/constants'
import { useTyreColors } from '@renderer/lib/useTyreColors'
import { cn } from '@renderer/lib/utils'
import type { Stint } from '@shared/models'

export function TyreStrategyTable() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const setFocus = useSessionStore((s) => s.setFocusDriver)
  const focusDriver = useSessionStore((s) => s.focusDriver)
  const tyreColors = useTyreColors()

  const model = useMemo(() => {
    if (!snapshot) return null
    const byDriver = new Map<number, Stint[]>()
    for (const st of snapshot.stints) {
      const arr = byDriver.get(st.driverNumber) ?? []
      arr.push(st)
      byDriver.set(st.driverNumber, arr)
    }
    const totalLaps =
      snapshot.totalLaps ??
      Math.max(1, ...snapshot.stints.map((s) => s.lapEnd ?? 0), snapshot.currentLap ?? 1)
    const driverMeta = new Map(snapshot.drivers.map((d) => [d.number, d]))
    const rows = snapshot.timing
      .filter((t) => byDriver.has(t.driverNumber))
      .map((t) => ({
        number: t.driverNumber,
        code: driverMeta.get(t.driverNumber)?.code ?? String(t.driverNumber),
        color: driverMeta.get(t.driverNumber)?.teamColour ?? null,
        stints: (byDriver.get(t.driverNumber) ?? []).sort((a, b) => a.lapStart - b.lapStart),
        pits: (byDriver.get(t.driverNumber) ?? []).length - 1
      }))
    return { rows, totalLaps, currentLap: snapshot.currentLap ?? totalLaps }
  }, [snapshot])

  if (!snapshot || !snapshot.availability.stints || !model || model.rows.length === 0) {
    return (
      <WidgetFrame title="Tyre Strategy">
        <EmptyState title="No stint data" hint="Tyre stints and strategy will appear here." />
      </WidgetFrame>
    )
  }

  const { rows, totalLaps, currentLap } = model
  const nowPct = (currentLap / totalLaps) * 100

  return (
    <WidgetFrame title="Tyre Strategy" subtitle={`${totalLaps} laps`} noPadding>
      <div className="relative flex flex-col py-1">
        {/* current lap marker (bar area spans from the 62px label gutter to the 32px pits column) */}
        <div
          className="pointer-events-none absolute bottom-1 top-1 z-10 w-px bg-accent/60"
          style={{ left: `calc(62px + (100% - 94px) * ${(nowPct / 100).toFixed(4)})` }}
        />
        {rows.map((r) => (
          <button
            key={r.number}
            onClick={() => setFocus(r.number)}
            className={cn(
              'flex items-center gap-2 px-2 py-1 text-left transition-colors',
              focusDriver === r.number ? 'bg-accent/10' : 'hover:bg-white/[0.03]'
            )}
          >
            <div className="flex w-[46px] shrink-0 items-center gap-1.5">
              <TeamStripe color={r.color} />
              <span className="text-[11px] font-bold text-fg">{r.code}</span>
            </div>
            <div className="relative h-4 flex-1 overflow-hidden rounded bg-black/30">
              {r.stints.map((st, i) => {
                const end = st.lapEnd ?? currentLap
                const left = ((st.lapStart - 1) / totalLaps) * 100
                const width = ((end - st.lapStart + 1) / totalLaps) * 100
                const color = tyreColors[st.tyre.compound]
                return (
                  <div
                    key={i}
                    className="absolute top-0 flex h-full items-center justify-center border-r border-black/40"
                    style={{ left: `${left}%`, width: `${width}%`, backgroundColor: `${color}2e` }}
                    title={`${st.tyre.compound} · laps ${st.lapStart}-${end}`}
                  >
                    <span className="h-1 w-full" style={{ backgroundColor: color, opacity: 0.9 }} />
                    {width > 8 && (
                      <span
                        className="absolute text-[9px] font-bold"
                        style={{ color }}
                      >
                        {TYRE_LABELS[st.tyre.compound]}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <span className="tnum w-4 shrink-0 text-center text-[10px] text-fg-subtle">{r.pits}</span>
          </button>
        ))}
      </div>
    </WidgetFrame>
  )
}
