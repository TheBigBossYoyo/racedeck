import type { RaceSnapshot } from '@renderer/core/model/snapshot'
import type {
  DataAvailabilityMap,
  Driver,
  LapSample,
  RaceControlMessage,
  Stint,
  TimingEntry,
  TrackStatus,
  WeatherSample
} from '@shared/models'

/**
 * Plugin-safe derived metrics (APP_IMPROVEMENT_ROADMAP.md P3 item 36): a
 * readonly, replay-bounded projection of `RaceSnapshot` that a sandboxed
 * plugin can read. `RaceSnapshot` never carries TOD credentials or DRM
 * state (those live only in `AppInfo`/main-process `f1-auth.ts`) — confirmed
 * directly, not assumed — so `projectPluginSnapshot` only has to SELECT the
 * feeds a plugin declared, not redact anything.
 *
 * "Replay-bounded" means this is a one-shot snapshot at the moment the
 * plugin is run, built from the same `RaceSnapshot` the dashboard is already
 * showing — never a live subscription a plugin could hold onto.
 */

export const PLUGIN_FEEDS = [
  'timing',
  'laps',
  'stints',
  'weather',
  'raceControl',
  'drivers'
] as const
export type PluginFeed = (typeof PLUGIN_FEEDS)[number]

export interface PluginManifest {
  id: string
  name: string
  requiredFeeds: PluginFeed[]
}

export interface PluginSnapshot {
  clock: number
  currentLap: number | null
  trackStatus: TrackStatus
  timing?: TimingEntry[]
  laps?: LapSample[]
  stints?: Stint[]
  weather?: WeatherSample | null
  raceControl?: RaceControlMessage[]
  drivers?: Driver[]
}

/** Project a snapshot down to only the feeds a plugin declared it needs. */
export function projectPluginSnapshot(
  snapshot: RaceSnapshot,
  allowedFeeds: readonly PluginFeed[]
): PluginSnapshot {
  const feeds = new Set(allowedFeeds)
  const out: PluginSnapshot = {
    clock: snapshot.clock,
    currentLap: snapshot.currentLap,
    trackStatus: snapshot.trackStatus
  }
  if (feeds.has('timing')) out.timing = snapshot.timing
  if (feeds.has('laps')) out.laps = snapshot.laps
  if (feeds.has('stints')) out.stints = snapshot.stints
  if (feeds.has('weather')) out.weather = snapshot.weather
  if (feeds.has('raceControl')) out.raceControl = snapshot.raceControl
  if (feeds.has('drivers')) out.drivers = snapshot.drivers
  return out
}

const FEED_AVAILABILITY_KEY: Partial<Record<PluginFeed, keyof DataAvailabilityMap>> = {
  timing: 'timing',
  laps: 'laps',
  stints: 'stints',
  weather: 'weather',
  raceControl: 'raceControl'
}

/** Feeds a manifest declares that the loaded session can't actually back. */
export function validatePluginManifest(
  manifest: PluginManifest,
  availability: DataAvailabilityMap
): PluginFeed[] {
  return manifest.requiredFeeds.filter((feed) => {
    const key = FEED_AVAILABILITY_KEY[feed]
    return key != null && !availability[key]
  })
}
