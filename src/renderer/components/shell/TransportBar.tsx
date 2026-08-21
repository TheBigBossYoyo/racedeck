import { useRef } from 'react'
import { Play, Pause, SkipBack, SkipForward, Circle, Flag } from 'lucide-react'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSyncStore } from '@renderer/store/syncStore'
import { Button, Segmented } from '@renderer/components/ui/primitives'
import { Slider } from '@renderer/components/ui/controls'
import { formatDuration } from '@renderer/lib/utils'
import { cn } from '@renderer/lib/utils'
import { phaseAt, phaseMeta, type SessionTimeline } from '@renderer/core/engines/SessionPhaseEngine'
import { syncMath } from '@renderer/core/engines/SessionSyncEngine'

const SPEEDS = [
  { value: '0.5', label: '0.5×' },
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
  { value: '4', label: '4×' },
  { value: '8', label: '8×' }
]

export function TransportBar({ showScrubber = true }: { showScrubber?: boolean }) {
  const { playing, togglePlay, clock, duration, seek, step, speed, setSpeed } = useSessionStore()
  const timeline = useSessionStore((s) => s.timeline)
  const currentLap = useSessionStore((s) => s.snapshot?.currentLap ?? null)
  const effectiveDataTime = useSessionStore((s) => s.effectiveDataTime)
  const offset = useSyncStore((s) => s.sync.offsetSeconds)
  const dataT = effectiveDataTime()
  const dataRange = syncMath.dataRangeForVideoSession(duration, offset)
  const seekDataTime = (dataTime: number) => {
    const reachable = Math.min(dataRange.max, Math.max(dataRange.min, dataTime))
    seek(syncMath.videoTimeForData(reachable, offset))
  }

  return (
    <div className="flex min-w-0 max-w-[380px] flex-[1_1_220px] items-center gap-1 overflow-hidden min-[1800px]:max-w-none min-[1800px]:flex-1 2xl:gap-2">
      <div className="flex shrink-0 items-center gap-0.5">
        <Button size="icon" variant="ghost" onClick={() => step(-10)} title="Back 10s">
          <SkipBack className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="solid"
          onClick={togglePlay}
          title={playing ? 'Pause' : 'Play'}
          className="h-8 w-8 rounded-full"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
        </Button>
        <Button size="icon" variant="ghost" onClick={() => step(10)} title="Forward 10s">
          <SkipForward className="h-3.5 w-3.5" />
        </Button>
      </div>

      {showScrubber && timeline && <PhaseChip timeline={timeline} t={dataT} liveLap={currentLap} />}

      {showScrubber && (
        <>
          <span className="tnum hidden w-11 shrink-0 text-right text-2xs text-fg-muted min-[1800px]:inline-block">
            {formatDuration(dataT)}
          </span>
          <div className="relative flex min-w-0 flex-1 flex-col justify-center gap-1 overflow-hidden">
            <Slider
               min={dataRange.min}
               max={Math.max(dataRange.min, dataRange.max)}
              step={0.5}
              value={[dataT]}
               onValueChange={([v]) => seekDataTime(v)}
            />
            {timeline && duration > 0 && (
              <PhaseStrip
                timeline={timeline}
                duration={duration}
                clock={dataT}
                 onSeek={seekDataTime}
              />
            )}
          </div>
          <span className="tnum hidden w-11 shrink-0 text-2xs text-fg-subtle min-[1800px]:inline-block">
            {formatDuration(duration)}
          </span>
        </>
      )}

      <div className="hidden shrink-0 items-center gap-1.5 min-[1800px]:flex">
        <Circle
          className={cn(
            'h-2 w-2',
            playing ? 'animate-pulse fill-good text-good' : 'fill-fg-subtle/40 text-fg-subtle/40'
          )}
        />
        <Segmented value={String(speed)} options={SPEEDS} onChange={(v) => setSpeed(Number(v))} />
      </div>
    </div>
  )
}

/** Compact pill showing the current race phase (e.g. "Lap 32/52", "Safety Car"). */
function PhaseChip({
  timeline,
  t,
  liveLap
}: {
  timeline: SessionTimeline
  t: number
  liveLap: number | null
}) {
  const phase = phaseAt(timeline, t)
  const meta = phaseMeta(phase.kind)
  // Prefer the live snapshot lap for green-flag racing (more precise than the
  // segment's boundary lap).
  const lap = phase.kind !== 'pre' && phase.kind !== 'post' ? liveLap ?? phase.lap : null
  const label =
    lap != null && timeline.totalLaps && (phase.kind === 'green')
      ? `Lap ${lap}/${timeline.totalLaps}`
      : phase.label
  return (
    <span
      className="hidden shrink-0 items-center gap-1.5 rounded-md border border-hairline/30 bg-black/20 px-2 py-1 text-2xs font-semibold text-fg min-[1800px]:inline-flex"
      title={phase.label}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
      <span className="tnum whitespace-nowrap">{label}</span>
    </span>
  )
}

/** Thin colour strip under the scrubber marking pre-race / racing / SC / post. */
function PhaseStrip({
  timeline,
  duration,
  clock,
  onSeek
}: {
  timeline: SessionTimeline
  duration: number
  clock: number
  onSeek: (t: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / duration) * 100))}%`

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const f = (e.clientX - rect.left) / rect.width
    onSeek(Math.max(0, Math.min(duration, f * duration)))
  }

  const segTitle = (seg: (typeof timeline.segments)[number]) => {
    const meta = phaseMeta(seg.kind)
    const laps =
      seg.lapStart != null && seg.lapEnd != null && seg.lapStart !== seg.lapEnd
        ? ` · laps ${seg.lapStart}–${seg.lapEnd}`
        : seg.lapStart != null
          ? ` · lap ${seg.lapStart}`
          : ''
    return `${meta.label}${laps} — click to jump`
  }

  return (
    <div
      ref={ref}
      onClick={handleClick}
      className="no-drag relative h-2 w-full cursor-pointer overflow-hidden rounded-full bg-black/10 ring-1 ring-hairline/25"
      title="Race phases — click to jump"
    >
      {timeline.segments.map((seg, i) => {
        const meta = phaseMeta(seg.kind)
        const dim = seg.kind === 'pre' || seg.kind === 'post'
        return (
          <div
            key={i}
            className="absolute top-0 h-full"
            style={{
              left: pct(seg.tStart),
              width: pct(seg.tEnd - seg.tStart),
              backgroundColor: meta.color,
              opacity: dim ? 0.55 : 1
            }}
            title={segTitle(seg)}
          />
        )
      })}
      {/* Green-flag start marker */}
      {timeline.greenStart != null && timeline.greenStart > 0.5 && (
        <div
          className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
          style={{ left: pct(timeline.greenStart) }}
          title="Lights out"
        >
          <Flag className="h-2 w-2 text-white drop-shadow" />
        </div>
      )}
      {/* Playhead */}
      <div
        className="absolute top-0 z-10 h-full w-px bg-white/90"
        style={{ left: pct(clock) }}
      />
    </div>
  )
}
