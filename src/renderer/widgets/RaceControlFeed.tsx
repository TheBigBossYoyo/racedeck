import { useMemo } from 'react'
import { Flag, ShieldAlert, Radio, Megaphone } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { formatClock, cn } from '@renderer/lib/utils'
import type { FlagType, RaceControlMessage } from '@shared/models'

const FLAG_COLOR: Partial<Record<FlagType, string>> = {
  GREEN: 'bg-good',
  YELLOW: 'bg-warn',
  DOUBLE_YELLOW: 'bg-warn',
  RED: 'bg-danger',
  BLUE: 'bg-[#3b8bff]',
  CHEQUERED: 'bg-white',
  BLACK_ORANGE: 'bg-orange-500',
  WHITE: 'bg-white'
}

const SEV_STYLE: Record<RaceControlMessage['severity'], string> = {
  critical: 'border-l-danger bg-danger/[0.06]',
  warning: 'border-l-warn bg-warn/[0.05]',
  notice: 'border-l-good bg-good/[0.04]',
  info: 'border-l-hairline/40'
}

function iconFor(m: RaceControlMessage) {
  const t = m.category.toLowerCase()
  if (t.includes('safety')) return <ShieldAlert className="h-3.5 w-3.5" />
  if (t.includes('drs') || t.includes('overtake') || t.includes('aero')) return <Radio className="h-3.5 w-3.5" />
  if (m.flag !== 'NONE') return <Flag className="h-3.5 w-3.5" />
  return <Megaphone className="h-3.5 w-3.5" />
}

export function RaceControlFeed() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const driverMap = useMemo(() => {
    const m = new Map<number, string>()
    snapshot?.drivers.forEach((d) => m.set(d.number, d.code))
    return m
  }, [snapshot?.drivers])

  if (!snapshot || !snapshot.availability.raceControl) {
    return (
      <WidgetFrame title="Race Control" icon={<Radio />}>
        <EmptyState title="No race control feed" hint="Race control messages will appear here." />
      </WidgetFrame>
    )
  }

  const messages = [...snapshot.raceControl].reverse()

  return (
    <WidgetFrame title="Race Control" icon={<Radio />} subtitle={`${messages.length}`} noPadding>
      <div className="flex flex-col">
        {/* F1's live marshalling ticker (TlaRcm) — the short sector-level status
            the broadcast shows, which arrives far sooner than the formal race
            control message for the same event. */}
        {snapshot.trackMessage && (
          <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-hairline/25 bg-bg-overlay/95 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted backdrop-blur">
            <Megaphone className="h-3 w-3 shrink-0 text-accent" />
            {snapshot.trackMessage}
          </div>
        )}
        {messages.length === 0 && (
          <div className="p-4 text-center text-xs text-fg-subtle">No messages yet.</div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              'flex items-start gap-2 border-b border-l-2 border-hairline/15 px-2.5 py-1.5',
              SEV_STYLE[m.severity]
            )}
          >
            <span
              className={cn(
                'mt-0.5 shrink-0',
                m.severity === 'critical'
                  ? 'text-danger'
                  : m.severity === 'warning'
                    ? 'text-warn'
                    : m.severity === 'notice'
                      ? 'text-good'
                      : 'text-fg-subtle'
              )}
            >
              {iconFor(m)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-snug text-fg">{m.message}</p>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-fg-subtle">
                {m.flag !== 'NONE' && FLAG_COLOR[m.flag] && (
                  <span className="flex items-center gap-1">
                    <span className={cn('h-2 w-2 rounded-sm', FLAG_COLOR[m.flag])} />
                    {m.flag.replace('_', ' ')}
                  </span>
                )}
                {m.lapNumber != null && <span className="tnum">LAP {m.lapNumber}</span>}
                {m.driverNumber != null && driverMap.get(m.driverNumber) && (
                  <span className="font-semibold text-fg-muted">
                    {driverMap.get(m.driverNumber)}
                  </span>
                )}
                <span className="tnum ml-auto">{formatClock(m.date)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </WidgetFrame>
  )
}
