import type { WidgetMeta } from '@renderer/core/engines/LayoutManager'

export const MODULE_GROUPS: { group: WidgetMeta['group']; label: string }[] = [
  { group: 'timing', label: 'Timing & track' },
  { group: 'strategy', label: 'Strategy & AI' },
  { group: 'charts', label: 'Charts' },
  { group: 'tools', label: 'Tools' }
]

export const MODULE_DESC: Partial<Record<string, string>> = {
  'timing-tower': 'Live classification tower',
  'track-map': 'Positions around the lap',
  'race-control': 'Flags, SC, penalties feed',
  weather: 'Air/track temp, rain',
  'tyre-strategy': 'Stint & pit history bars',
  'gap-chart': 'Gap-to-leader over laps',
  'lap-time-chart': 'Lap-time trends',
  'position-trend': 'Position changes',
  'driver-comparison': 'Head-to-head deltas',
  telemetry: 'Speed/throttle/brake traces',
  'strategy-insights': 'Undercut, deg, battles',
  'pit-predictor': 'If they pit now: rejoin & delta',
  'stint-planner': 'Optimal remaining strategy',
  'pit-log': 'Field-wide pit stops, newest first',
  'pace-battle': 'Pace vs car ahead & behind',
  'driver-dossier': 'One driver, everything',
  'ai-engineer': 'AI strategy briefings + chat',
  'team-pace': 'Fastest team right now',
  'tyre-lab': 'Compound pace, deg & best tyre',
  'win-probability': 'Win/podium/points odds + market',
  'battle-radar': 'Live on-track fights & overtake trains',
  'race-story': 'Auto narrative of key moments',
  championship: 'Title-fight projection & standings',
  'engineer-notes': 'Proactive strategy prompts + voice',
  alerts: 'Event alert center',
  sync: 'Broadcast-delay wizard',
  annotations: 'Timestamped notes, exportable with the debrief',
  plugins: 'Run local scripts against a readonly snapshot'
}
