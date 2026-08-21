import { useMemo } from 'react'
import { Activity, Gauge, Layers3 } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Badge, EmptyState, TyrePill } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { PracticeEngine, type PracticeProgram } from '@renderer/core/engines/PracticeEngine'
import { formatLapTime, cn } from '@renderer/lib/utils'

const PROGRAM_TONE: Record<PracticeProgram, string> = {
  INSTALLATION: 'border-hairline/30 bg-white/5 text-fg-muted',
  'QUALIFYING RUN': 'border-purple/30 bg-purple/10 text-purple',
  'LONG RUN': 'border-good/30 bg-good/10 text-good',
  MIXED: 'border-accent/30 bg-accent/10 text-accent'
}

export function PracticeRunBoard() {
  const snapshot = useSessionStore((state) => state.snapshot)
  const analysis = useMemo(() => snapshot ? PracticeEngine.analyze(snapshot) : null, [snapshot])

  if (!snapshot || !analysis?.available) {
    return (
      <WidgetFrame title="Practice Run Board" icon={<Activity />} actions={<Badge tone="neutral">estimate</Badge>}>
        <EmptyState
          icon={<Activity />}
          title={snapshot?.session.type === 'practice' ? 'Building run programmes' : 'Practice session required'}
          hint={analysis?.reason ?? 'Load FP1, FP2 or FP3 to compare qualifying and long-run programmes.'}
        />
      </WidgetFrame>
    )
  }

  return (
    <WidgetFrame
      title="Practice Run Board"
      icon={<Activity />}
      subtitle="short runs · long runs · consistency"
      actions={<Badge tone="warn">estimate</Badge>}
      noPadding
    >
      <div className="grid grid-cols-2 gap-1.5 border-b border-hairline/20 p-2 text-2xs">
        <div className="rounded-lg bg-good/[0.06] px-2 py-1.5">
          <span className="text-fg-subtle">Best long run</span>
          <div className="font-bold text-good">{analysis.bestLongRun?.code ?? 'Building…'}</div>
        </div>
        <div className="rounded-lg bg-accent/[0.06] px-2 py-1.5">
          <span className="text-fg-subtle">Most productive</span>
          <div className="font-bold text-accent">
            {analysis.mostProductive ? `${analysis.mostProductive.code} · ${analysis.mostProductive.lapCount}L` : '—'}
          </div>
        </div>
      </div>
      <div className="min-w-[430px]">
        <div className="sticky top-0 grid grid-cols-[42px_92px_58px_68px_68px_54px_1fr] gap-1 border-b border-hairline/20 bg-bg-raised/95 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-fg-subtle">
          <span>Car</span><span>Programme</span><span>Tyre</span><span>Best</span><span>Long run</span><span>σ</span><span className="text-right">Laps</span>
        </div>
        {analysis.runs.slice(0, 20).map((run) => (
          <div key={run.driverNumber} className="grid grid-cols-[42px_92px_58px_68px_68px_54px_1fr] items-center gap-1 border-b border-hairline/15 px-2 py-1.5 text-2xs">
            <span className="font-extrabold text-fg">{run.code}</span>
            <span className={cn('rounded border px-1 py-0.5 text-[8px] font-bold', PROGRAM_TONE[run.program])}>{run.program}</span>
            <TyrePill compound={run.currentCompound} size="sm" />
            <span className="tnum text-fg">{formatLapTime(run.bestLap)}</span>
            <span className="tnum text-fg-muted">{formatLapTime(run.longRunPace)}</span>
            <span className="tnum text-fg-subtle">{run.consistency == null ? '—' : run.consistency.toFixed(2)}</span>
            <span className="flex items-center justify-end gap-1 font-semibold text-fg"><Layers3 className="h-3 w-3 text-fg-subtle" />{run.lapCount}</span>
          </div>
        ))}
      </div>
      <p className="flex items-center gap-1 px-2 py-1.5 text-[9px] text-fg-subtle">
        <Gauge className="h-3 w-3" /> Run types are inferred from clean-lap length, pace and consistency; they are not team declarations.
      </p>
    </WidgetFrame>
  )
}
