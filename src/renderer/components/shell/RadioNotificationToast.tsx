import { useEffect } from 'react'
import { Radio, Play, X } from 'lucide-react'
import { useRadioNotifyStore } from '@renderer/store/radioNotifyStore'
import { useRadioPlaybackStore } from '@renderer/store/radioPlaybackStore'
import { seekToRadioClip } from '@renderer/lib/seekToRadioClip'
import { hexColor } from '@renderer/lib/utils'

/**
 * Discrete "new team radio" popup (round-3 live-session feedback). Mirrors
 * `LiveConnectionBanner`'s single-notice toast shape, positioned separately
 * (bottom-right) so the two never collide. Auto-dismisses if ignored — radio
 * chatter is time-sensitive, and an unanswered prompt piling up forever would
 * be the opposite of "discrete".
 */

const AUTO_DISMISS_MS = 8_000

export function RadioNotificationToast() {
  const current = useRadioNotifyStore((s) => s.current)
  const dismiss = useRadioNotifyStore((s) => s.dismiss)
  const togglePlayback = useRadioPlaybackStore((s) => s.toggle)

  useEffect(() => {
    if (!current) return
    const timer = window.setTimeout(dismiss, AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [current, dismiss])

  if (!current) return null

  const listen = () => {
    togglePlayback(current.url)
    seekToRadioClip(current.utc)
    dismiss()
  }

  return (
    <div
      role="status"
      className="pointer-events-auto fixed bottom-14 right-4 z-[85] flex w-[min(320px,calc(100vw-2rem))] items-center gap-3 rounded-xl border border-accent/35 bg-bg-overlay/95 p-3 shadow-glass-lg backdrop-blur-xl animate-fade-in"
    >
      <span
        className="h-8 w-1 shrink-0 rounded-full"
        style={{ background: hexColor(current.teamColour) }}
      />
      <Radio className="h-4 w-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-fg">{current.code} team radio</p>
        <p className="mt-0.5 text-2xs text-fg-muted">New message just in</p>
      </div>
      <button
        type="button"
        onClick={listen}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-2xs font-medium text-accent transition-colors hover:bg-accent/20"
      >
        <Play className="h-3 w-3" /> Listen
      </button>
      <button
        type="button"
        aria-label="Dismiss radio notification"
        onClick={dismiss}
        className="shrink-0 rounded p-0.5 text-fg-subtle transition-colors hover:bg-white/5 hover:text-fg"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
