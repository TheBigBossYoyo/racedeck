import { useState } from 'react'
import {
  Gauge,
  Crosshair,
  Save,
  Check,
  X,
  Plus,
  Minus,
  Link2,
  Link2Off,
  Loader2,
  AlertTriangle,
  PauseCircle
} from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Button, Segmented, Badge } from '@renderer/components/ui/primitives'
import { Slider } from '@renderer/components/ui/controls'
import { useSyncStore } from '@renderer/store/syncStore'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import {
  bestCandidate,
  candidatesForDisplay,
  syncMath,
  type SyncCandidate,
  type SyncEventType
} from '@renderer/core/engines/SessionSyncEngine'
import { SYNC_MAX_OFFSET, SYNC_MIN_OFFSET } from '@shared/constants'
import { formatOffset, formatDuration, cn } from '@renderer/lib/utils'

const EVENT_OPTS: { value: SyncEventType; label: string }[] = [
  { value: 'race-control', label: 'Anything' },
  { value: 'race-start', label: 'Start' },
  { value: 'safety-car', label: 'SC' },
  { value: 'vsc', label: 'VSC' },
  { value: 'yellow-flag', label: 'Yellow' },
  { value: 'red-flag', label: 'Red' },
  { value: 'pit', label: 'Pit' }
]

export function SessionSyncController() {
  const {
    sync,
    setOffset,
    nudge,
    calibrate,
    candidates,
    buildCandidates,
    clearCandidates,
    wizardEvent,
    setWizardEvent,
    follow,
    followEligible,
    setFollowEnabled
  } = useSyncStore()
  const currentSession = useSessionStore((s) => s.currentSession)
  const providerId = useSessionStore((s) => s.providerId)
  const timeline = useSessionStore((s) => s.timeline)
  const { syncPresets, addSyncPreset, removeSyncPreset } = useSettingsStore()
  const [showAllCandidates, setShowAllCandidates] = useState(false)
  const [autoMatched, setAutoMatched] = useState<SyncCandidate | null>(null)
  const dataShift = -sync.offsetSeconds
  const visibleCandidates = candidatesForDisplay(candidates, showAllCandidates)

  const isLive = providerId === 'f1live' && currentSession?.id === 'live'

  const markEvent = () => {
    if (!currentSession) return
    setShowAllCandidates(false)
    setAutoMatched(null)
    if (wizardEvent === 'race-start' && timeline?.greenStart != null) {
      alignData(timeline.greenStart, 'Race start (lights out)')
      return
    }
    const markLiveSec = useSessionStore.getState().clock
    const startMs = currentSession.dateStart ? Date.parse(currentSession.dateStart) : Number.NaN
    buildCandidates(useSessionStore.getState().getRaceControlHistory(), markLiveSec, startMs)
    // An unambiguous match is applied straight away — the common case becomes
    // one button press rather than a press and a choice.
    const best = bestCandidate(useSyncStore.getState().candidates)
    if (best) {
      setAutoMatched(best)
      alignData(best.dataSec, best.label)
    }
  }

  const alignData = (dataSec: number, label?: string) => {
    const session = useSessionStore.getState()
    if (isLive) {
      // Live: never seek away from the edge (the poll would yank it back and the
      // data would drift). Instead derive the broadcast delay so the dashboard is
      // held back to match the event the (delayed) video is currently showing —
      // and anchor follow to it, so it survives the next pause or rewind.
      void calibrate(syncMath.offsetForLiveAlignment(session.clock, dataSec), label)
      clearCandidates()
      return
    }
    setOffset(0)
    session.seek(dataSec)
    session.play()
    clearCandidates()
  }

  const reopenCandidates = () => {
    setAutoMatched(null)
    if (!currentSession) return
    const markLiveSec = useSessionStore.getState().clock
    const startMs = currentSession.dateStart ? Date.parse(currentSession.dateStart) : Number.NaN
    buildCandidates(useSessionStore.getState().getRaceControlHistory(), markLiveSec, startMs)
    setShowAllCandidates(true)
  }

  return (
    <WidgetFrame
      title="Sync Controller"
      icon={<Gauge />}
      actions={<Badge tone="accent">DATA {formatOffset(dataShift)}</Badge>}
    >
      <div className="space-y-3">
        <FollowPanel
          follow={follow}
          eligible={followEligible}
          onToggle={(enabled) => void setFollowEnabled(enabled)}
        />

        {/* Wizard — the one place a delay actually gets established */}
        <div className="rounded-lg border border-hairline/25 bg-white/[0.02] p-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-muted">
            <Crosshair className="h-3.5 w-3.5 text-accent" /> Set the delay
          </div>
          <p className="mb-2 text-2xs leading-snug text-fg-subtle">
            When something happens on the TOD video — a flag, a safety car, a pit stop — press this
            straight away. RaceDeck finds the same moment in the data and works out how far behind
            the video is. Leave the picker on <span className="text-fg-muted">Anything</span> unless
            the match comes out wrong.
          </p>
          <Segmented
            value={wizardEvent}
            options={EVENT_OPTS}
            onChange={(value) => {
              setWizardEvent(value)
              setAutoMatched(null)
            }}
            className="mb-2 flex-wrap"
          />
          <Button
            data-testid="sync-mark-event"
            variant="default"
            size="sm"
            onClick={markEvent}
            className="w-full"
          >
            <Crosshair className="h-3.5 w-3.5" /> I just saw it on the video
          </Button>

          {autoMatched && (
            <div className="mt-2 rounded-md border border-good/30 bg-good/5 px-2 py-1.5">
              <div className="flex items-start gap-1.5">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-fg">{autoMatched.label}</p>
                  <p className="tnum text-[10px] text-fg-subtle">
                    Matched at {formatDuration(autoMatched.dataSec)} · data now{' '}
                    {formatOffset(dataShift)}
                  </p>
                </div>
              </div>
              <button
                onClick={reopenCandidates}
                className="mt-1 text-[10px] text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
              >
                Not that one — show other matches
              </button>
            </div>
          )}

          {candidates.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-2xs text-fg-subtle">Matching data events</span>
                <button onClick={clearCandidates} className="text-2xs text-fg-subtle hover:text-fg">
                  clear
                </button>
              </div>
              {visibleCandidates.map((c) => (
                <button
                  key={c.id}
                  onClick={() => alignData(c.dataSec, c.label)}
                  className="flex w-full items-center gap-2 rounded-md border border-hairline/25 bg-black/20 px-2 py-1 text-left transition-colors hover:border-accent/40 hover:bg-accent/5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] text-fg">{c.label}</p>
                    <span className="tnum text-[10px] text-fg-subtle">
                      @ {formatDuration(c.dataSec)}
                    </span>
                  </div>
                  <span className="tnum shrink-0 text-2xs font-semibold text-accent">
                    Align {formatDuration(c.dataSec)}
                  </span>
                  <Check className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                </button>
              ))}
              {candidates.length > 12 && (
                <button
                  onClick={() => setShowAllCandidates((visible) => !visible)}
                  className="w-full rounded-md border border-hairline/25 px-2 py-1 text-2xs text-fg-muted hover:border-accent/40 hover:text-fg"
                >
                  {showAllCandidates ? 'Show nearest 12' : `Show all ${candidates.length} matches`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Offset control */}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-2xs uppercase tracking-wide text-fg-subtle">Data fine-tune</span>
            <span
              data-testid="sync-data-shift"
              className="tnum text-lg font-bold text-accent text-glow"
            >
              {formatOffset(dataShift)}
            </span>
          </div>
          <Slider
            min={-SYNC_MAX_OFFSET}
            max={-SYNC_MIN_OFFSET}
            step={0.5}
            value={[dataShift]}
            onValueChange={([v]) => setOffset(-v)}
          />
          <p className="mt-1.5 text-2xs leading-snug text-fg-subtle">
            This moves dashboard data only. Use + if data is behind the video; use − if it appears
            too early. Streamed or projected (TV) video often runs 20–40s behind live data — expect
            a larger offset there.
            {follow.status === 'following' &&
              ' Adjusting here re-anchors auto-follow to your correction.'}
          </p>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            <Nudge label="+5s" dir="up" onClick={() => nudge(-5)} />
            <Nudge label="+1s" dir="up" onClick={() => nudge(-1)} />
            <Nudge label="−1s" dir="down" onClick={() => nudge(1)} />
            <Nudge label="−5s" dir="down" onClick={() => nudge(5)} />
          </div>
        </div>

        {/* Presets */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-2xs uppercase tracking-wide text-fg-subtle">Presets</span>
            <button
              onClick={() =>
                addSyncPreset(
                  `DATA ${formatOffset(dataShift)}`,
                  sync.offsetSeconds,
                  sync.broadcaster
                )
              }
              className="flex items-center gap-1 rounded-md border border-hairline/30 px-1.5 py-0.5 text-2xs text-fg-muted hover:text-fg"
            >
              <Save className="h-3 w-3" /> Save current
            </button>
          </div>
          {syncPresets.length === 0 ? (
            <p className="text-2xs text-fg-subtle">No saved presets yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {syncPresets.map((p) => (
                <div
                  key={p.id}
                  className="group flex items-center gap-1 rounded-md border border-hairline/30 bg-white/[0.03] px-1.5 py-0.5"
                >
                  <button
                    onClick={() => setOffset(p.offset)}
                    className="tnum text-2xs text-fg-muted hover:text-accent"
                  >
                    {p.name}
                  </button>
                  <button
                    onClick={() => removeSyncPreset(p.id)}
                    className="text-fg-subtle opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </WidgetFrame>
  )
}

/**
 * Auto-follow: the toggle plus an honest account of what it is doing.
 *
 * The status matters as much as the switch. "Following" has to mean the offset
 * is actively maintained, and every state where it is NOT has to say so rather
 * than leaving a stale number looking authoritative.
 */
function FollowPanel({
  follow,
  eligible,
  onToggle
}: {
  follow: { enabled: boolean; status: string; detail: string | null; paused: boolean }
  eligible: boolean
  onToggle: (enabled: boolean) => void
}) {
  const tone =
    follow.status === 'following'
      ? {
          icon: <Link2 className="h-3.5 w-3.5 text-good" />,
          text: 'Following the video',
          cls: 'text-good'
        }
      : follow.status === 'waiting'
        ? {
            icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-subtle" />,
            text: 'Waiting for the player',
            cls: 'text-fg-muted'
          }
        : follow.status === 'needs-calibration'
          ? {
              icon: <AlertTriangle className="h-3.5 w-3.5 text-warn" />,
              text: 'Needs re-syncing',
              cls: 'text-warn'
            }
          : follow.status === 'uncalibrated'
            ? {
                icon: <Crosshair className="h-3.5 w-3.5 text-accent" />,
                text: 'Set the delay below',
                cls: 'text-fg-muted'
              }
            : {
                icon: <Link2Off className="h-3.5 w-3.5 text-fg-subtle" />,
                text: 'Off',
                cls: 'text-fg-subtle'
              }

  return (
    <div className="rounded-lg border border-hairline/25 bg-white/[0.02] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {tone.icon}
          <span className={cn('truncate text-2xs font-semibold uppercase tracking-wide', tone.cls)}>
            Auto-follow · {tone.text}
          </span>
        </div>
        <Button
          size="sm"
          variant={follow.enabled ? 'outline' : 'solid'}
          disabled={!eligible}
          onClick={() => onToggle(!follow.enabled)}
        >
          {follow.enabled ? 'Turn off' : 'Turn on'}
        </Button>
      </div>
      <p className="mt-1.5 text-2xs leading-snug text-fg-subtle">
        {!eligible
          ? 'Available on a live session. In replay both clocks are yours to scrub, so there is nothing to follow.'
          : follow.detail
            ? follow.detail
            : follow.enabled
              ? 'Set the delay once below. Pauses, rewinds and buffering are then measured from the player and the dashboard keeps itself aligned.'
              : 'Keeps the dashboard aligned by itself after one calibration — including when you pause or rewind the video.'}
      </p>
      {follow.enabled && follow.paused && follow.status === 'following' && (
        <div className="mt-1.5 flex items-center gap-1.5 text-2xs text-fg-muted">
          <PauseCircle className="h-3.5 w-3.5 text-warn" />
          Video paused — the dashboard is being held back with it.
        </div>
      )}
    </div>
  )
}

function Nudge({
  label,
  dir,
  onClick
}: {
  label: string
  dir: 'up' | 'down'
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-0.5 rounded-md border border-hairline/30 bg-black/20 py-1.5 text-2xs font-medium text-fg-muted transition-colors hover:border-hairline/60 hover:text-fg'
      )}
    >
      {dir === 'up' ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
      {label}
    </button>
  )
}
