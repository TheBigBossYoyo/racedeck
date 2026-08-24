import type { ReactNode } from 'react'
import type { DriverSessionBests } from '@shared/models'
import type { PaceRival } from '@renderer/core/engines/StrategyEngine'
import { cn } from '@renderer/lib/utils'

export function DossierStat({
  label,
  value,
  tone
}: {
  readonly label: string
  readonly value: string
  readonly tone?: string
}) {
  return (
    <div className="rounded-lg border border-hairline/15 bg-black/20 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className={cn('tnum text-xs font-semibold', tone ?? 'text-fg')}>{value}</div>
    </div>
  )
}

export function SpeedMarks({ speeds }: { readonly speeds: DriverSessionBests['speeds'] }) {
  const marks = [
    ['I1', speeds.i1],
    ['I2', speeds.i2],
    ['FL', speeds.fl],
    ['Trap', speeds.st]
  ] as const

  return (
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-wide text-fg-subtle">
        Best speeds (km/h - field rank)
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {marks.map(([label, mark]) => (
          <div
            key={label}
            className="rounded-lg border border-hairline/15 bg-black/20 px-2 py-1 text-center"
          >
            <div className="text-[9px] uppercase tracking-wide text-fg-subtle">{label}</div>
            <div
              className={cn(
                'tnum text-xs font-semibold',
                mark.rank === 1 ? 'text-purple' : 'text-fg'
              )}
            >
              {mark.value ?? '-'}
            </div>
            {mark.rank != null && (
              <div className="text-[9px] tabular-nums text-fg-subtle">P{mark.rank}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function BattleLine({
  icon,
  label,
  rival,
  side
}: {
  readonly icon: ReactNode
  readonly label: string
  readonly rival: PaceRival | null
  readonly side: 'ahead' | 'behind'
}) {
  if (!rival) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-hairline/15 px-2 py-1 text-2xs text-fg-subtle">
        {icon}
        {label}: clear
      </div>
    )
  }
  const tone = rival.closing ? (side === 'ahead' ? 'text-good' : 'text-danger') : 'text-fg-muted'
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-hairline/15 bg-white/[0.015] px-2 py-1 text-2xs">
      <span className="text-fg-subtle">{icon}</span>
      <span className="font-bold text-fg">{rival.code}</span>
      <span className="tnum text-fg-muted">{rival.gapSec != null ? `${rival.gapSec.toFixed(1)}s` : '-'}</span>
      <span className={cn('ml-auto', tone)}>
        {rival.deltaPerLap == null
          ? '-'
          : `${rival.deltaPerLap > 0 ? '+' : ''}${rival.deltaPerLap.toFixed(2)}s/lap${
              rival.closing && rival.lapsToResolve != null ? ` - ~${Math.ceil(rival.lapsToResolve)}L` : ''
            }`}
      </span>
    </div>
  )
}
