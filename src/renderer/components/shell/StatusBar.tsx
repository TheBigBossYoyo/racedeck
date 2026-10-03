import {
  Bell,
  ShieldCheck,
  ShieldOff,
  Database,
  Flag,
  Radio,
  Minus,
  Plus,
  AlertTriangle,
  Info,
  Loader2
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useAlertStore } from '@renderer/store/alertStore'
import { useAppStore } from '@renderer/store/appStore'
import { useSyncStore } from '@renderer/store/syncStore'
import { useLiveStore } from '@renderer/store/liveStore'
import { usePersistStatusStore } from '@renderer/store/persistStatusStore'
import { persist } from '@renderer/store/persist'
import { Tooltip } from '@renderer/components/ui/controls'
import { formatDuration, formatOffset } from '@renderer/lib/utils'
import { cn } from '@renderer/lib/utils'
import { buildSystemStatus, type SystemStatusEntry } from '@renderer/core/engines/SystemStatus'
import { recalibrateNow } from '@renderer/components/shell/SyncHealthIndicator'

const SEVERITY_TONE: Record<SystemStatusEntry['severity'], string> = {
  info: 'text-fg-muted',
  warning: 'text-warn',
  danger: 'text-danger'
}

function runRecoveryAction(id: SystemStatusEntry['recoveryActionId']): void {
  switch (id) {
    case 'sign-in':
      useLiveStore.getState().openLogin()
      break
    case 'reconnect':
      void useLiveStore.getState().connect()
      break
    case 'recalibrate-sync':
      recalibrateNow()
      break
    case 'retry-session':
      void useSessionStore.getState().reloadSession()
      break
    case 'reset-corrupted-data':
      void persist.resetCorrupted()
      break
    case 'dismiss-persist-recovery':
      usePersistStatusStore.getState().dismissRecovery()
      break
  }
}

const RECOVERY_LABEL: Record<NonNullable<SystemStatusEntry['recoveryActionId']>, string> = {
  'sign-in': 'Sign in',
  reconnect: 'Reconnect',
  'recalibrate-sync': 'Recalibrate sync',
  'retry-session': 'Retry',
  'reset-corrupted-data': 'Reset to defaults',
  'dismiss-persist-recovery': 'Dismiss'
}

/** Unified error/recovery panel (APP_IMPROVEMENT_ROADMAP.md P2 item 28). */
function IssuesIndicator() {
  const sessionError = useSessionStore((s) => s.error)
  const liveStatus = useLiveStore((s) => s.status)
  const loggedIn = useLiveStore((s) => s.loggedIn)
  const reconnect = useLiveStore((s) => s.reconnect)
  const follow = useSyncStore((s) => s.follow)
  const info = useAppStore((s) => s.info)
  const getDiagnostics = useSessionStore((s) => s.getDiagnostics)
  const persistCorruptions = usePersistStatusStore((s) => s.corruptions)
  const persistRecoveredBackup = usePersistStatusStore((s) => s.recoveredBackup)

  const diagnostics = getDiagnostics()
  const entries = buildSystemStatus({
    sessionError,
    liveStatus,
    loggedIn,
    followStatus: follow.status,
    followDetail: follow.detail,
    drmCapable: info?.drmCapable ?? false,
    drmReady: info?.drmReady ?? false,
    enrichmentIssue: diagnostics?.enrichmentIssue ?? null,
    enrichmentProgress: diagnostics?.enrichmentProgress ?? null,
    feedQuality: diagnostics?.feedQuality ?? null,
    persistCorruptions,
    persistRecoveredBackup,
    reconnect
  })

  if (entries.length === 0) return null

  // Running-normally progress and informational notes are listed but are not
  // issues, so they neither inflate the count nor take the warning styling.
  const issueCount = entries.filter((e) => !e.ongoing && !e.informational).length
  const progressEntry = entries.find((e) => e.ongoing)
  const noteEntry = entries.find((e) => e.informational)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {issueCount > 0 ? (
          <button
            className="no-drag flex items-center gap-1"
            title={`${issueCount} active issue${issueCount === 1 ? '' : 's'}`}
          >
            <AlertTriangle className="h-3 w-3 text-warn" />
            <span className="text-warn">
              {issueCount} issue{issueCount === 1 ? '' : 's'}
            </span>
          </button>
        ) : progressEntry ? (
          <button
            className="no-drag flex max-w-[28rem] items-center gap-1"
            title={progressEntry.message}
          >
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-fg-subtle" aria-hidden="true" />
            <span className="tnum truncate text-fg-muted">{progressEntry.message}</span>
          </button>
        ) : (
          <button
            className="no-drag flex items-center gap-1 text-fg-subtle"
            title={noteEntry?.message}
          >
            <Info className="h-3 w-3" aria-hidden="true" />
            <span>Data notes</span>
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[100] w-80 animate-fade-in space-y-2 rounded-xl border border-hairline/40 bg-bg-overlay/95 p-2.5 shadow-glass-lg backdrop-blur-xl"
        >
          {entries.map((entry, i) => (
            <div key={i} className="rounded-lg border border-hairline/20 bg-white/[0.02] p-2">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-wide',
                    SEVERITY_TONE[entry.severity]
                  )}
                >
                  {entry.category}
                </span>
                {entry.recoveryActionId && (
                  <button
                    className="rounded-md border border-hairline/30 px-1.5 py-0.5 text-2xs text-fg-muted transition-colors hover:border-accent/50 hover:text-fg"
                    onClick={() => runRecoveryAction(entry.recoveryActionId)}
                  >
                    {RECOVERY_LABEL[entry.recoveryActionId]}
                  </button>
                )}
              </div>
              <p className="mt-1 text-2xs leading-snug text-fg">{entry.message}</p>
              {entry.whatStillWorks && (
                <p className="mt-0.5 text-2xs leading-snug text-fg-subtle">
                  {entry.whatStillWorks}
                </p>
              )}
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

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
        <span data-testid="effective-data-time" className="text-fg">
          {formatDuration(effectiveDataTime())}
        </span>
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
            <AvailDot on={(snapshot?.teamRadio?.length ?? 0) > 0} label="RADIO" />
            <AvailDot on={(snapshot?.pitLaneTimes?.length ?? 0) > 0} label="PIT" />
          </div>
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2 2xl:gap-3">
        <IssuesIndicator />
        <StreamSyncChip />
        <div className="h-3 w-px bg-hairline/30" />
        <div className="flex items-center gap-1">
          <Bell className={cn('h-3 w-3', unseen > 0 ? 'text-accent' : 'text-fg-subtle')} />
          <span className={unseen > 0 ? 'text-accent' : 'text-fg-subtle'}>{unseen} alerts</span>
        </div>
        <div className="h-3 w-px bg-hairline/30" />
        <Tooltip
          content={
            info?.drmReady
              ? 'Widevine ready (castLabs)'
              : info?.drmCapable
                ? 'castLabs build detected, but Widevine is unavailable'
                : 'Standard build — DRM playback requires the castLabs Electron build'
          }
        >
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
