import { create } from 'zustand'
import { STORE_NS } from '@shared/ipc-contract'
import { persist } from './persist'
import {
  createAnnotation,
  sanitizeAnnotations,
  type UserAnnotation,
  type CreateAnnotationInput
} from '@renderer/core/engines/UserAnnotations'

/**
 * User-authored session notes (APP_IMPROVEMENT_ROADMAP.md P3 item 34).
 * Scoped to the current session — `hydrateForSession` swaps the whole list
 * on session load, following `layoutStore`'s per-key persistence
 * (`STORE_NS.ANNOTATIONS`/`<sessionId>`) and `engineerNotesStore`'s
 * session-switch reset shape.
 */

interface AnnotationsState {
  sessionId: string | null
  annotations: UserAnnotation[]

  hydrateForSession: (sessionId: string) => Promise<void>
  reset: () => void
  add: (input: Omit<CreateAnnotationInput, 'sessionId'>) => void
  update: (id: string, patch: Partial<Pick<UserAnnotation, 'tag' | 'text'>>) => void
  remove: (id: string) => void
}

let readVersion = 0

function persistCurrent(sessionId: string, annotations: UserAnnotation[]): void {
  void persist.set(STORE_NS.ANNOTATIONS, sessionId, annotations)
}

export const useAnnotationsStore = create<AnnotationsState>((set, get) => ({
  sessionId: null,
  annotations: [],

  hydrateForSession: async (sessionId) => {
    const version = ++readVersion
    set({ sessionId, annotations: [] })
    const raw = await persist.get<unknown>(STORE_NS.ANNOTATIONS, sessionId)
    if (version !== readVersion || get().sessionId !== sessionId) return
    set({ annotations: sanitizeAnnotations(raw) })
  },

  reset: () => {
    readVersion++
    set({ sessionId: null, annotations: [] })
  },

  add: (input) => {
    const sessionId = get().sessionId
    if (!sessionId) return
    const annotation = createAnnotation({ ...input, sessionId })
    const annotations = [...get().annotations, annotation].sort((a, b) => a.t - b.t)
    set({ annotations })
    persistCurrent(sessionId, annotations)
  },

  update: (id, patch) => {
    const sessionId = get().sessionId
    if (!sessionId) return
    const annotations = get().annotations.map((a) => (a.id === id ? { ...a, ...patch } : a))
    set({ annotations })
    persistCurrent(sessionId, annotations)
  },

  remove: (id) => {
    const sessionId = get().sessionId
    if (!sessionId) return
    const annotations = get().annotations.filter((a) => a.id !== id)
    set({ annotations })
    persistCurrent(sessionId, annotations)
  }
}))
