import { useMemo } from 'react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, TyrePill, Badge } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { Chart, gridBase, tooltipBase, cssVar } from '@renderer/lib/echarts'
import { hexColor } from '@renderer/lib/utils'
import type { EChartsCoreOption } from 'echarts/core'
import type { AeroMode } from '@shared/models'

/** Compact active-aero mode badge. Hidden (null) when no data. */
function AeroModeBadge({ mode }: { mode: AeroMode | null }) {
  if (mode == null) return null
  const isStraight = mode === 'STRAIGHT'
  return (
    <span
      className={[
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold leading-none tracking-wider',
        isStraight
          ? 'bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/40'
          : 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40'
      ].join(' ')}
      title={isStraight ? 'Straight Mode: low drag' : 'Corner Mode: high downforce'}
    >
      {isStraight ? 'STRAIGHT' : 'CORNER'}
    </span>
  )
}

export function TelemetryTracePanel() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const getTelemetry = useSessionStore((s) => s.getTelemetry)
  const focusDriver = useSessionStore((s) => s.focusDriver)

  const targetDriver = useMemo(() => {
    if (focusDriver) return focusDriver
    if (snapshot?.timing && snapshot.timing.length > 0) {
      const p1 = snapshot.timing.find((t) => t.position === 1)
      if (p1) return p1.driverNumber
    }
    return null
  }, [focusDriver, snapshot?.timing])

  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!snapshot || !targetDriver || !snapshot.availability.telemetry) return null

    const driver = snapshot.drivers.find((d) => d.number === targetDriver)
    const timing = snapshot.timing.find((t) => t.driverNumber === targetDriver)
    if (!driver) return null

    // Fetch ~60 seconds of telemetry
    const telemetry = getTelemetry(targetDriver, 60)
    if (telemetry.length === 0) return null

    const color = hexColor(driver.teamColour)
    const times = telemetry.map((t) => new Date(t.date).toLocaleTimeString('en-GB', { hour12: false }))
    const speeds = telemetry.map((t) => t.speed ?? 0)
    const throttles = telemetry.map((t) => t.throttle ?? 0)
    const brakes = telemetry.map((t) => t.brake ?? 0)
    const gears = telemetry.map((t) => t.gear ?? 0)

    return {
      tooltip: {
        ...tooltipBase,
        axisPointer: { type: 'line' },
        formatter: (params: any) => {
          if (!Array.isArray(params)) return ''
          let html = `<b>${params[0].axisValue}</b><br/>`
          params.forEach((p) => {
            html += `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${p.value}</b><br/>`
          })
          return html
        }
      },
      axisPointer: {
        link: [{ xAxisIndex: 'all' }]
      },
      grid: [
        { ...gridBase, left: 40, top: 10, bottom: '55%', height: '40%' },
        { ...gridBase, left: 40, top: '50%', bottom: '25%', height: '20%' },
        { ...gridBase, left: 40, top: '80%', bottom: 10, height: '15%' }
      ],
      xAxis: [
        { type: 'category', data: times, gridIndex: 0, axisLabel: { show: false }, axisTick: { show: false } },
        { type: 'category', data: times, gridIndex: 1, axisLabel: { show: false }, axisTick: { show: false } },
        { type: 'category', data: times, gridIndex: 2 }
      ],
      yAxis: [
        { type: 'value', name: 'Speed', gridIndex: 0, min: 0, max: 350, splitNumber: 3 },
        { type: 'value', name: 'Thr/Brk', gridIndex: 1, min: 0, max: 100, splitNumber: 2 },
        { type: 'value', name: 'Gear', gridIndex: 2, min: 0, max: 8, splitNumber: 2, interval: 2 }
      ],
      series: [
        {
          name: 'Speed',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: speeds,
          itemStyle: { color },
          areaStyle: { color: `${color}33` },
          showSymbol: false,
          smooth: true
        },
        {
          name: 'Throttle',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: throttles,
          itemStyle: { color: cssVar('--good', '52 211 153') },
          showSymbol: false,
          step: 'end'
        },
        {
          name: 'Brake',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: brakes,
          itemStyle: { color: cssVar('--danger', '244 63 94') },
          showSymbol: false,
          step: 'end'
        },
        {
          name: 'Gear',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: gears,
          itemStyle: { color: cssVar('--accent', '34 211 238') },
          showSymbol: false,
          step: 'end'
        }
      ]
    }
  }, [snapshot, getTelemetry, targetDriver])

  // Hooks must remain unconditional: telemetry availability changes during app
  // boot and provider switches, so compute the badge before any early return.
  const currentAeroMode = useMemo<AeroMode | null>(() => {
    if (!targetDriver || !snapshot?.availability.telemetry) return null
    const samples = getTelemetry(targetDriver, 8)
    return samples.length > 0 ? (samples[samples.length - 1].aeroMode ?? null) : null
  }, [snapshot, getTelemetry, targetDriver])

  if (!snapshot || !snapshot.availability.telemetry) {
    return (
      <WidgetFrame title="Telemetry">
        <EmptyState title="Telemetry unavailable" hint="High-rate telemetry is not supplied by the current provider." />
      </WidgetFrame>
    )
  }

  const driver = snapshot.drivers.find((d) => d.number === targetDriver)
  const timing = snapshot.timing.find((t) => t.driverNumber === targetDriver)

  return (
    <WidgetFrame
      title="Telemetry"
      actions={
        driver && (
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{driver.code}</Badge>
            {timing && <TyrePill compound={timing.compound} age={timing.stintAge} size="sm" />}
            <AeroModeBadge mode={currentAeroMode} />
          </div>
        )
      }
    >
      {option ? (
        <Chart option={option} />
      ) : (
        <EmptyState title="No traces" hint="Waiting for telemetry..." />
      )}
    </WidgetFrame>
  )
}
