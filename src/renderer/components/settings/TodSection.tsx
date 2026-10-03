import { Tv } from 'lucide-react'
import { Badge } from '@renderer/components/ui/primitives'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useVideoStore } from '@renderer/store/videoStore'
import { describeMode } from '@shared/video-fallback'
import { cn } from '@renderer/lib/utils'
import { Section } from './Section'
import { Toggle } from './Toggle'

function Stat({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div className="rounded-md border border-hairline/20 bg-black/20 px-2 py-1">
      <div className="text-fg-subtle">{k}</div>
      <div className={cn('font-semibold capitalize', good ? 'text-good' : 'text-fg')}>{v}</div>
    </div>
  )
}

export function TodSection() {
  const { tod, setTod } = useSettingsStore()
  const video = useVideoStore((s) => s.state)

  return (
    <Section
      icon={<Tv className="h-4 w-4" />}
      title="TOD integration"
      desc="How the TOD broadcast surface is presented."
    >
      <div className="mb-3 rounded-xl border border-hairline/25 bg-white/[0.02] p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-fg">{describeMode(video.mode).label}</span>
          <Badge
            tone={
              video.mode === 'embedded' ? 'good' : video.mode === 'companion' ? 'accent' : 'warn'
            }
          >
            {describeMode(video.mode).short}
          </Badge>
        </div>
        <p className="mt-1 text-2xs text-fg-muted">{describeMode(video.mode).blurb}</p>
        {video.fallbackReason && (
          <p className="mt-2 rounded-md border border-warn/20 bg-warn/5 p-2 text-2xs text-warn/90">
            {video.fallbackReason}
          </p>
        )}
        <div className="mt-2 grid grid-cols-3 gap-2 text-2xs">
          <Stat
            k="Widevine DRM"
            v={video.drmReady ? 'Ready' : 'Unavailable'}
            good={video.drmReady}
          />
          <Stat k="Embedded OK" v={video.embeddedSupported} />
          <Stat k="Playback" v={video.playbackActive} />
        </div>
      </div>
      <Toggle
        label="Auto-fallback to companion window"
        hint="If embedding is blocked, open a docked companion window automatically."
        checked={tod.autoFallback}
        onChange={(v) => setTod({ autoFallback: v })}
      />
      <div className="mt-2">
        <label className="text-2xs uppercase tracking-wide text-fg-subtle">TOD URL</label>
        <input
          value={tod.url}
          onChange={(e) => setTod({ url: e.target.value })}
          className="mt-1 w-full rounded-lg border border-hairline/40 bg-black/30 px-3 py-1.5 text-xs text-fg outline-none focus:border-accent/50"
        />
      </div>
    </Section>
  )
}
