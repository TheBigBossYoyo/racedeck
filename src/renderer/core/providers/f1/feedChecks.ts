import { numOrNull } from './shared'

/**
 * Shape checks for the F1 feed payloads the normalizers read with casts
 * (`as string`, `as number`). They only OBSERVE: nothing here changes what a
 * normalizer produces. The vocabulary lives here so the validators and the
 * tracker share one fixed, bounded set of check ids.
 */

export type FeedTopic =
  | 'TimingData'
  | 'DriverList'
  | 'Position'
  | 'CurrentTyres'
  | 'TyreStintSeries'
  | 'RaceControlMessages'

/**
 * Every check the validators can report: `[feed, problem]`. The problem reads as a
 * noun phrase ("non-numeric lap time") so a count can follow it. The set is closed,
 * which is what bounds the tracker's memory: counters are per check id, never per
 * entry or per value.
 */
const CHECK_DEFS = {
  timingShape: ['TimingData', 'malformed payload'],
  timingKey: ['TimingData', 'non-numeric driver key'],
  timingLine: ['TimingData', 'driver entry that is not an object'],
  timingPosition: ['TimingData', 'non-numeric position'],
  timingLaps: ['TimingData', 'non-numeric lap count'],
  timingPitStops: ['TimingData', 'non-numeric pit-stop count'],
  timingFlag: ['TimingData', 'non-boolean pit/retired/stopped flag'],
  timingGap: ['TimingData', 'gap that is neither text nor a number'],
  timingInterval: ['TimingData', 'interval that is not an object'],
  timingLapTime: ['TimingData', 'non-numeric lap time'],
  timingSectors: ['TimingData', 'malformed sector entry'],
  timingSector: ['TimingData', 'non-numeric sector time'],
  driverKey: ['DriverList', 'non-numeric driver key'],
  driverEntry: ['DriverList', 'driver entry that is not an object'],
  driverText: ['DriverList', 'identity field that is not text'],
  positionShape: ['Position', 'malformed position frame'],
  positionKey: ['Position', 'non-numeric driver key'],
  positionEntry: ['Position', 'car entry that is not an object'],
  positionStatus: ['Position', 'status that is not text'],
  positionCoord: ['Position', 'missing or non-numeric X/Y/Z'],
  tyresShape: ['CurrentTyres', 'malformed payload'],
  tyresKey: ['CurrentTyres', 'non-numeric driver key'],
  tyresEntry: ['CurrentTyres', 'tyre entry that is not an object'],
  tyresCompound: ['CurrentTyres', 'compound that is not text'],
  tyresNew: ['CurrentTyres', 'non-boolean New flag'],
  stintsShape: ['TyreStintSeries', 'malformed payload'],
  stintsKey: ['TyreStintSeries', 'non-numeric driver key'],
  stintsDriver: ['TyreStintSeries', 'driver stint list that is not an object or array'],
  stintsEntry: ['TyreStintSeries', 'stint that is not an object'],
  stintsCompound: ['TyreStintSeries', 'compound that is not text'],
  stintsNew: ['TyreStintSeries', 'non-boolean New flag'],
  stintsLaps: ['TyreStintSeries', 'non-numeric StartLaps/TotalLaps'],
  rcShape: ['RaceControlMessages', 'malformed payload'],
  rcMessage: ['RaceControlMessages', 'message that is not an object'],
  rcText: ['RaceControlMessages', 'missing or non-text Message'],
  rcLabel: ['RaceControlMessages', 'non-text Category/Flag/Scope'],
  rcDate: ['RaceControlMessages', 'unparseable Utc timestamp'],
  rcNumber: ['RaceControlMessages', 'non-numeric Lap/Sector/RacingNumber']
} as const satisfies Record<string, readonly [FeedTopic, string]>

export type CheckId = keyof typeof CHECK_DEFS

export const CHECK_IDS = Object.keys(CHECK_DEFS) as CheckId[]

export function checkFeed(id: CheckId): FeedTopic {
  return CHECK_DEFS[id][0]
}

export function checkProblem(id: CheckId): string {
  return CHECK_DEFS[id][1]
}

/**
 * Where a validator reports. `check` is called once per value inspected, good or
 * bad, so a count of anomalies always comes with how many values were looked at.
 * `field` is a literal from the validator, so passing it costs no allocation; the
 * tracker only builds example text for the first anomaly of a check.
 */
export interface FeedSink {
  check(id: CheckId, bad: boolean, key: string, value: unknown, field?: string): void
}

export type FeedValidator = (payload: unknown, sink: FeedSink) => void

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Object or array: F1 patches lists as indexed objects, so either is a valid container. */
export const isContainer = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

/** Mirrors what the normalizers accept as a number (`numOrNull`). */
export const isNumeric = (v: unknown): boolean => numOrNull(v) !== null

/** Mirrors `String(v).toLowerCase() === 'true'`: only real boolean text is meaningful. */
export const isBoolLike = (v: unknown): boolean =>
  typeof v === 'boolean' ||
  (typeof v === 'string' && (v.toLowerCase() === 'true' || v.toLowerCase() === 'false'))

const NUMERIC_KEY = /^\d+$/
export const isNumericKey = (key: string): boolean => NUMERIC_KEY.test(key)

/** F1's own patch markers (`_deleted`, `_kf`) are not data. */
export const isMarkerKey = (key: string): boolean => key.charCodeAt(0) === 95
