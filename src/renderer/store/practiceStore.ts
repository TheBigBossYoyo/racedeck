import { create } from 'zustand'
import type { PracticeBriefRequest, PracticeBriefResult } from '@shared/practice'
import { bridge, hasBridge } from '@renderer/lib/ipc'

interface PracticeStoreState {
  loading: boolean
  error: string | null
  result: PracticeBriefResult | null
  requestKey: string | null
  load: (request: PracticeBriefRequest) => Promise<void>
  clear: () => void
}

let requestVersion = 0

function keyOf(request: PracticeBriefRequest): string {
  return [
    request.year ?? '',
    request.meetingName ?? request.countryName ?? '',
    request.dateStart ?? '',
    request.drivers.map((driver) => `${driver.number}:${driver.teamName ?? ''}`).join('|')
  ].join(':')
}

export const usePracticeStore = create<PracticeStoreState>((set, get) => ({
  loading: false,
  error: null,
  result: null,
  requestKey: null,

  load: async (request) => {
    const requestKey = keyOf(request)
    if (get().requestKey === requestKey && (get().loading || get().result)) return
    if (!hasBridge()) {
      set({ loading: false, error: 'Practice intelligence requires the desktop app.' })
      return
    }
    const version = ++requestVersion
    set({ loading: true, error: null, requestKey })
    try {
      const result = await bridge().practice.briefing(request)
      if (version !== requestVersion || get().requestKey !== requestKey) return
      set({ loading: false, result, error: result.ok ? result.error : result.error ?? 'Practice intelligence unavailable.' })
    } catch (error) {
      if (version !== requestVersion || get().requestKey !== requestKey) return
      set({
        loading: false,
        result: null,
        error: error instanceof Error ? error.message : 'Practice intelligence unavailable.'
      })
    }
  },

  clear: () => {
    requestVersion++
    set({ loading: false, error: null, result: null, requestKey: null })
  }
}))
