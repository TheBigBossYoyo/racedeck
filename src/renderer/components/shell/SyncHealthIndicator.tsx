import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Crosshair, RefreshCw } from 'lucide-react'
import { useSyncStore } from '@renderer/store/syncStore'
import { useSessionStore } from '@renderer/store/sessionStore'
import { StatusDot } from '@renderer/components/ui/primitives'
import { driftSeconds } from '@renderer/core/engines/VideoFollowEngine'
import { bestCandidate, syncMath } from '@renderer/core/engines/SessionSyncEngine'
import type { FollowStatus } from '@renderer/core/engines/VideoFollowEngine'
import { formatOffset, formatDuration, cn } from '@renderer/lib/utils'

/**
 * One-click sync health panel (APP_IMPROVEMENT_ROADMAP.md P1 item 9): a
 * compact status pill for the command bar, modeled directly on
 * `VideoModeIndicator.tsx`'s proven status-pill + dropdown pattern, surfacing
 * everything `SessionSyncController`'s follow panel already tracks (matched
 * event, video/data clock, offset, drift, last probe, pause reason) in one
 * place with two quick actions.
 */

const STATUS_META: Record<
  FollowStatus,
  { label: string; tone: 'good' | 'accent' | 'warn' | 'neutral' }
> = {
  following: { label: 'Following the video', tone: 'good' },
  uncalibrated: { label: 'Not calibrated', tone: 'neutral' },
  waiting: { label: 'Waiting for the player', tone: 'warn' },
  'needs-calibration': { label: 'Needs re-syncing', tone: 'warn' },
  off: { label: 'Follow off', tone: 'neutral' }
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between text-2xs">
      <span className="text-fg-subtle">{label}</span>
      <span className={cn('tnum', tone ?? 'text-fg')}>{value}</span>
    </div>
  )
}

export function SyncHealthIndicator() {
  const { sync, follow, anchor, lastMatchedEvent, lastProbeAtMs, calibrate, buildCandidates } =
    useSyncStore()
  const dataClock = useSessionStore((s) => s.clock)

  // Only meaningful once follow is on — off is already shown by the plain sync chip.
  if (!follow.enabled) return null

  const meta = STATUS_META[follow.status]
  const drift =
    anchor && follow.videoTime != null && lastProbeAtMs != null
      ? driftSeconds(anchor, {
          ok: true,
          currentTime: follow.videoTime,
          atMs: lastProbeAtMs,
          mediaKey: anchor.mediaKey,
          paused: follow.paused,
          seekableEnd: null,
          reason: null
        })
      : null
  const driftTone = drift != null && Math.abs(drift) >= 1 ? 'text-warn' : undefined
  const probeAgeSec =
    lastProbeAtMs != null ? Math.max(0, (Date.now() - lastProbeAtMs) / 1000) : null

  const recalibrateNow = () => {
    const session = useSessionStore.getState()
    if (!session.currentSession) return
    const markLiveSec = session.clock
    const startMs = session.currentSession.dateStart
      ? Date.parse(session.currentSession.dateStart)
      : Number.NaN
    buildCandidates(session.getRaceControlHistory(), markLiveSec, startMs)
    const best = bestCandidate(useSyncStore.getState().candidates)
    if (best) void calibrate(syncMath.offsetForLiveAlignment(markLiveSec, best.dataSec), best.label)
  }

  const anchorToCurrentMoment = () => void calibrate(sync.offsetSeconds)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="no-drag inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline/30 bg-black/20 px-2 py-1 text-2xs font-medium text-fg-muted transition-colors hover:border-hairline/60 hover:text-fg"
          title={follow.status === 'following' ? 'Sync health' : (follow.detail ?? meta.label)}
        >
          <StatusDot tone={meta.tone} pulse={follow.status === 'following'} />
          <span className="hidden uppercase tracking-wide min-[1800px]:inline">Sync</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[100] w-72 animate-fade-in rounded-xl border border-hairline/40 bg-bg-overlay/95 p-1.5 shadow-glass-lg backdrop-blur-xl"
        >
          <div className="px-2 py-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-fg-muted">
              {meta.label}
            </div>
            <div className="mt-1 space-y-0.5">
              <Row label="Matched event" value={lastMatchedEvent ?? '—'} />
              <Row
                label="Video clock"
                value={follow.videoTime != null ? formatDuration(follow.videoTime) : '—'}
              />
              <Row label="Data clock" value={formatDuration(dataClock)} />
              <Row label="Offset" value={formatOffset(sync.offsetSeconds)} />
              <Row
                label="Drift"
                value={drift != null ? `${drift >= 0 ? '+' : ''}${drift.toFixed(1)}s` : '—'}
                tone={driftTone}
              />
              <Row
                label="Last probe"
                value={probeAgeSec != null ? `${probeAgeSec.toFixed(0)}s ago` : '—'}
              />
            </div>
            {follow.status !== 'following' && follow.detail && (
              <p className="mt-2 rounded-md border border-warn/20 bg-warn/5 p-1.5 text-2xs leading-snug text-warn/90">
                {follow.detail}
              </p>
            )}
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-hairline/30" />
          <DropdownMenu.Item
            onSelect={recalibrateNow}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-fg-muted outline-none transition-colors data-[highlighted]:bg-white/5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Recalibrate now
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={anchorToCurrentMoment}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-fg-muted outline-none transition-colors data-[highlighted]:bg-white/5"
          >
            <Crosshair className="h-3.5 w-3.5" /> Use current moment as anchor
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
