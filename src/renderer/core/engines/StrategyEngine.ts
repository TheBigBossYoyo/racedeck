import { degradationTrend } from './strategy/StintLaps'
import { undercutDelta } from './strategy/Undercut'
import { pitLossFor } from './strategy/PitLoss'
import { buildPitScenarios, predictPitStop } from './strategy/PitPrediction'
import { generateInsights, pitNowAssistant } from './strategy/StrategyInsights'

/**
 * StrategyEngine — race strategy intelligence. EVERYTHING it produces is an
 * ESTIMATE (heuristic), never presented as fact. Estimates are derived only
 * from real, available data; when inputs are missing, insights are omitted.
 *
 * The engine is deliberately deterministic and pure so it can be unit-tested and
 * so the AI Race Engineer layer can be *grounded* in these numbers rather than
 * inventing them. The AI narrates and reasons over this factual context; it
 * never manufactures the underlying figures.
 *
 * This file is the public facade. The implementation lives in ./strategy/:
 * PitLoss (per-circuit pit loss, pit-lane analysis), Undercut, StintLaps (shared
 * lap windowing + degradation slope), PitPrediction, StrategyInsights,
 * StintPlanner and PaceBattle.
 */

export {
  estimatePitLoss,
  circuitPitLoss,
  servedTimePenalties,
  analysePitLane
} from './strategy/PitLoss'
export type { PitLossEstimate, PitLaneAnalysis } from './strategy/PitLoss'
export { fuelCorrectedLapTimes } from './strategy/StintLaps'
export type { DegradationTrend } from './strategy/StintLaps'
export type { RejoinCar, PitVerdict, PitPrediction, PitScenario } from './strategy/PitPrediction'
export { pickTeammate } from './strategy/StrategyInsights'
export type { InsightKind, StrategyInsight } from './strategy/StrategyInsights'
export { planRemainingStrategy } from './strategy/StintPlanner'
export type { StintSegment, StrategyPlan, RemainingStrategy } from './strategy/StintPlanner'
export { paceComparison, paceBattleBetween } from './strategy/PaceBattle'
export type {
  PaceRival,
  PaceBattle,
  PaceDuelTrend,
  PaceDuelSide,
  PaceDuel
} from './strategy/PaceBattle'

export const StrategyEngine = {
  degradationTrend,
  undercutDelta,
  pitLossFor,
  predictPitStop,
  buildPitScenarios,
  generateInsights,
  pitNowAssistant
} as const
