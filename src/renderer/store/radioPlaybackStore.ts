import { create } from 'zustand'

/**
 * Shared team-radio playback state (APP_IMPROVEMENT_ROADMAP.md P2 item 23) —
 * a module-level singleton so `TeamRadioPanel` and `DriverDossier`'s per-driver
 * radio list, mounted as independent widgets, still enforce "one clip plays at
 * a time" across the whole dashboard rather than each having its own audio
 * element.
 */
interface RadioPlaybackState {
  playingUrl: string | null
  audio: HTMLAudioElement | null
  /** Play `url`, stopping whatever else is playing; toggling the same url stops it. */
  toggle: (url: string) => void
}

export const useRadioPlaybackStore = create<RadioPlaybackState>((set, get) => ({
  playingUrl: null,
  audio: null,
  toggle: (url) => {
    const { playingUrl, audio } = get()
    audio?.pause()
    if (playingUrl === url) {
      set({ playingUrl: null, audio: null })
      return
    }
    const next = new Audio(url)
    const stop = () => set({ playingUrl: null, audio: null })
    // A blocked/failed load (e.g. a CSP media-src gap, like the one that
    // silently broke this entirely until diagnosed) used to reset state with
    // zero trace, making "the button does nothing" look identical to "the
    // click didn't register" — logging here means a future regression shows
    // up in devtools instead of just looking broken.
    const onError = () => {
      console.error(`[radioPlaybackStore] Failed to play team radio clip: ${url}`)
      stop()
    }
    next.addEventListener('ended', stop)
    next.addEventListener('error', onError)
    set({ playingUrl: url, audio: next })
    void next.play().catch(onError)
  }
}))
