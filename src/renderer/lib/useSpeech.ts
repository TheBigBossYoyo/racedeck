import { useEffect, useRef } from 'react'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useEngineerNotesStore } from '@renderer/store/engineerNotesStore'
import { clamp } from '@renderer/lib/utils'

/**
 * useVoiceReadout — speaks high-priority Engineer's Notes aloud through the
 * browser's built-in `speechSynthesis` (fully local: no network, no data leaves
 * the device, no dependency). Opt-in via Settings. It only speaks while the race
 * is PLAYING (never while scrubbing), and each note is spoken at most once, so a
 * safety car or rain call is announced as it happens without chatter. Mounted
 * once in the app shell.
 */
export function useVoiceReadout(): void {
  const enabled = useSettingsStore((s) => s.voice.enabled)
  const rate = useSettingsStore((s) => s.voice.rate)
  const playing = useSessionStore((s) => s.playing)
  const lastHighId = useEngineerNotesStore((s) => s.lastHighId)
  const spokenRef = useRef<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    if (!enabled || !playing || !lastHighId || lastHighId === spokenRef.current) return
    const note = useEngineerNotesStore.getState().notes.find((n) => n.id === lastHighId)
    if (!note) return
    spokenRef.current = lastHighId
    const utterance = new SpeechSynthesisUtterance(note.text)
    utterance.rate = clamp(rate, 0.5, 2)
    window.speechSynthesis.cancel() // supersede any stale note still queued
    window.speechSynthesis.speak(utterance)
  }, [enabled, playing, lastHighId, rate])

  // Silence immediately when muted or on unmount.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    if (!enabled) window.speechSynthesis.cancel()
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }, [enabled])
}
