import { describe, it, expect } from 'vitest'
import {
  stripBom,
  parseTimecode,
  splitStreamLine,
  parseJsonStream,
  deepMergeF1,
  indexedToArray,
  ch45ToAeroMode,
  parseClockRemaining,
  parseSessionClock,
  sessionClockRemainingAt,
  liveDataTier
} from '@shared/f1live'
import type { LiveStatus } from '@shared/f1live'
import { F1LiveSocket } from '../../src/main/f1-live-socket'

describe('stripBom', () => {
  it('removes a leading BOM only', () => {
    expect(stripBom('﻿{"a":1}')).toBe('{"a":1}')
    expect(stripBom('{"a":1}')).toBe('{"a":1}')
  })
})

describe('parseTimecode', () => {
  it('parses HH:MM:SS.mmm into seconds', () => {
    expect(parseTimecode('00:00:02.353')).toBeCloseTo(2.353, 6)
    expect(parseTimecode('01:02:03.500')).toBeCloseTo(3723.5, 6)
    expect(parseTimecode('nope')).toBeNull()
  })
})

describe('splitStreamLine', () => {
  it('splits the 12-char timecode prefix from the JSON remainder', () => {
    const r = splitStreamLine('00:00:09.706{"Lines":{"4":{"Position":"1"}}}')
    expect(r?.t).toBeCloseTo(9.706, 6)
    expect(r?.rest).toBe('{"Lines":{"4":{"Position":"1"}}}')
    expect(splitStreamLine('garbage')).toBeNull()
  })
})

describe('parseJsonStream', () => {
  it('parses a multi-line stream (BOM + CRLF + blank lines), skipping bad lines', () => {
    const text = '﻿00:00:01.000{"a":1}\r\n\n00:00:02.000{"b":2}\n00:00:03.000{bad}\n'
    const pts = parseJsonStream(text)
    expect(pts).toEqual([
      { t: 1, d: { a: 1 } },
      { t: 2, d: { b: 2 } }
    ])
  })
})

describe('deepMergeF1', () => {
  it('patches an ARRAY base addressed by index instead of replacing it', () => {
    // F1 sends `{"Sectors":{"2":{...}}}` every time a driver completes a sector.
    // Rebuilding that as a plain object kept ONLY the patched index and silently
    // dropped the other sectors — and the same for segments, stints and lap
    // positions — until the next keyframe happened to restore them.
    const base = { Sectors: [{ Value: '24.9' }, { Value: '26.1' }, { Value: '22.7' }] }
    deepMergeF1(base, { Sectors: { '2': { Value: '22.1' } } })
    expect(base.Sectors).toEqual([{ Value: '24.9' }, { Value: '26.1' }, { Value: '22.1' }])
  })

  it('merges nested indexed patches without flattening the array', () => {
    const base = { Sectors: [{ Segments: [{ Status: 0 }, { Status: 0 }] }] }
    deepMergeF1(base, { Sectors: { '0': { Segments: { '1': { Status: 2048 } } } } })
    expect(base.Sectors).toEqual([{ Segments: [{ Status: 0 }, { Status: 2048 }] }])
  })

  it('still replaces an array when the patch carries named keys', () => {
    // A patch with real field names is a genuine object, not index addressing.
    const base: Record<string, unknown> = { Value: ['a'] }
    deepMergeF1(base, { Value: { Status: 'x' } })
    expect(base.Value).toEqual({ Status: 'x' })
  })

  it('grows the array when a patch addresses a new index', () => {
    const base = { LapPosition: ['5'] }
    deepMergeF1(base, { LapPosition: { '1': '4' } })
    expect(base.LapPosition).toEqual(['5', '4'])
  })

  it('merges nested objects and overwrites scalars', () => {
    const base = { Lines: { '4': { Position: '2', GapToLeader: '+1.0' } } }
    deepMergeF1(base, { Lines: { '4': { Position: '1' }, '5': { Position: '3' } } })
    expect(base).toEqual({
      Lines: { '4': { Position: '1', GapToLeader: '+1.0' }, '5': { Position: '3' } }
    })
  })

  it('rejects prototype-mutating keys from remote feed patches', () => {
    const protoPatch = JSON.parse('{"__proto__":{"polluted":true}}') as unknown
    const constructorPatch = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}') as unknown
    const target = { safe: { value: 1 } }

    deepMergeF1(target, protoPatch)
    deepMergeF1(target, constructorPatch)

    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(target, '__proto__')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(target, 'constructor')).toBe(false)
    expect(target.safe.value).toBe(1)
  })

  it('ignores dangerous keys in feed deletion lists', () => {
    const target = { keep: true }
    deepMergeF1(target, { _deleted: ['__proto__', 'constructor', 'prototype'] })
    expect(target).toEqual({ keep: true })
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('honours the _deleted removal list', () => {
    const base = { Messages: { '0': { m: 'a' }, '1': { m: 'b' } } }
    deepMergeF1(base, { Messages: { _deleted: ['0'] } })
    expect(base).toEqual({ Messages: { '1': { m: 'b' } } })
  })

  it('treats an indexed patch on an empty array as index addressing', () => {
    // Previously this replaced the array with a plain object. F1's real deltas
    // address CONTINUING indices into the keyframe's array — RaceControlMessages
    // sends {"Messages":{"1":…}} then {"Messages":{"2":…}} — so index addressing
    // must extend the array rather than collapse it to a single-key object.
    const base: unknown = { Messages: [] }
    deepMergeF1(base, { Messages: { '0': { m: 'a' } } })
    expect(base).toEqual({ Messages: [{ m: 'a' }] })
  })

  it('merges sparse live-feed arrays by index without dropping other drivers or stints', () => {
    const base = {
      Lines: [
        { Stints: [{ Compound: 'MEDIUM', TotalLaps: 8 }] },
        { Stints: [{ Compound: 'SOFT', TotalLaps: 7 }] }
      ]
    }
    const sparseLines: unknown[] = []
    sparseLines[1] = { Stints: [{ TotalLaps: 8 }] }

    deepMergeF1(base, { Lines: sparseLines })

    expect(base.Lines[0]).toEqual({ Stints: [{ Compound: 'MEDIUM', TotalLaps: 8 }] })
    expect(base.Lines[1]).toEqual({ Stints: [{ Compound: 'SOFT', TotalLaps: 8 }] })
  })

})

describe('F1LiveSocket incremental snapshots', () => {
  it('returns only unseen points and resets cursors for a new connection generation', () => {
    const socket = new F1LiveSocket()
    const internal = socket as unknown as {
      status: LiveStatus
      generation: number
      streams: Record<string, unknown[]>
      ingest: (topic: string, data: unknown) => void
    }
    internal.status = {
      state: 'connected', detail: null, sessionName: 'Test', messages: 0,
      subscription: false, live: true, updatedAt: new Date().toISOString()
    }
    internal.generation = 1
    internal.ingest('TimingData', { tick: 1 })
    internal.ingest('TimingData', { tick: 2 })

    const first = socket.getData()
    expect(first?.streams.TimingData).toHaveLength(2)
    internal.ingest('TimingData', { tick: 3 })
    const delta = socket.getData(first?.cursors, first?.generation)
    expect(delta?.streams.TimingData).toHaveLength(1)

    internal.generation = 2
    internal.streams = {}
    internal.ingest('TimingData', { tick: 'new connection' })
    const reconnected = socket.getData(delta?.cursors, delta?.generation)
    expect(reconnected?.streams.TimingData).toHaveLength(1)
  })

  it('flips gatedData only when a gated feed (CarData/Position) actually arrives', () => {
    const socket = new F1LiveSocket()
    const internal = socket as unknown as {
      gatedData: boolean
      ingest: (topic: string, data: unknown) => void
    }
    expect(internal.gatedData).toBe(false)
    // Public timing alone must NOT count as full data.
    internal.ingest('TimingData', { Lines: {} })
    expect(internal.gatedData).toBe(false)
    // A decoded Position frame is the honest proof the subscription unlocked.
    internal.ingest('Position', { Position: [] })
    expect(internal.gatedData).toBe(true)
  })
})

describe('liveDataTier', () => {
  it('is offline when not live', () => {
    expect(liveDataTier(false, true, true)).toBe('offline')
  })
  it('is full only when gated feeds actually arrive', () => {
    expect(liveDataTier(true, true, true)).toBe('full')
  })
  it('is waiting when a token was sent but gated feeds are NOT arriving', () => {
    // Nearly always an expired token — F1 rotates them about weekly — and
    // signing in again genuinely fixes it.
    expect(liveDataTier(true, true, false)).toBe('waiting')
  })
  it('is public on an anonymous live connection', () => {
    expect(liveDataTier(true, false, false)).toBe('public')
  })
})

describe('parseClockRemaining', () => {
  it('parses HH:MM:SS (the ExtrapolatedClock format) into seconds', () => {
    expect(parseClockRemaining('00:18:00')).toBe(1080)
    expect(parseClockRemaining('00:13:05')).toBe(785)
    expect(parseClockRemaining('01:32:59')).toBe(5579)
  })

  it('tolerates MM:SS and fractional seconds, rejects junk', () => {
    expect(parseClockRemaining('12:00')).toBe(720)
    expect(parseClockRemaining('00:00:30.500')).toBeCloseTo(30.5, 6)
    expect(parseClockRemaining('')).toBeNull()
    expect(parseClockRemaining('nope')).toBeNull()
    expect(parseClockRemaining(null)).toBeNull()
    expect(parseClockRemaining(1234)).toBeNull()
  })
})

describe('parseSessionClock + sessionClockRemainingAt', () => {
  // Q1 opens at 18:00, the clock starts running, then a red flag holds it.
  const points = [
    { t: 0, d: { Utc: '2024-07-20T14:00:00Z', Remaining: '00:18:00', Extrapolating: false } },
    { t: 5, d: { Extrapolating: true } },
    { t: 300, d: { Remaining: '00:13:05', Extrapolating: true } },
    { t: 400, d: { Extrapolating: false } }
  ]

  it('folds incremental deltas, carrying Remaining/Extrapolating forward', () => {
    expect(parseSessionClock(points)).toEqual([
      { t: 0, remaining: 1080, extrapolating: false },
      { t: 5, remaining: 1080, extrapolating: true },
      { t: 300, remaining: 785, extrapolating: true },
      { t: 400, remaining: 785, extrapolating: false }
    ])
  })

  it('extrapolates while running and freezes when held (red flag)', () => {
    const clock = parseSessionClock(points)
    // Held before it starts running → stays at the published value.
    expect(sessionClockRemainingAt(clock, 0)?.remaining).toBe(1080)
    // Running → count down 1:1 with elapsed feed time.
    expect(sessionClockRemainingAt(clock, 10)?.remaining).toBe(1075)
    expect(sessionClockRemainingAt(clock, 350)?.remaining).toBe(735)
    // Red flag → frozen, independent of how much feed time passes.
    expect(sessionClockRemainingAt(clock, 500)?.remaining).toBe(785)
    expect(sessionClockRemainingAt(clock, 900)?.remaining).toBe(785)
  })

  it('is independent of the live buffer edge (the stuck-at-0:06 bug)', () => {
    // Regression: a live snapshot sits at the buffer edge (clock ≈ duration).
    // The old segment-derived clock returned ~0; the ExtrapolatedClock returns
    // the true broadcast remaining regardless of where the buffer edge is.
    const clock = parseSessionClock(points)
    expect(sessionClockRemainingAt(clock, 305)?.remaining).toBe(780)
  })

  it('returns null before any clock point and for an empty stream', () => {
    expect(sessionClockRemainingAt(parseSessionClock(points), -1)).toBeNull()
    expect(sessionClockRemainingAt([], 42)).toBeNull()
    expect(parseSessionClock([])).toEqual([])
  })
})

describe('indexedToArray', () => {
  it('orders numeric-string keys and passes arrays through', () => {
    expect(indexedToArray({ '0': 'a', '2': 'c', '1': 'b' })).toEqual(['a', 'b', 'c'])
    expect(indexedToArray(['x', 'y'])).toEqual(['x', 'y'])
    expect(indexedToArray(null)).toEqual([])
  })

  it('densifies sparse arrays and ignores empty slots', () => {
    const sparse: string[] = []
    sparse[1] = 'medium'
    sparse[3] = 'hard'
    expect(indexedToArray(sparse)).toEqual(['medium', 'hard'])
  })
})

describe('ch45ToAeroMode', () => {
  it('maps active/open values (10, 12, 14) to Straight Mode', () => {
    expect(ch45ToAeroMode(10)).toBe('STRAIGHT')
    expect(ch45ToAeroMode(12)).toBe('STRAIGHT')
    expect(ch45ToAeroMode(14)).toBe('STRAIGHT')
  })

  it('maps off/eligible values (0, 1, 8) to Corner Mode', () => {
    expect(ch45ToAeroMode(0)).toBe('CORNER')
    expect(ch45ToAeroMode(1)).toBe('CORNER')
    expect(ch45ToAeroMode(8)).toBe('CORNER')
  })

  it('returns null for null, undefined, and unrecognised values', () => {
    expect(ch45ToAeroMode(null)).toBeNull()
    expect(ch45ToAeroMode(undefined)).toBeNull()
    expect(ch45ToAeroMode(2)).toBeNull()
    expect(ch45ToAeroMode(99)).toBeNull()
    expect(ch45ToAeroMode(-1)).toBeNull()
  })
})
