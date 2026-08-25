import { useMemo } from 'react'
import { Radio, Play, Pause, FileText, Loader2 } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useRadioPlaybackStore } from '@renderer/store/radioPlaybackStore'
import { useRadioTranscriptStore } from '@renderer/store/radioTranscriptStore'
import { seekToRadioClip } from '@renderer/lib/seekToRadioClip'
import { isTranscriptionReady } from '@shared/ai'
import { hexColor } from '@renderer/lib/utils'
import { cn } from '@renderer/lib/utils'

/** Inline "Transcribe" action + result, shown only when the user's AI config supports it. */
export function TranscribeAction({ url }: { readonly url: string }) {
  const entry = useRadioTranscriptStore((s) => s.entryFor(url))
  const transcribe = useRadioTranscriptStore((s) => s.transcribe)

  if (entry.status === 'done') {
    return <p className="mt-1 text-[10px] italic leading-snug text-fg-muted">"{entry.text}"</p>
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        void transcribe(url)
      }}
      disabled={entry.status === 'loading'}
      className="mt-1 flex items-center gap-1 text-[10px] text-fg-subtle hover:text-fg-muted disabled:opacity-60"
      title={
        entry.status === 'error' ? (entry.error ?? 'Transcription failed') : 'Transcribe this clip'
      }
    >
      {entry.status === 'loading' ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      ) : (
        <FileText className="h-2.5 w-2.5" />
      )}
      {entry.status === 'loading'
        ? 'Transcribing…'
        : entry.status === 'error'
          ? 'Retry transcription'
          : 'Transcribe'}
    </button>
  )
}

/**
 * TeamRadioPanel — driver team radio from F1's own `TeamRadio` feed.
 *
 * The feed publishes each capture as a path under the session's archive
 * directory. Those mp3s ARE served during a live session (verified: HTTP 200,
 * audio/mpeg) even though the sibling `.jsonStream` files 403 until the archive
 * is published — so radio is available live, not just in replay.
 *
 * Playback is deliberately one-at-a-time across the whole dashboard (shared
 * via `radioPlaybackStore`, not local state) — starting a clip stops any
 * other, including one playing from `DriverDossier`'s per-driver radio list.
 * Clicking a clip also seeks replay to its broadcast moment
 * (APP_IMPROVEMENT_ROADMAP.md P2 item 23).
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
  const playingUrl = useRadioPlaybackStore((s) => s.playingUrl)
  const togglePlayback = useRadioPlaybackStore((s) => s.toggle)

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

  const play = (url: string, utc: string): void => {
    togglePlayback(url)
    seekToRadioClip(utc)
  }

  const driverOf = (num: number) => snapshot?.drivers.find((d) => d.number === num)
  const ai = useSettingsStore((s) => s.ai)
  const transcriptionOk = isTranscriptionReady(ai)

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
            const isPlaying = playingUrl === clip.url
            return (
              <div
                key={clip.url}
                className={cn(
                  'rounded-lg border px-2 py-1.5 transition-colors',
                  isPlaying
                    ? 'border-accent/40 bg-accent/10'
                    : 'border-hairline/20 bg-white/[0.02] hover:border-hairline/40'
                )}
              >
                <button
                  type="button"
                  onClick={() => play(clip.url, clip.utc)}
                  className="flex w-full items-center gap-2 text-left"
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
                {transcriptionOk && <TranscribeAction url={clip.url} />}
              </div>
            )
          })}
        </div>
      )}
    </WidgetFrame>
  )
}
