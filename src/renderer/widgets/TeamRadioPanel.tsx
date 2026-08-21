import { useEffect, useMemo, useRef, useState } from 'react'
import { Radio, Play, Pause } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { hexColor } from '@renderer/lib/utils'
import { cn } from '@renderer/lib/utils'

/**
 * TeamRadioPanel — driver team radio from F1's own `TeamRadio` feed.
 *
 * The feed publishes each capture as a path under the session's archive
 * directory. Those mp3s ARE served during a live session (verified: HTTP 200,
 * audio/mpeg) even though the sibling `.jsonStream` files 403 until the archive
 * is published — so radio is available live, not just in replay.
 *
 * Playback is deliberately one-at-a-time: starting a clip stops any other, so
 * the panel never talks over itself or over the video widget's audio.
 */

/** Clock time of a capture in the session's local presentation (HH:MM). */
function clockOf(utc: string): string {
  const ms = Date.parse(utc)
  if (!Number.isFinite(ms)) return '--:--'
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function TeamRadioPanel() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const favorites = useSettingsStore((s) => s.favorites)
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const clips = snapshot?.teamRadio ?? []

  // Favourites first, then newest — the feed already arrives newest-first.
  const ordered = useMemo(() => {
    if (favorites.length === 0) return clips
    const fav = new Set(favorites)
    return [...clips].sort((a, b) => {
      const af = fav.has(a.driverNumber) ? 0 : 1
      const bf = fav.has(b.driverNumber) ? 0 : 1
      return af - bf || Date.parse(b.utc) - Date.parse(a.utc)
    })
  }, [clips, favorites])

  // Stop playback when the panel unmounts so audio never outlives the widget.
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  const toggle = (url: string): void => {
    if (playing === url) {
      audioRef.current?.pause()
      setPlaying(null)
      return
    }
    audioRef.current?.pause()
    const audio = new Audio(url)
    audio.addEventListener('ended', () => setPlaying(null))
    audio.addEventListener('error', () => setPlaying(null))
    audioRef.current = audio
    setPlaying(url)
    void audio.play().catch(() => setPlaying(null))
  }

  const driverOf = (num: number) => snapshot?.drivers.find((d) => d.number === num)

  return (
    <WidgetFrame title="Team Radio" icon={<Radio className="h-4 w-4" />}>
      {ordered.length === 0 ? (
        <EmptyState
          title="No team radio yet"
          hint="Clips appear as F1 broadcasts them during the session."
        />
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto p-1">
          {ordered.map((clip) => {
            const driver = driverOf(clip.driverNumber)
            const isPlaying = playing === clip.url
            return (
              <button
                key={clip.url}
                onClick={() => toggle(clip.url)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors',
                  isPlaying
                    ? 'border-accent/40 bg-accent/10'
                    : 'border-hairline/20 bg-white/[0.02] hover:border-hairline/40'
                )}
              >
                <span
                  className="h-6 w-1 shrink-0 rounded-full"
                  style={{ background: hexColor(driver?.teamColour) }}
                />
                {isPlaying ? (
                  <Pause className="h-3.5 w-3.5 shrink-0 text-accent" />
                ) : (
                  <Play className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                )}
                <span className="text-xs font-semibold text-fg">
                  {driver?.code ?? `#${clip.driverNumber}`}
                </span>
                <span className="ml-auto text-[10px] tabular-nums text-fg-subtle">
                  {clockOf(clip.utc)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </WidgetFrame>
  )
}
