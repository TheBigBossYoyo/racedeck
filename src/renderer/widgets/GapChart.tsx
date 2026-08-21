import { useMemo, useState } from 'react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Segmented } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { Chart, gridBase, tooltipBase } from '@renderer/lib/echarts'
import { hexColor, formatGap } from '@renderer/lib/utils'
import type { EChartsCoreOption } from 'echarts/core'

export function GapChart() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const [view, setView] = useState<'leader' | 'interval'>('leader')

  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!snapshot || snapshot.timing.length === 0) return null

    const driverMap = new Map<number, { code: string; color: string }>()
    snapshot.drivers.forEach((d) => {
      driverMap.set(d.number, { code: d.code, color: hexColor(d.teamColour) })
    })

    const validTiming = snapshot.timing
      .filter((t) => t.position !== null)
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))

    const categories: string[] = []
    const data: any[] = []

    validTiming.forEach((t) => {
      const d = driverMap.get(t.driverNumber)
      if (!d) return

      let val: number | null = null
      if (view === 'leader') {
        if (t.position === 1) val = 0
        else if (typeof t.gapToLeader === 'number') val = t.gapToLeader
      } else {
        if (t.position === 1) val = 0
        else if (typeof t.intervalAhead === 'number') val = t.intervalAhead
      }

      if (val !== null) {
        categories.push(d.code)
        data.push({
          value: val,
          itemStyle: { color: d.color },
          driver: d.code,
          gapRaw: view === 'leader' ? t.gapToLeader : t.intervalAhead
        })
      }
    })

    // Invert arrays so P1 is at the top
    categories.reverse()
    data.reverse()

    return {
      grid: { ...gridBase, left: 40 },
      tooltip: {
        ...tooltipBase,
        formatter: (params: any) => {
          const p = params[0]
          if (!p) return ''
          const raw = p.data.gapRaw
          return `<b>${p.data.driver}</b><br/>Gap: ${formatGap(raw)}`
        }
      },
      xAxis: {
        type: 'value',
        name: 'Seconds',
        nameLocation: 'middle',
        nameGap: 24,
        axisLabel: { formatter: '{value}s' }
      },
      yAxis: {
        type: 'category',
        data: categories,
        axisTick: { show: false },
        axisLine: { show: false }
      },
      series: [
        {
          type: 'bar',
          data,
          label: {
            show: true,
            position: 'right',
            formatter: (params: any) => formatGap(params.data.gapRaw),
            fontSize: 10,
            color: '#969CAC'
          }
        }
      ]
    }
  }, [snapshot, view])

  if (!snapshot || snapshot.timing.length === 0 || !snapshot.availability.timing) {
    return (
      <WidgetFrame title="Gap Chart">
        <EmptyState title="No timing data" hint="Waiting for session data..." />
      </WidgetFrame>
    )
  }

  return (
    <WidgetFrame
      title="Gap Chart"
      actions={
        <Segmented
          options={[
            { value: 'leader', label: 'To Leader' },
            { value: 'interval', label: 'Interval' }
          ]}
          value={view}
          onChange={(v) => setView(v as 'leader' | 'interval')}
        />
      }
    >
      {option ? (
        <Chart option={option} />
      ) : (
        <EmptyState title="No gap data" hint="Leader gaps not yet available." />
      )}
    </WidgetFrame>
  )
}
