/**
 * Pure normalizers: merged F1 live-feed state → RaceDeck models. Kept side-effect
 * free and unit-tested (tests/unit/f1normalize.test.ts). The stateful merging /
 * timeline replay lives in F1LiveProvider; these functions only map shapes.
 *
 * This file is a barrel: the implementations live in `./f1/` grouped by feed
 * (shared parsers, drivers, timing, race control, track path, laps, series,
 * tyres). Importers keep using `./f1normalize`.
 */

export { parseLapTime, parseGap } from './f1/shared'
export { normalizeSessionInfo, normalizeDrivers, mergeTopThreeDrivers } from './f1/drivers'
export {
  driverStints,
  buildStints,
  currentStint,
  buildCurrentTyres,
  buildTyreStintHistory,
  applyCurrentTyres,
  applyCurrentTyresToStints
} from './f1/tyres'
// Pure helpers engines/widgets also need live in the neutral `core/normalize/` layer.
export { reconcileTyreHistory } from '@renderer/core/normalize/tyreReconcile'
export type { TyreStintReconciliation } from '@renderer/core/normalize/tyreReconcile'
export { sectorDisplayState } from '@renderer/core/normalize/sectorDisplay'
export type { SectorDisplayState } from '@renderer/core/normalize/sectorDisplay'
export { assignCredibleFastestLap, buildTiming } from './f1/timing'
export { collectRaceControl } from './f1/raceControl'
export {
  weatherAt,
  trackStatusAt,
  lapCountAt,
  qualifyingPartAt,
  collectPitLaneTimes,
  collectTeamRadio,
  latestTrackMessage
} from './f1/series'
export {
  positionAvailability,
  pickReferenceDriver,
  ReferenceDriverTracker,
  buildTrackPath,
  debugTrackTraceInfo,
  buildClosedTrackPath,
  closeTrackTrace,
  positionCoordinatesAt
} from './f1/trackPath'
export type { TrackTraceDebugInfo, PositionCoordinates } from './f1/trackPath'
export { pitLapIndex, lapRecordToSample, buildLapPositions, buildSessionBests } from './f1/laps'
export type { LapRecord } from './f1/laps'
