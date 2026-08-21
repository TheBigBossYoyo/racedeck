import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, AxisPointerComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import { memo } from 'react'
import type { EChartsCoreOption } from 'echarts/core'

/**
 * Shared ECharts setup for RaceDeck. Registers a dark "racedeck" theme aligned
 * with the app palette and exports a thin, memoized <Chart> wrapper plus option
 * fragments so every chart widget looks consistent.
 *
 * Modular ECharts: only the chart types / components / renderer actually used by
 * the four chart widgets are registered — this keeps the async echarts chunk as
 * small as possible.
 */
echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, AxisPointerComponent, CanvasRenderer])

export function cssVar(name: string, fallback = '255 255 255'): string {
  if (typeof document === 'undefined') return `rgb(${fallback})`
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return `rgb(${v || fallback})`
}

const FG_MUTED = '#969CAC'
const HAIRLINE = 'rgba(64,70,92,0.35)'

echarts.registerTheme('racedeck', {
  color: ['#22d3ee', '#a882ff', '#34d399', '#f59e0b', '#f43f5e', '#64c4ff', '#ff8000'],
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: 'Inter var, Inter, system-ui, sans-serif',
    color: FG_MUTED,
    fontSize: 11
  },
  title: { textStyle: { color: '#E9ECF5' } },
  legend: { textStyle: { color: FG_MUTED } },
  grid: { borderColor: HAIRLINE },
  categoryAxis: {
    axisLine: { lineStyle: { color: HAIRLINE } },
    axisTick: { show: false },
    axisLabel: { color: FG_MUTED },
    splitLine: { show: false }
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: FG_MUTED },
    splitLine: { lineStyle: { color: HAIRLINE, type: 'dashed' } }
  },
  tooltip: {
    backgroundColor: 'rgba(19,22,33,0.95)',
    borderColor: HAIRLINE,
    textStyle: { color: '#E9ECF5', fontSize: 11 }
  }
})

export const gridBase = { left: 8, right: 12, top: 12, bottom: 8, containLabel: true }

export const tooltipBase = {
  trigger: 'axis' as const,
  backgroundColor: 'rgba(19,22,33,0.95)',
  borderColor: HAIRLINE,
  borderWidth: 1,
  textStyle: { color: '#E9ECF5', fontSize: 11 },
  axisPointer: { lineStyle: { color: 'rgba(64,70,92,0.6)' } }
}

export const Chart = memo(function Chart({
  option,
  className,
  notMerge = false
}: {
  option: EChartsCoreOption
  className?: string
  notMerge?: boolean
}) {
  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      theme="racedeck"
      notMerge={notMerge}
      replaceMerge={notMerge ? undefined : ['series']}
      lazyUpdate
      style={{ width: '100%', height: '100%' }}
      className={className}
      opts={{ renderer: 'canvas' }}
    />
  )
})

export { echarts }
