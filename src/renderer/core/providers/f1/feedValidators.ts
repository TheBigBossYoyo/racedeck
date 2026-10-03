import {
  isBoolLike,
  isContainer,
  isMarkerKey,
  isNumeric,
  isNumericKey,
  isPlainObject,
  type CheckId,
  type FeedSink,
  type FeedTopic,
  type FeedValidator
} from './feedChecks'
import { parseLapTime } from './shared'

/**
 * One validator per major feed. Each takes one decoded stream payload (`point.d`,
 * a keyframe or a delta) and reports what it finds to a sink. They never mutate
 * the payload and never return data: the normalizers still read the raw feed.
 *
 * Deltas are partial, so an ABSENT field is never an anomaly (`null` counts as
 * absent, since a delta may clear a value). Only a present value of the wrong type
 * is, plus the few fields the feed always sends whole: a Position frame's X/Y/Z
 * and a race-control message's text.
 */

const TIMING_FLAGS = ['InPit', 'PitOut', 'Retired', 'Stopped'] as const
const DRIVER_TEXT_FIELDS = [
  'Tla',
  'FirstName',
  'LastName',
  'FullName',
  'BroadcastName',
  'TeamName',
  'TeamColour',
  'HeadshotUrl',
  'CountryCode'
] as const
const POSITION_AXES = ['X', 'Y', 'Z'] as const
const RC_LABEL_FIELDS = ['Category', 'Flag', 'Scope'] as const
const RC_NUMBER_FIELDS = ['Lap', 'Sector', 'RacingNumber'] as const

/** Report `field` of `obj` when it is present, judged bad by `isBad`. */
function checkField(
  sink: FeedSink,
  id: CheckId,
  key: string,
  obj: Record<string, unknown>,
  field: string,
  isBad: (v: unknown) => boolean
): void {
  const value = obj[field]
  if (value != null) sink.check(id, isBad(value), key, value, field)
}

const notNumeric = (v: unknown): boolean => !isNumeric(v)
const notBoolLike = (v: unknown): boolean => !isBoolLike(v)
const notText = (v: unknown): boolean => typeof v !== 'string'
const notBoolean = (v: unknown): boolean => typeof v !== 'boolean'
const notTextOrNumber = (v: unknown): boolean => typeof v !== 'string' && typeof v !== 'number'

/** A lap/sector time: blank means "not set yet"; anything else must parse. */
function notLapTime(v: unknown): boolean {
  if (typeof v === 'string') return v.trim() !== '' && parseLapTime(v) === null
  return typeof v !== 'number' || parseLapTime(v) === null
}

// ── TimingData ─────────────────────────────────────────────────────────────────

function validateLapTimeCell(
  line: Record<string, unknown>,
  key: string,
  field: string,
  sink: FeedSink
): void {
  const cell = line[field]
  if (cell == null) return
  const isObject = isPlainObject(cell)
  const shown = isObject ? cell.Value : cell
  sink.check('timingLapTime', !isObject || notLapTime(cell.Value ?? ''), key, shown, field)
}

function validateSectors(line: Record<string, unknown>, key: string, sink: FeedSink): void {
  const sectors = line.Sectors
  if (sectors == null) return
  if (!isContainer(sectors)) {
    sink.check('timingSectors', true, key, sectors, 'Sectors')
    return
  }
  for (const index in sectors) {
    if (isMarkerKey(index)) continue
    const sector = sectors[index]
    if (sector == null) continue
    const valid = isPlainObject(sector)
    sink.check('timingSectors', !valid, key, sector, 'Sectors')
    if (valid) checkField(sink, 'timingSector', key, sector, 'Value', notLapTime)
  }
}

function validateTimingLine(key: string, line: Record<string, unknown>, sink: FeedSink): void {
  checkField(sink, 'timingPosition', key, line, 'Position', notNumeric)
  checkField(sink, 'timingLaps', key, line, 'NumberOfLaps', notNumeric)
  checkField(sink, 'timingPitStops', key, line, 'NumberOfPitStops', notNumeric)
  for (const flag of TIMING_FLAGS) checkField(sink, 'timingFlag', key, line, flag, notBoolean)
  checkField(sink, 'timingGap', key, line, 'GapToLeader', notTextOrNumber)
  const interval = line.IntervalToPositionAhead
  if (interval != null) {
    const valid = isPlainObject(interval)
    sink.check('timingInterval', !valid, key, interval, 'IntervalToPositionAhead')
    if (valid) checkField(sink, 'timingGap', key, interval, 'Value', notTextOrNumber)
  }
  validateLapTimeCell(line, key, 'LastLapTime', sink)
  validateLapTimeCell(line, key, 'BestLapTime', sink)
  validateSectors(line, key, sink)
}

/** Iterate the numbered entries of a keyed feed object, checking key and entry shape. */
function forEachEntry(
  bag: Record<string, unknown>,
  keyCheck: CheckId,
  entryCheck: CheckId,
  sink: FeedSink,
  visit: (key: string, entry: Record<string, unknown>) => void
): void {
  for (const key in bag) {
    if (isMarkerKey(key)) continue
    const numeric = isNumericKey(key)
    sink.check(keyCheck, !numeric, key, key)
    const entry = bag[key]
    if (!numeric || entry == null) continue
    const valid = isPlainObject(entry)
    sink.check(entryCheck, !valid, key, entry)
    if (valid) visit(key, entry)
  }
}

export function validateTimingData(payload: unknown, sink: FeedSink): void {
  if (!isPlainObject(payload)) {
    sink.check('timingShape', true, '', payload)
    return
  }
  const lines = payload.Lines
  if (lines == null) return
  const valid = isPlainObject(lines)
  sink.check('timingShape', !valid, '', lines, 'Lines')
  if (valid)
    forEachEntry(lines, 'timingKey', 'timingLine', sink, (key, line) =>
      validateTimingLine(key, line, sink)
    )
}

// ── DriverList ─────────────────────────────────────────────────────────────────

export function validateDriverList(payload: unknown, sink: FeedSink): void {
  if (!isPlainObject(payload)) {
    sink.check('driverEntry', true, '', payload)
    return
  }
  forEachEntry(payload, 'driverKey', 'driverEntry', sink, (key, driver) => {
    for (const field of DRIVER_TEXT_FIELDS)
      checkField(sink, 'driverText', key, driver, field, notText)
  })
}

// ── Position ───────────────────────────────────────────────────────────────────

function validatePositionEntry(key: string, car: Record<string, unknown>, sink: FeedSink): void {
  checkField(sink, 'positionStatus', key, car, 'Status', notText)
  // The feed sends every car whole in every frame, so an absent axis is an anomaly.
  for (const axis of POSITION_AXES) {
    sink.check('positionCoord', !isNumeric(car[axis]), key, car[axis], axis)
  }
}

export function validatePosition(payload: unknown, sink: FeedSink): void {
  if (!isPlainObject(payload)) {
    sink.check('positionShape', true, '', payload)
    return
  }
  const batches = payload.Position
  if (batches == null) return
  if (!isContainer(batches)) {
    sink.check('positionShape', true, '', batches, 'Position')
    return
  }
  for (const index in batches) {
    if (isMarkerKey(index)) continue
    const batch = batches[index]
    const entries = isPlainObject(batch) ? batch.Entries : undefined
    const valid = isPlainObject(entries)
    sink.check('positionShape', !valid, index, valid ? entries : batch, 'Entries')
    if (valid) {
      forEachEntry(entries, 'positionKey', 'positionEntry', sink, (key, car) =>
        validatePositionEntry(key, car, sink)
      )
    }
  }
}

// ── CurrentTyres / TyreStintSeries ─────────────────────────────────────────────

export function validateCurrentTyres(payload: unknown, sink: FeedSink): void {
  if (!isPlainObject(payload)) {
    sink.check('tyresShape', true, '', payload)
    return
  }
  const tyres = payload.Tyres
  if (tyres == null) return
  const valid = isPlainObject(tyres)
  sink.check('tyresShape', !valid, '', tyres, 'Tyres')
  if (!valid) return
  forEachEntry(tyres, 'tyresKey', 'tyresEntry', sink, (key, tyre) => {
    checkField(sink, 'tyresCompound', key, tyre, 'Compound', notText)
    checkField(sink, 'tyresNew', key, tyre, 'New', notBoolLike)
  })
}

function validateStint(key: string, stint: Record<string, unknown>, sink: FeedSink): void {
  checkField(sink, 'stintsCompound', key, stint, 'Compound', notText)
  checkField(sink, 'stintsNew', key, stint, 'New', notBoolLike)
  checkField(sink, 'stintsLaps', key, stint, 'StartLaps', notNumeric)
  checkField(sink, 'stintsLaps', key, stint, 'TotalLaps', notNumeric)
}

export function validateTyreStintSeries(payload: unknown, sink: FeedSink): void {
  if (!isPlainObject(payload)) {
    sink.check('stintsShape', true, '', payload)
    return
  }
  const drivers = payload.Stints
  if (drivers == null) return
  const valid = isPlainObject(drivers)
  sink.check('stintsShape', !valid, '', drivers, 'Stints')
  if (!valid) return
  for (const key in drivers) {
    if (isMarkerKey(key)) continue
    const numeric = isNumericKey(key)
    sink.check('stintsKey', !numeric, key, key)
    const list = drivers[key]
    if (!numeric || list == null) continue
    const container = isContainer(list)
    sink.check('stintsDriver', !container, key, list)
    if (container) validateStintList(key, list, sink)
  }
}

function validateStintList(key: string, list: Record<string, unknown>, sink: FeedSink): void {
  for (const index in list) {
    if (isMarkerKey(index)) continue
    const stint = list[index]
    if (stint == null) continue
    const valid = isPlainObject(stint)
    sink.check('stintsEntry', !valid, key, stint)
    if (valid) validateStint(key, stint, sink)
  }
}

// ── RaceControlMessages ────────────────────────────────────────────────────────

function validateRaceControlMessage(
  key: string,
  message: Record<string, unknown>,
  sink: FeedSink
): void {
  // Utc may be absent (the normalizer falls back to the point time) but not garbage.
  const utc = message.Utc
  if (utc != null) {
    sink.check('rcDate', typeof utc !== 'string' || Number.isNaN(Date.parse(utc)), key, utc, 'Utc')
  }
  sink.check('rcText', typeof message.Message !== 'string', key, message.Message, 'Message')
  for (const field of RC_LABEL_FIELDS) checkField(sink, 'rcLabel', key, message, field, notText)
  for (const field of RC_NUMBER_FIELDS)
    checkField(sink, 'rcNumber', key, message, field, notNumeric)
}

export function validateRaceControl(payload: unknown, sink: FeedSink): void {
  if (!isPlainObject(payload)) {
    sink.check('rcShape', true, '', payload)
    return
  }
  const messages = payload.Messages
  if (messages == null) return
  const valid = isContainer(messages)
  sink.check('rcShape', !valid, '', messages, 'Messages')
  if (!valid) return
  for (const index in messages) {
    if (isMarkerKey(index)) continue
    const message = messages[index]
    if (message == null) continue
    const isObject = isPlainObject(message)
    sink.check('rcMessage', !isObject, index, message)
    if (isObject) validateRaceControlMessage(index, message, sink)
  }
}

/** Topic → validator, for the feeds with a validator. A Map: topics are remote strings. */
export const FEED_VALIDATORS: ReadonlyMap<string, FeedValidator> = new Map<
  FeedTopic,
  FeedValidator
>([
  ['TimingData', validateTimingData],
  ['DriverList', validateDriverList],
  ['Position', validatePosition],
  ['CurrentTyres', validateCurrentTyres],
  ['TyreStintSeries', validateTyreStintSeries],
  ['RaceControlMessages', validateRaceControl]
])
