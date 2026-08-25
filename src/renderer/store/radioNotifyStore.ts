import { create } from 'zustand'
import type { RaceSnapshot } from '@renderer/core/providers/types'

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
  }
}))
