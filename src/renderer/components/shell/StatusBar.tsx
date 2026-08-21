import { Bell, ShieldCheck, ShieldOff, Database, Flag, Radio, Minus, Plus } from 'lucide-react'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useAlertStore } from '@renderer/store/alertStore'
import { useAppStore } from '@renderer/store/appStore'
import { useSyncStore } from '@renderer/store/syncStore'
import { Tooltip } from '@renderer/components/ui/controls'
import { formatDuration, formatOffset } from '@renderer/lib/utils'
import { cn } from '@renderer/lib/utils'

/** Always-visible fine-tune control for the dashboard's effective data clock. */
function StreamSyncChip() {
  const offset = useSyncStore((s) => s.sync.offsetSeconds)
  const nudge = useSyncStore((s) => s.nudge)
  return (
    <Tooltip content="Data fine-tune — use the wizard for the event you see on TOD, then nudge the dashboard a second at a time.">
      <div className="flex shrink-0 items-center gap-1">
        <Radio className={cn('h-3 w-3', offset !== 0 ? 'text-accent' : 'text-fg-subtle')} />
        <button
          className="no-drag grid h-4 w-4 place-items-center rounded text-fg-subtle hover:bg-white/5 hover:text-fg"
          onClick={() => nudge(1)}
          title="Show dashboard data 1s earlier"
        >
          <Minus className="h-2.5 w-2.5" />
        </button>
        <span className={cn('tnum w-9 text-center', offset !== 0 ? 'text-fg' : 'text-fg-subtle')}>
          {formatOffset(-offset)}
        </span>
        <button
          className="no-drag grid h-4 w-4 place-items-center rounded text-fg-subtle hover:bg-white/5 hover:text-fg"
          onClick={() => nudge(-1)}
          title="Show dashboard data 1s later"
        >
          <Plus className="h-2.5 w-2.5" />
        </button>
      </div>
    </Tooltip>
  )
}

function AvailDot({ on, label }: { on: boolean; label: string }) {
  return (
    <Tooltip content={`${label}: ${on ? 'available' : 'unavailable'}`}>
      <div className="flex items-center gap-1">
        <span className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-good' : 'bg-fg-subtle/30')} />
        <span className={cn('text-2xs', on ? 'text-fg-muted' : 'text-fg-subtle/50')}>{label}</span>
      </div>
    </Tooltip>
  )
}

export function StatusBar() {
  const providerId = useSessionStore((s) => s.providerId)
  const catalog = useSessionStore((s) => s.catalog)
  const clock = useSessionStore((s) => s.clock)
  const effectiveDataTime = useSessionStore((s) => s.effectiveDataTime)
  const syncOffset = useSyncStore((s) => s.sync.offsetSeconds)
  const duration = useSessionStore((s) => s.duration)
  const snapshot = useSessionStore((s) => s.snapshot)
  const unseen = useAlertStore((s) => s.unseen)
  const info = useAppStore((s) => s.info)

  const caps = catalog.find((c) => c.id === providerId)
  const av = snapshot?.availability

  return (
    <div className="z-30 flex h-6 shrink-0 items-center gap-3 border-t border-hairline/25 bg-bg-base/60 px-3 text-2xs text-fg-muted backdrop-blur-xl">
      <div className="flex items-center gap-1.5">
        <Database className="h-3 w-3 text-accent/70" />
        <span className="font-medium text-fg">{caps?.label ?? providerId}</span>
        {caps && caps.riskLevel !== 'none' && (
          <span className="rounded bg-warn/10 px-1 text-warn/80">{caps.riskLevel} risk</span>
        )}
      </div>

      <div className="h-3 w-px bg-hairline/30" />

      <div className="flex items-center gap-1.5 tnum">
          <span data-testid="effective-data-time" className="text-fg">{formatDuration(effectiveDataTime())}</span>
        <span className="text-fg-subtle/50">/ {formatDuration(duration)}</span>
      </div>

      {snapshot?.currentLap != null && (
        <>
          <div className="h-3 w-px bg-hairline/30" />
          <div className="flex items-center gap-1 tnum">
            <Flag className="h-3 w-3 text-fg-subtle" />
            <span className="text-fg">
              LAP {snapshot.currentLap}
              {snapshot.totalLaps ? `/${snapshot.totalLaps}` : ''}
            </span>
          </div>
        </>
      )}

      {av && (
        <>
          <div className="h-3 w-px bg-hairline/30" />
          <div className="hidden items-center gap-2.5 lg:flex">
            <AvailDot on={av.timing} label="TIMING" />
            <AvailDot on={av.laps} label="LAPS" />
            <AvailDot on={av.stints} label="TYRE" />
            <AvailDot on={av.positionProgress || av.positions} label="POS" />
            <AvailDot on={av.weather} label="WX" />
            <AvailDot on={av.telemetry} label="TELEM" />
          </div>
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2 2xl:gap-3">
        <StreamSyncChip />
        <div className="h-3 w-px bg-hairline/30" />
        <div className="flex items-center gap-1">
          <Bell className={cn('h-3 w-3', unseen > 0 ? 'text-accent' : 'text-fg-subtle')} />
          <span className={unseen > 0 ? 'text-accent' : 'text-fg-subtle'}>{unseen} alerts</span>
        </div>
        <div className="h-3 w-px bg-hairline/30" />
        <Tooltip content={info?.drmReady ? 'Widevine ready (castLabs)' : info?.drmCapable ? 'castLabs build detected, but Widevine is unavailable' : 'Standard build — DRM playback requires the castLabs Electron build'}>
          <div className="flex items-center gap-1">
            {info?.drmReady ? (
              <ShieldCheck className="h-3 w-3 text-good" />
            ) : (
              <ShieldOff className="h-3 w-3 text-fg-subtle" />
            )}
            <span className={info?.drmReady ? 'text-good' : 'text-fg-subtle'}>DRM</span>
          </div>
        </Tooltip>
        <span className="hidden text-fg-subtle/50 2xl:inline">v{info?.version ?? '0.1.0'}</span>
      </div>
    </div>
  )
}
