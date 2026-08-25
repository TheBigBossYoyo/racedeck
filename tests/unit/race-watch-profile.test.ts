import { describe, expect, it } from 'vitest'
import {
  CRITICAL_ALERT_KEYS,
  sanitizeAlertOverrides,
  createRaceWatchProfile
} from '@renderer/core/engines/RaceWatchProfile'
import { DEFAULT_ALERT_CONFIG } from '@renderer/core/engines/AlertEngine'

describe('sanitizeAlertOverrides', () => {
  it('strips every critical alert key, even when explicitly disabled', () => {
    const patch = {
      ...DEFAULT_ALERT_CONFIG,
      redFlag: false,
      safetyCar: false,
      penalty: false,
      qualiElimination: false,
      weather: false
    }
    const out = sanitizeAlertOverrides(patch)
    for (const key of CRITICAL_ALERT_KEYS) {
      expect(out).not.toHaveProperty(key)
    }
    // A non-critical key is preserved.
    expect(out.weather).toBe(false)
  })

  it('strips the favorites list — profiles drive favorites separately', () => {
    const out = sanitizeAlertOverrides({ ...DEFAULT_ALERT_CONFIG, favorites: [1, 2, 3] })
    expect(out).not.toHaveProperty('favorites')
  })

  it('passes non-critical keys through unchanged', () => {
    const out = sanitizeAlertOverrides({ intervalThresholdSec: 5, pitStop: false })
    expect(out).toEqual({ intervalThresholdSec: 5, pitStop: false })
  })
})

describe('createRaceWatchProfile', () => {
  it('sanitizes alertOverrides through the same enforcement point', () => {
    const profile = createRaceWatchProfile('race', [1], 'broadcast-data', null, {
      ...DEFAULT_ALERT_CONFIG,
      redFlag: false
    })
    expect(profile.alertOverrides).not.toHaveProperty('redFlag')
    expect(profile.sessionType).toBe('race')
    expect(profile.favoriteDrivers).toEqual([1])
  })

  it('copies favoriteDrivers rather than aliasing the input array', () => {
    const input = [1, 2]
    const profile = createRaceWatchProfile('practice', input, null, null, {})
    input.push(3)
    expect(profile.favoriteDrivers).toEqual([1, 2])
  })
})
