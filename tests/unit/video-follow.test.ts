import { describe, expect, it } from 'vitest'
import {
  anchorFrom,
  followMath,
  followStep,
  driftSeconds,
  type FollowAnchor
} from '@renderer/core/engines/VideoFollowEngine'
import { SYNC_MAX_OFFSET } from '@shared/constants'
import type { VideoPlaybackProbe } from '@shared/models'

/**
 * Follow exists so the broadcast delay is measured once and then maintained.
 * The behaviours worth pinning down are the ones a user would otherwise have to
 * fix by hand: pausing, rewinding, catching back up — and the cases where the
 * honest answer is "ask me again" rather than a confident wrong number.
 */

const T0 = 1_700_000_000_000

const probe = (over: Partial<VideoPlaybackProbe> = {}): VideoPlaybackProbe => ({
  ok: true,
  currentTime: 1000,
  paused: false,
  seekableEnd: 1010,
  mediaKey: 'live x1920x1080',
  atMs: T0,
  reason: null,
  ...over
})

const anchor: FollowAnchor = {
  videoTime: 1000,
  atMs: T0,
  offset: 45,
  mediaKey: 'live x1920x1080'
}

describe('followMath.offsetFor', () => {
  it('holds the offset steady while the video plays in real time', () => {
    // 30 s of wall clock, 30 s of video — nothing changed.
    expect(followMath.offsetFor(anchor, 1030, T0 + 30_000)).toBeCloseTo(45)
  })

  it('grows the offset by exactly the length of a pause', () => {
    // The user paused for 20 s: real time ran on, the playhead did not.
    expect(followMath.offsetFor(anchor, 1000, T0 + 20_000)).toBeCloseTo(65)
  })

  it('grows the offset by the distance rewound, plus the time it took', () => {
    // 10 s of wall clock later, the playhead has been dragged back 60 s.
    expect(followMath.offsetFor(anchor, 940, T0 + 10_000)).toBeCloseTo(115)
  })

  it('shrinks the offset when the viewer skips towards the live edge', () => {
    // 5 s passed but the playhead jumped forward 35 s.
    expect(followMath.offsetFor(anchor, 1035, T0 + 5_000)).toBeCloseTo(15)
  })

  it('is exact over a long pause followed by a resume', () => {
    const paused = followMath.offsetFor(anchor, 1000, T0 + 300_000)
    expect(paused).toBeCloseTo(345)
    // Resuming does not undo the accumulated delay; it just stops growing.
    expect(followMath.offsetFor(anchor, 1060, T0 + 360_000)).toBeCloseTo(345)
  })
})

describe('driftSeconds', () => {
  it('is zero while the video plays in real time (offset holds)', () => {
    expect(driftSeconds(anchor, probe({ currentTime: 1030, atMs: T0 + 30_000 }))).toBeCloseTo(0)
  })

  it('reports positive drift after a pause (offset has grown)', () => {
    expect(driftSeconds(anchor, probe({ currentTime: 1000, atMs: T0 + 20_000 }))).toBeCloseTo(20)
  })

  it('returns null for a bad probe', () => {
    expect(driftSeconds(anchor, probe({ ok: false }))).toBeNull()
  })

  it('returns null when the probe is against a different media than the anchor', () => {
    expect(driftSeconds(anchor, probe({ mediaKey: 'a different asset' }))).toBeNull()
  })
})

describe('followStep', () => {
  it('returns the tracked offset while everything is normal', () => {
    const result = followStep(true, anchor, probe({ currentTime: 1000, atMs: T0 + 20_000 }))
    expect(result.status).toBe('following')
    expect(result.offset).toBeCloseTo(65)
    expect(result.anchor).toBe(anchor)
  })

  it('does nothing at all when follow is switched off', () => {
    const result = followStep(false, anchor, probe())
    expect(result.status).toBe('off')
    expect(result.offset).toBeNull()
  })

  it('waits — and keeps the anchor — when the player cannot be read', () => {
    // An ad break or a reload makes the video briefly unreadable. Throwing the
    // anchor away there would force a pointless re-calibration.
    const result = followStep(
      true,
      anchor,
      probe({ ok: false, reason: 'No video is playing yet.' })
    )
    expect(result.status).toBe('waiting')
    expect(result.offset).toBeNull()
    expect(result.anchor).toBe(anchor)
    expect(result.detail).toBe('No video is playing yet.')
  })

  it('asks for calibration before an anchor exists', () => {
    const result = followStep(true, null, probe())
    expect(result.status).toBe('uncalibrated')
    expect(result.offset).toBeNull()
  })

  it('drops the anchor when a different video is loaded', () => {
    const result = followStep(true, anchor, probe({ mediaKey: '3600x1280x720' }))
    expect(result.status).toBe('needs-calibration')
    expect(result.anchor).toBeNull()
    expect(result.offset).toBeNull()
  })

  it('tolerates a player that reports no media identity', () => {
    // Some players expose nothing usable; that is not evidence of a change.
    const result = followStep(
      true,
      anchor,
      probe({ mediaKey: null, atMs: T0 + 10_000, currentTime: 1010 })
    )
    expect(result.status).toBe('following')
  })

  it('refuses to invent an offset outside the representable range', () => {
    // A playhead reset to zero implies a delay of hours. Reporting that as a
    // clamped offset would look authoritative and be wrong.
    const result = followStep(true, anchor, probe({ currentTime: 0, atMs: T0 + 1_000 }))
    expect(result.status).toBe('needs-calibration')
    expect(result.offset).toBeNull()
    expect(result.anchor).toBeNull()
  })

  it('accepts a large but still representable delay', () => {
    const seconds = SYNC_MAX_OFFSET - anchor.offset - 5
    const result = followStep(true, anchor, probe({ currentTime: 1000, atMs: T0 + seconds * 1000 }))
    expect(result.status).toBe('following')
    expect(result.offset).toBeCloseTo(anchor.offset + seconds)
  })
})

describe('anchorFrom', () => {
  it('captures the player clock and the offset declared correct', () => {
    expect(anchorFrom(probe({ currentTime: 812.5 }), 38)).toEqual({
      videoTime: 812.5,
      atMs: T0,
      offset: 38,
      mediaKey: 'live x1920x1080'
    })
  })

  it('refuses to anchor to a reading that never happened', () => {
    expect(anchorFrom(probe({ ok: false }), 38)).toBeNull()
  })

  it('round-trips: an anchor taken now reproduces its own offset now', () => {
    const p = probe()
    const a = anchorFrom(p, 51)!
    expect(followMath.offsetFor(a, p.currentTime, p.atMs)).toBeCloseTo(51)
  })
})
