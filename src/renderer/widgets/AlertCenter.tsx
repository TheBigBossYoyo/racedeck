import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, BellOff, Trash2, X, TriangleAlert, Flag, CloudRain, Timer } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Button, EmptyState } from '@renderer/components/ui/primitives'
import { useAlertStore } from '@renderer/store/alertStore'
import type { AlertEvent, AlertType } from '@renderer/core/engines/AlertEngine'
import { cn } from '@renderer/lib/utils'

const SEV: Record<AlertEvent['severity'], { border: string; text: string; dot: string }> = {
  critical: { border: 'border-l-danger', text: 'text-danger', dot: 'bg-danger' },
  warning: { border: 'border-l-warn', text: 'text-warn', dot: 'bg-warn' },
  notice: { border: 'border-l-good', text: 'text-good', dot: 'bg-good' },
  info: { border: 'border-l-accent/50', text: 'text-accent', dot: 'bg-accent' }
}

function iconFor(type: AlertType) {
  if (type === 'weather') return <CloudRain className="h-3.5 w-3.5" />
  if (type === 'pit-stop') return <Timer className="h-3.5 w-3.5" />
  if (type.includes('flag') || type === 'safety-car' || type === 'vsc' || type === 'red-flag')
    return <Flag className="h-3.5 w-3.5" />
  return <TriangleAlert className="h-3.5 w-3.5" />
}

function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 5) return 'now'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m`
}

export function AlertCenter() {
  const { alerts, muted, setMuted, dismiss, clear, markAllSeen } = useAlertStore()

  useEffect(() => {
    markAllSeen()
  }, [alerts.length, markAllSeen])

  return (
    <WidgetFrame
      title="Alert Center"
      icon={<Bell />}
      subtitle={alerts.length ? `${alerts.length}` : undefined}
      noPadding
      actions={
        <>
          <Button
            size="icon-sm"
            variant={muted ? 'default' : 'ghost'}
            onClick={() => setMuted(!muted)}
            title={muted ? 'Unmute alerts' : 'Mute alerts'}
          >
            {muted ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={clear} title="Clear all">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      }
    >
      {alerts.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title="All quiet"
          hint="Flags, safety cars, pit stops and favourite-driver events will surface here. Configure rules in Settings."
        />
      ) : (
        <div className="flex flex-col">
          <AnimatePresence initial={false}>
            {alerts.map((a) => {
              const s = SEV[a.severity]
              return (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className={cn(
                    'group flex items-start gap-2 border-b border-l-2 border-hairline/15 px-2.5 py-1.5',
                    s.border
                  )}
                >
                  <span className={cn('mt-0.5 shrink-0', s.text)}>{iconFor(a.type)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-xs font-semibold', s.text)}>{a.title}</span>
                      <span className="tnum ml-auto text-[10px] text-fg-subtle">{ago(a.seenAt)}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-fg-muted">{a.detail}</p>
                  </div>
                  <button
                    onClick={() => dismiss(a.id)}
                    className="shrink-0 rounded p-0.5 text-fg-subtle opacity-0 transition-opacity hover:bg-white/5 hover:text-fg group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </WidgetFrame>
  )
}
