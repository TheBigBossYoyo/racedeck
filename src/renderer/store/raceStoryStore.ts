import { create } from 'zustand'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { diffSnapshots, type StoryEvent } from '@renderer/core/engines/RaceStoryEngine'

/**
 * raceStoryStore — accumulates the narrative feed as the session clock advances.
 * `ingest(snapshot)` is called from the session recompute loop; it diffs each new
 * frame against the previous one and prepends any events (newest first). Scrubbing
 * backwards or switching sessions resets the story so it always reflects the
 * timeline you're actually watching. Works identically live and in replay.
 */

const MAX_EVENTS = 250
const BACKSTEP_EPS = 0.5 // seconds of backward jump that triggers a reset

interface RaceStoryState {
  events: StoryEvent[]
  ingest: (snapshot: RaceSnapshot) => void
  reset: () => void
}

// Kept outside the store so updating them never notifies subscribers.
let prevSnapshot: RaceSnapshot | null = null
let lastClock = -1
let sessionId: string | null = null

export const useRaceStoryStore = create<RaceStoryState>((set, get) => ({
  events: [],

  ingest: (snapshot) => {
    const sid = snapshot.session.id
    // New session, or scrubbed backwards → restart the narrative.
    if (sid !== sessionId || snapshot.clock < lastClock - BACKSTEP_EPS) {
      sessionId = sid
      prevSnapshot = snapshot
      lastClock = snapshot.clock
      if (get().events.length) set({ events: [] })
      return
    }
    // Only advance the story when the clock actually moves forward.
    if (prevSnapshot && snapshot.clock > lastClock + 0.01) {
      const fresh = diffSnapshots(prevSnapshot, snapshot)
      if (fresh.length) {
        const existing = new Set(get().events.map((e) => e.id))
        const add = fresh.filter((e) => !existing.has(e.id))
        if (add.length) {
          // Newest first; cap the log.
          set({ events: [...add.reverse(), ...get().events].slice(0, MAX_EVENTS) })
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
    set({ events: [] })
  }
}))
