import { memo, lazy, Suspense, type ComponentType } from 'react'
import type { WidgetKey } from '@renderer/core/engines/LayoutManager'
import { TodVideoPanel } from '@renderer/widgets/TodVideoPanel'
import { TimingTower } from '@renderer/widgets/TimingTower'
import { TrackMap } from '@renderer/widgets/TrackMap'
import { RaceControlFeed } from '@renderer/widgets/RaceControlFeed'
import { WeatherPanel } from '@renderer/widgets/WeatherPanel'
import { TyreStrategyTable } from '@renderer/widgets/TyreStrategyTable'
import { BattleRadarPanel } from '@renderer/widgets/BattleRadarPanel'
import { RaceStoryPanel } from '@renderer/widgets/RaceStoryPanel'
import { AlertCenter } from '@renderer/widgets/AlertCenter'
import { SessionSyncController } from '@renderer/widgets/SessionSyncController'

/** Glassmorphic skeleton shown while a chart chunk is loading. */
function ChartSkeleton() {
  return (
    <div className="flex h-full w-full animate-pulse items-center justify-center rounded-xl bg-white/5">
      <span className="text-sm text-white/30">Loading chart…</span>
    </div>
  )
}

function lazyWidget(loader: () => Promise<{ default: ComponentType }>): ComponentType {
  const LazyWidget = lazy(loader)
  return function DeferredWidget() {
    return (
      <Suspense fallback={<ChartSkeleton />}>
        <LazyWidget />
      </Suspense>
    )
  }
}

// Keep the default Broadcast workspace immediate. Specialist workspace panels
// are fetched only when their layout is opened, reducing startup parse/evaluate.
const QualifyingMonitorWidget = lazyWidget(() =>
  import('@renderer/widgets/QualifyingMonitor').then((m) => ({ default: m.QualifyingMonitor }))
)
const DriverComparisonWidget = lazyWidget(() =>
  import('@renderer/widgets/DriverComparisonCard').then((m) => ({ default: m.DriverComparisonCard }))
)
const StrategyInsightsWidget = lazyWidget(() =>
  import('@renderer/widgets/StrategyInsightsPanel').then((m) => ({ default: m.StrategyInsightsPanel }))
)
const PitStopPredictorWidget = lazyWidget(() =>
  import('@renderer/widgets/PitStopPredictor').then((m) => ({ default: m.PitStopPredictor }))
)
const StintPlannerWidget = lazyWidget(() =>
  import('@renderer/widgets/StintPlanner').then((m) => ({ default: m.StintPlanner }))
)
const PaceBattleWidget = lazyWidget(() =>
  import('@renderer/widgets/PaceBattlePanel').then((m) => ({ default: m.PaceBattlePanel }))
)
const DriverDossierWidget = lazyWidget(() =>
  import('@renderer/widgets/DriverDossier').then((m) => ({ default: m.DriverDossier }))
)
const AiRaceEngineerWidget = lazyWidget(() =>
  import('@renderer/widgets/AiRaceEngineer').then((m) => ({ default: m.AiRaceEngineer }))
)
const TeamPaceWidget = lazyWidget(() =>
  import('@renderer/widgets/TeamPacePanel').then((m) => ({ default: m.TeamPacePanel }))
)
const TyrePerformanceWidget = lazyWidget(() =>
  import('@renderer/widgets/TyrePerformancePanel').then((m) => ({ default: m.TyrePerformancePanel }))
)
const WinProbabilityWidget = lazyWidget(() =>
  import('@renderer/widgets/WinProbabilityPanel').then((m) => ({ default: m.WinProbabilityPanel }))
)
const ChampionshipWidget = lazyWidget(() =>
  import('@renderer/widgets/ChampionshipPanel').then((m) => ({ default: m.ChampionshipPanel }))
)
const EngineerNotesWidget = lazyWidget(() =>
  import('@renderer/widgets/EngineerNotesPanel').then((m) => ({ default: m.EngineerNotesPanel }))
)
const PracticeRunWidget = lazyWidget(() =>
  import('@renderer/widgets/PracticeRunBoard').then((m) => ({ default: m.PracticeRunBoard }))
)
const PracticeIntelligenceWidget = lazyWidget(() =>
  import('@renderer/widgets/PracticeIntelligencePanel').then((m) => ({ default: m.PracticeIntelligencePanel }))
)
const WeekendUpgradesWidget = lazyWidget(() =>
  import('@renderer/widgets/WeekendUpgradesPanel').then((m) => ({ default: m.WeekendUpgradesPanel }))
)
const GapChartWidget = lazyWidget(() =>
  import('@renderer/widgets/GapChart').then((m) => ({ default: m.GapChart }))
)
const LapTimeSeriesChartWidget = lazyWidget(() =>
  import('@renderer/widgets/LapTimeSeriesChart').then((m) => ({ default: m.LapTimeSeriesChart }))
)
const TeamRadioPanelWidget = lazyWidget(() =>
  import('@renderer/widgets/TeamRadioPanel').then((m) => ({ default: m.TeamRadioPanel }))
)
const PositionTrendChartWidget = lazyWidget(() =>
  import('@renderer/widgets/PositionTrendChart').then((m) => ({ default: m.PositionTrendChart }))
)
const TelemetryTracePanelWidget = lazyWidget(() =>
  import('@renderer/widgets/TelemetryTracePanel').then((m) => ({ default: m.TelemetryTracePanel }))
)

const REGISTRY: Record<WidgetKey, React.ComponentType> = {
  'tod-video': TodVideoPanel,
  'timing-tower': TimingTower,
  'qualifying-monitor': QualifyingMonitorWidget,
  'track-map': TrackMap,
  'race-control': RaceControlFeed,
  'team-radio': TeamRadioPanelWidget,
  weather: WeatherPanel,
  'tyre-strategy': TyreStrategyTable,
  'gap-chart': GapChartWidget,
  'lap-time-chart': LapTimeSeriesChartWidget,
  'position-trend': PositionTrendChartWidget,
  'driver-comparison': DriverComparisonWidget,
  telemetry: TelemetryTracePanelWidget,
  'strategy-insights': StrategyInsightsWidget,
  'pit-predictor': PitStopPredictorWidget,
  'stint-planner': StintPlannerWidget,
  'pace-battle': PaceBattleWidget,
  'driver-dossier': DriverDossierWidget,
  'ai-engineer': AiRaceEngineerWidget,
  'team-pace': TeamPaceWidget,
  'tyre-lab': TyrePerformanceWidget,
  'win-probability': WinProbabilityWidget,
  championship: ChampionshipWidget,
  'battle-radar': BattleRadarPanel,
  'race-story': RaceStoryPanel,
  'engineer-notes': EngineerNotesWidget,
  alerts: AlertCenter,
  sync: SessionSyncController,
  'practice-runs': PracticeRunWidget,
  'practice-intelligence': PracticeIntelligenceWidget,
  'weekend-upgrades': WeekendUpgradesWidget
}

export const WidgetRenderer = memo(function WidgetRenderer({
  widgetKey
}: {
  widgetKey: WidgetKey
}) {
  const Component = REGISTRY[widgetKey]
  return <Component />
})
