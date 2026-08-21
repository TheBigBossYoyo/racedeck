import { useMemo } from 'react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { Chart, gridBase, tooltipBase } from '@renderer/lib/echarts'
import { hexColor, formatLapTime } from '@renderer/lib/utils'
import type { EChartsCoreOption } from 'echarts/core'
import type { LapSample } from '@shared/models'

export function LapTimeSeriesChart() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const getDriverLaps = useSessionStore((s) => s.getDriverLaps)
  const focusDriver = useSessionStore((s) => s.focusDriver)
  const comparison = useSessionStore((s) => s.comparison)
  const favorites = useSettingsStore((s) => s.favorites)
  const topThreeKey = snapshot?.timing
    .filter((entry) => entry.position != null && entry.position <= 3)
    .map((entry) => entry.driverNumber)
    .join(',') ?? ''

  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!snapshot || !snapshot.availability.laps) return null

    let targetDrivers: number[] = []
    if (comparison) {
      targetDrivers = comparison
    } else if (focusDriver) {
      targetDrivers = [focusDriver]
    } else if (favorites.length > 0) {
      targetDrivers = favorites
    } else {
      // Fallback: top 3
      targetDrivers = snapshot.timing
        .filter((t) => t.position !== null && t.position <= 3)
        .map((t) => t.driverNumber)
    }

    if (targetDrivers.length === 0) return null

    const driverMap = new Map<number, { code: string; color: string }>()
    snapshot.drivers.forEach((d) => {
      driverMap.set(d.number, { code: d.code, color: hexColor(d.teamColour) })
    })

    const series: any[] = []
    let hasData = false

    targetDrivers.forEach((num) => {
      const d = driverMap.get(num)
      if (!d) return

      const laps = getDriverLaps(num)
      const validLaps = laps.filter((l) => l.lapTime !== null && !l.isPitInLap && !l.isPitOutLap)
      if (validLaps.length > 0) hasData = true

      const data = validLaps.map((l) => [l.lapNumber, l.lapTime])

      series.push({
        name: d.code,
        type: 'line',
        data,
        itemStyle: { color: d.color },
        lineStyle: { width: 2 },
        symbolSize: 4,
        showSymbol: false
      })
    })

    if (!hasData) return null

    return {
      grid: { ...gridBase, left: 45, bottom: 24 },
      tooltip: {
        ...tooltipBase,
        formatter: (params: any) => {
          if (!Array.isArray(params)) return ''
          let html = `Lap ${params[0].value[0]}<br/>`
          params.forEach((p) => {
            html += `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${formatLapTime(p.value[1])}</b><br/>`
          })
          return html
        }
      },
      xAxis: {
        type: 'value',
        name: 'Lap',
        nameLocation: 'middle',
        nameGap: 15,
        min: 'dataMin',
        max: 'dataMax',
        axisLabel: { formatter: '{value}' }
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { formatter: (val: number) => formatLapTime(val) }
      },
      series
    }
  }, [snapshot?.laps, snapshot?.drivers, snapshot?.availability.laps, topThreeKey, getDriverLaps, focusDriver, comparison, favorites])

  if (!snapshot || !snapshot.availability.laps) {
    return (
      <WidgetFrame title="Lap Times">
        <EmptyState title="No lap data" hint="Lap times are not available in this session." />
      </WidgetFrame>
    )
  }

  return (
    <WidgetFrame title="Lap Times">
      {option ? (
        <Chart option={option} />
      ) : (
        <EmptyState title="Insufficient laps" hint="Waiting for complete laps to be recorded." />
      )}
    </WidgetFrame>
  )
}
