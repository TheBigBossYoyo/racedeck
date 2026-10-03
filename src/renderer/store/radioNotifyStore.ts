import { create } from 'zustand'
import type { RaceSnapshot } from '@renderer/core/model/snapshot'

/**
 * radioNotifyStore — a discrete "new team radio" popup queue (round-3
 * live-session feedback: "when a new radio message arrives I would like sort
 * of a discrete popup asking if i want to listen it").
 *
 * `ingest(snapshot)` is called from the session recompute loop, same shape as
 * `raceStoryStore`/`engineerNotesStore`: diffs each frame's `teamRadio` clip
 * list against what was already seen, by URL. Only LIVE sessions notify —
 * scrubbing replay around would otherwise "discover" the whole clip backlog
 * as if it just arrived. A session switch (or the first frame of a new one)
 * captures a silent baseline instead of flooding the queue with history.
 */

export interface RadioNotice {
  url: string
  utc: string
  driverNumber: number
  code: string
  teamColour: string | null
}

interface RadioNotifyState {
  current: RadioNotice | null
  queue: RadioNotice[]
  ingest: (snapshot: RaceSnapshot) => void
  dismiss: () => void
  /** Drop notices AND the seen-clip memory; the next frame becomes a silent baseline. */
  reset: () => void
}

const MAX_QUEUE = 5

let seenUrls = new Set<string>()
let sessionId: string | null = null

export const useRadioNotifyStore = create<RadioNotifyState>((set, get) => ({
  current: null,
  queue: [],

  ingest: (snapshot) => {
    const sid = snapshot.session.id
    const clips = snapshot.teamRadio ?? []

    if (sid !== sessionId) {
      sessionId = sid
      seenUrls = new Set(clips.map((c) => c.url))
      set({ current: null, queue: [] })
      return
    }
    if (!snapshot.availability.live) {
      seenUrls = new Set(clips.map((c) => c.url))
      return
    }

    const fresh = clips.filter((c) => !seenUrls.has(c.url))
    seenUrls = new Set(clips.map((c) => c.url))
    if (fresh.length === 0) return

    const meta = new Map(snapshot.drivers.map((d) => [d.number, d]))
    const notices: RadioNotice[] = fresh.map((c) => ({
      url: c.url,
      utc: c.utc,
      driverNumber: c.driverNumber,
      code: meta.get(c.driverNumber)?.code ?? `#${c.driverNumber}`,
      teamColour: meta.get(c.driverNumber)?.teamColour ?? null
    }))

    const { current, queue } = get()
    const combined = [...queue, ...notices].slice(-MAX_QUEUE)
    if (!current) {
      const [next, ...rest] = combined
      set({ current: next ?? null, queue: rest })
    } else {
      set({ queue: combined })
    }
  },

  dismiss: () => {
    const [next, ...rest] = get().queue
    set({ current: next ?? null, queue: rest })
  },

  reset: () => {
    // Clearing only `seenUrls` would make the next live frame of the SAME session
    // read its whole clip backlog as new; forgetting the session id sends that
    // frame through the baseline branch of `ingest` instead.
    seenUrls = new Set()
    sessionId = null
    set({ current: null, queue: [] })
  }
}))
