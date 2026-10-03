import { create } from 'zustand'
import { STORE_NS } from '@shared/ipc-contract'
import { hasBridge, bridge } from '@renderer/lib/ipc'
import { useSettingsStore } from './settingsStore'
import { persist } from './persist'
import { describeError, isRecord, writeLogged } from './persistWrite'

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

/** Every persisted write carries the whole map, so it must not grow without bound. */
export const MAX_PERSISTED_TRANSCRIPTS = 200

/**
 * Only a finished transcript is worth keeping: a persisted 'loading' entry would
 * stick forever (nothing resumes it) and an 'error' one would block a retry.
 */
function isDoneEntry(value: unknown): value is TranscriptEntry {
  return isRecord(value) && value.status === 'done' && typeof value.text === 'string'
}

/** The newest `limit` finished transcripts, in insertion order (oldest evicted first). */
function capDoneEntries(
  entries: Record<string, TranscriptEntry>,
  limit: number
): Record<string, TranscriptEntry> {
  const done = Object.entries(entries).filter(([, entry]) => entry.status === 'done')
  return Object.fromEntries(done.slice(-limit))
}

function sanitizeEntries(raw: unknown): Record<string, TranscriptEntry> {
  if (!isRecord(raw)) return {}
  const clean: Record<string, TranscriptEntry> = {}
  for (const [url, entry] of Object.entries(raw)) {
    if (isDoneEntry(entry)) clean[url] = { status: 'done', text: entry.text, error: null }
  }
  return capDoneEntries(clean, MAX_PERSISTED_TRANSCRIPTS)
}

export const useRadioTranscriptStore = create<RadioTranscriptState>((set, get) => ({
  hydrated: false,
  entries: {},

  hydrate: async () => {
    const raw = await persist.get<unknown>(STORE_NS.RADIO_TRANSCRIPTS, K.entries)
    set({ entries: sanitizeEntries(raw), hydrated: true })
  },

  entryFor: (url) => get().entries[url] ?? IDLE,

  transcribe: async (url) => {
    const current = get().entries[url]
    if (current?.status === 'loading' || current?.status === 'done') return

    const setEntry = (entry: TranscriptEntry, persistIt: boolean) => {
      // Re-insert so a fresh result counts as the newest when the cap evicts.
      const entries = { ...get().entries }
      delete entries[url]
      entries[url] = entry
      set({ entries })
      if (persistIt) {
        writeLogged(
          STORE_NS.RADIO_TRANSCRIPTS,
          K.entries,
          capDoneEntries(entries, MAX_PERSISTED_TRANSCRIPTS)
        )
      }
    }

    if (!hasBridge()) {
      return setEntry(
        { status: 'error', text: '', error: 'Transcription needs the desktop app.' },
        false
      )
    }
    const ai = useSettingsStore.getState().ai
    setEntry({ status: 'loading', text: '', error: null }, false)
    try {
      const res = await bridge().ai.transcribe({ config: ai, audioUrl: url })
      if (res.ok) {
        setEntry({ status: 'done', text: res.text, error: null }, true)
      } else {
        setEntry({ status: 'error', text: '', error: res.error ?? 'Transcription failed.' }, false)
      }
    } catch (error) {
      setEntry({ status: 'error', text: '', error: `Transcription failed: ${describeError(error)}` }, false)
    }
  }
}))
