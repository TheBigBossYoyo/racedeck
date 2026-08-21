import { create } from 'zustand'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { deriveEngineerNotes, type EngineerNote } from '@renderer/core/engines/EngineerNotesEngine'

/**
 * engineerNotesStore — accumulates the proactive strategic-notes feed as the
 * session clock advances, exactly like raceStoryStore: `ingest(snapshot)` is
 * called from the session recompute loop, diffs each new frame against the last,
 * dedupes by stable note id and prepends fresh notes (newest first). Scrubbing
 * back or switching sessions resets it. `lastHighId` lets the voice read-out
 * speak only genuinely new high-priority notes.
 */

const MAX_NOTES = 120
const BACKSTEP_EPS = 0.5

interface EngineerNotesState {
  notes: EngineerNote[]
  /** Id of the most recent high-priority note (for the voice read-out). */
  lastHighId: string | null
  ingest: (snapshot: RaceSnapshot) => void
  reset: () => void
}

let prevSnapshot: RaceSnapshot | null = null
let lastClock = -1
let sessionId: string | null = null

export const useEngineerNotesStore = create<EngineerNotesState>((set, get) => ({
  notes: [],
  lastHighId: null,

  ingest: (snapshot) => {
    const sid = snapshot.session.id
    if (sid !== sessionId || snapshot.clock < lastClock - BACKSTEP_EPS) {
      sessionId = sid
      prevSnapshot = snapshot
      lastClock = snapshot.clock
      if (get().notes.length) set({ notes: [], lastHighId: null })
      return
    }
    if (prevSnapshot && snapshot.clock > lastClock + 0.01) {
      const fresh = deriveEngineerNotes(prevSnapshot, snapshot)
      if (fresh.length) {
        const existing = new Set(get().notes.map((n) => n.id))
        const add = fresh.filter((n) => !existing.has(n.id))
        if (add.length) {
          const newestHigh = [...add].reverse().find((n) => n.priority === 'high')
          set({
            notes: [...add.reverse(), ...get().notes].slice(0, MAX_NOTES),
            lastHighId: newestHigh ? newestHigh.id : get().lastHighId
          })
        }
      }
    }
    prevSnapshot = snapshot
    lastClock = snapshot.clock
  },

  reset: () => {
    prevSnapshot = null
    lastClock = -1
    sessionId = null
    set({ notes: [], lastHighId: null })
  }
}))
