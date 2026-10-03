import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { EngineerNote } from '@renderer/core/engines/EngineerNotesEngine'
import type { StoryEvent } from '@renderer/core/engines/RaceStoryEngine'

const engines = vi.hoisted(() => ({
  notes: [] as EngineerNote[],
  events: [] as StoryEvent[]
}))

vi.mock('@renderer/core/engines/EngineerNotesEngine', () => ({
  deriveEngineerNotes: () => engines.notes
}))
vi.mock('@renderer/core/engines/RaceStoryEngine', () => ({
  diffSnapshots: () => engines.events
}))

import { useEngineerNotesStore } from '@renderer/store/engineerNotesStore'
import { useRaceStoryStore } from '@renderer/store/raceStoryStore'

const snap = (clock: number) => ({ clock, session: { id: 's1' } }) as unknown as RaceSnapshot
const note = (id: string, priority: 'high' | 'low'): EngineerNote =>
  ({ id, priority }) as unknown as EngineerNote
const story = (id: string): StoryEvent => ({ id }) as unknown as StoryEvent

describe('engineerNotesStore ordering', () => {
  beforeEach(() => useEngineerNotesStore.getState().reset())

  it('prepends fresh notes newest first without mutating the engine output', () => {
    const fresh = Object.freeze([note('a', 'high'), note('b', 'low'), note('c', 'high')])
    engines.notes = fresh as unknown as EngineerNote[]
    useEngineerNotesStore.getState().ingest(snap(1))
    useEngineerNotesStore.getState().ingest(snap(2))
    const state = useEngineerNotesStore.getState()
    expect(state.notes.map((n) => n.id)).toEqual(['c', 'b', 'a'])
    expect(state.lastHighId).toBe('c')
    expect(fresh.map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('raceStoryStore ordering', () => {
  beforeEach(() => useRaceStoryStore.getState().reset())

  it('prepends fresh events newest first without mutating the engine output', () => {
    const fresh = Object.freeze([story('a'), story('b'), story('c')])
    engines.events = fresh as unknown as StoryEvent[]
    useRaceStoryStore.getState().ingest(snap(1))
    useRaceStoryStore.getState().ingest(snap(2))
    expect(useRaceStoryStore.getState().events.map((e) => e.id)).toEqual(['c', 'b', 'a'])
    expect(fresh.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })
})
