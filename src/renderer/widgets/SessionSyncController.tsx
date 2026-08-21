import { useState } from 'react'
import { Gauge, Crosshair, Save, Check, X, Plus, Minus } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Button, Segmented, Badge } from '@renderer/components/ui/primitives'
import { Slider } from '@renderer/components/ui/controls'
import { useSyncStore } from '@renderer/store/syncStore'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import {
  candidatesForDisplay,
  syncMath,
  type SyncEventType
} from '@renderer/core/engines/SessionSyncEngine'
import { SYNC_MAX_OFFSET, SYNC_MIN_OFFSET } from '@shared/constants'
import { formatOffset, formatDuration, cn } from '@renderer/lib/utils'

const EVENT_OPTS: { value: SyncEventType; label: string }[] = [
  { value: 'race-start', label: 'Start' },
  { value: 'safety-car', label: 'SC' },
  { value: 'vsc', label: 'VSC' },
  { value: 'yellow-flag', label: 'Yellow' },
  { value: 'red-flag', label: 'Red' },
  { value: 'pit', label: 'Pit' }
]

export function SessionSyncController() {
  const { sync, setOffset, nudge, candidates, buildCandidates, clearCandidates, wizardEvent, setWizardEvent } =
    useSyncStore()
  const currentSession = useSessionStore((s) => s.currentSession)
  const timeline = useSessionStore((s) => s.timeline)
  const { syncPresets, addSyncPreset, removeSyncPreset } = useSettingsStore()
  const [showAllCandidates, setShowAllCandidates] = useState(false)
  const dataShift = -sync.offsetSeconds
  const visibleCandidates = candidatesForDisplay(candidates, showAllCandidates)

  const markEvent = () => {
    if (!currentSession) return
    setShowAllCandidates(false)
    if (wizardEvent === 'race-start' && timeline?.greenStart != null) {
      alignData(timeline.greenStart)
      return
    }
    const markLiveSec = useSessionStore.getState().clock
    const startMs = currentSession.dateStart ? Date.parse(currentSession.dateStart) : Number.NaN
    buildCandidates(useSessionStore.getState().getRaceControlHistory(), markLiveSec, startMs)
  }

  const alignData = (dataSec: number) => {
    const session = useSessionStore.getState()
    const isLive = session.providerId === 'f1live' && session.currentSession?.id === 'live'
    if (isLive) {
      // Live: never seek away from the edge (the poll would yank it back and the
      // data would drift). Instead derive the broadcast delay so the dashboard is
      // held back to match the event the (delayed) video is currently showing.
      setOffset(syncMath.offsetForLiveAlignment(session.clock, dataSec))
      clearCandidates()
      return
    }
    setOffset(0)
    session.seek(dataSec)
    session.play()
    clearCandidates()
  }

  return (
    <WidgetFrame
      title="Sync Controller"
      icon={<Gauge />}
      actions={<Badge tone="accent">DATA {formatOffset(dataShift)}</Badge>}
    >
      <div className="space-y-3">
        {/* Offset control */}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-2xs uppercase tracking-wide text-fg-subtle">Data fine-tune</span>
            <span data-testid="sync-data-shift" className="tnum text-lg font-bold text-accent text-glow">
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
            This moves dashboard data only. Use + if data is behind the video; use − if it appears too early.
            Streamed or projected (TV) video often runs 20–40s behind live data — expect a larger offset there.
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
                addSyncPreset(`DATA ${formatOffset(dataShift)}`, sync.offsetSeconds, sync.broadcaster)
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

        {/* Wizard */}
        <div className="rounded-lg border border-hairline/25 bg-white/[0.02] p-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-muted">
            <Crosshair className="h-3.5 w-3.5 text-accent" /> Sync wizard
          </div>
          <p className="mb-2 text-2xs leading-snug text-fg-subtle">
            Pick the event currently visible on TOD, then mark it. On a live session, choosing a match
            measures the broadcast delay and holds the data back to match the video (it stays on the
            live edge); on a replay it jumps the dashboard to that event. Fine-tune the last seconds above.
          </p>
          <Segmented value={wizardEvent} options={EVENT_OPTS} onChange={setWizardEvent} className="mb-2 flex-wrap" />
          <Button data-testid="sync-mark-event" variant="default" size="sm" onClick={markEvent} className="w-full">
            <Crosshair className="h-3.5 w-3.5" /> Mark event on video
          </Button>

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
                  onClick={() => alignData(c.dataSec)}
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
      </div>
    </WidgetFrame>
  )
}

function Nudge({ label, dir, onClick }: { label: string; dir: 'up' | 'down'; onClick: () => void }) {
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
