import { create } from 'zustand'
import { STORE_NS } from '@shared/ipc-contract'
import { hasBridge, bridge } from '@renderer/lib/ipc'
import { useSettingsStore } from './settingsStore'
import { persist } from './persist'

/**
 * Team-radio transcripts (round-2 live-session feedback: "Did you add
 * anything related to the radios like I asked? MP3 and retranscriptions.").
 * Cached persistently, keyed by clip URL, so a clip is never re-sent to the
 * user's AI provider once transcribed — that would burn their API quota for
 * nothing. Mirrors `comparisonLibraryStore`'s single-blob persistence shape.
 */

export type TranscriptStatus = 'idle' | 'loading' | 'done' | 'error'

export interface TranscriptEntry {
  status: TranscriptStatus
  text: string
  error: string | null
}

interface RadioTranscriptState {
  hydrated: boolean
  entries: Record<string, TranscriptEntry>

  hydrate: () => Promise<void>
  entryFor: (url: string) => TranscriptEntry
  transcribe: (url: string) => Promise<void>
}

const K = { entries: 'entries' }
const IDLE: TranscriptEntry = { status: 'idle', text: '', error: null }

function isEntryMap(v: unknown): v is Record<string, TranscriptEntry> {
  return (
    Boolean(v) &&
    typeof v === 'object' &&
    Object.values(v as Record<string, unknown>).every(
      (e) => e && typeof e === 'object' && typeof (e as TranscriptEntry).status === 'string'
    )
  )
}

export const useRadioTranscriptStore = create<RadioTranscriptState>((set, get) => ({
  hydrated: false,
  entries: {},

  hydrate: async () => {
    const raw = await persist.get<unknown>(STORE_NS.RADIO_TRANSCRIPTS, K.entries)
    set({ entries: isEntryMap(raw) ? raw : {}, hydrated: true })
  },

  entryFor: (url) => get().entries[url] ?? IDLE,

  transcribe: async (url) => {
    const current = get().entries[url]
    if (current?.status === 'loading' || current?.status === 'done') return

    const setEntry = (entry: TranscriptEntry, persistIt: boolean) => {
      const entries = { ...get().entries, [url]: entry }
      set({ entries })
      if (persistIt) void persist.set(STORE_NS.RADIO_TRANSCRIPTS, K.entries, entries)
    }

    if (!hasBridge()) {
      return setEntry(
        { status: 'error', text: '', error: 'Transcription needs the desktop app.' },
        false
      )
    }
    const ai = useSettingsStore.getState().ai
    setEntry({ status: 'loading', text: '', error: null }, false)
    const res = await bridge().ai.transcribe({ config: ai, audioUrl: url })
    if (res.ok) {
      setEntry({ status: 'done', text: res.text, error: null }, true)
    } else {
      setEntry({ status: 'error', text: '', error: res.error ?? 'Transcription failed.' }, false)
    }
  }
}))
