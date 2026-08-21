import { useMemo } from 'react'
import { TrendingUp } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { Chart, gridBase, tooltipBase } from '@renderer/lib/echarts'
import { hexColor } from '@renderer/lib/utils'
import type { EChartsCoreOption } from 'echarts/core'
import type { LapSample } from '@shared/models'

/**
 * PositionTrendChart — honest position-by-lap trend.
 *
 * Preferred source is `snapshot.lapPositions`: F1's OWN per-lap classification
 * (the `LapSeries` feed). It is authoritative, and it covers the entire session
 * — so connecting to a live feed mid-race still draws the full history, where
 * the fallback below can only ever know laps observed since we connected.
 *
 * Fallback derivation (archive providers without the feed): for every COMPLETED
 * lap in the snapshot we accumulate each driver's total race time and rank
 * drivers per lap. This is real data — no fabricated interpolation. Laps with a
 * missing duration are recovered from consecutive lap start timestamps when
 * possible; otherwise the line gaps.
 */

const MAX_SERIES = 8

function toMs(iso: string | null): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return isNaN(t) ? 0 : t
}

/** Effective lap time: recorded duration, or derived from consecutive starts. */
function effectiveLapTimes(laps: LapSample[]): Map<number, number> {
  const sorted = [...laps].sort((a, b) => a.lapNumber - b.lapNumber)
  const out = new Map<number, number>()
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i]
    if (l.lapTime != null && l.lapTime > 0) {
      out.set(l.lapNumber, l.lapTime)
      continue
    }
    const next = sorted[i + 1]
    const a = toMs(l.dateStart)
    const b = next ? toMs(next.dateStart) : 0
    if (a > 0 && b > a && next.lapNumber === l.lapNumber + 1) {
      out.set(l.lapNumber, (b - a) / 1000)
    }
  }
  return out
}

export function PositionTrendChart() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const focusDriver = useSessionStore((s) => s.focusDriver)
  const comparison = useSessionStore((s) => s.comparison)
  const favorites = useSettingsStore((s) => s.favorites)
  const topRunnerKey = snapshot?.timing
    .filter((entry) => entry.position != null)
    .slice(0, MAX_SERIES)
    .map((entry) => entry.driverNumber)
    .join(',') ?? ''

  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!snapshot) return null

    // F1's own classification, when the feed provides it.
    const official = snapshot.lapPositions ?? []
    const officialMaxLap = official.reduce((max, d) => Math.max(max, d.positions.length), 0)
    const useOfficial = officialMaxLap >= 2

    if (!useOfficial && (!snapshot.availability.laps || snapshot.laps.length === 0)) return null

    // Group completed laps per driver.
    const byDriver = new Map<number, LapSample[]>()
    for (const lap of snapshot.laps) {
      const arr = byDriver.get(lap.driverNumber) ?? []
      arr.push(lap)
      byDriver.set(lap.driverNumber, arr)
    }
    const derivedMaxLap = Math.max(0, ...snapshot.laps.map((l) => l.lapNumber))
    const maxLap = useOfficial ? officialMaxLap : derivedMaxLap
    if (!useOfficial && (maxLap < 2 || byDriver.size < 2)) return null

    // Cumulative race time per lap; NaN once continuity is broken (honest gap).
    const cum = new Map<number, number[]>()
    for (const [num, laps] of byDriver) {
      const times = effectiveLapTimes(laps)
      const arr: number[] = []
      let acc = 0
      let broken = false
      for (let lapN = 1; lapN <= maxLap; lapN++) {
        const t = times.get(lapN)
        if (t == null || broken) {
          broken = true
          arr.push(NaN)
        } else {
          acc += t
          arr.push(acc)
        }
      }
      cum.set(num, arr)
    }

    // Rank per lap: F1's classification when available, else derived from
    // cumulative race time among drivers with a valid running total.
    const posByDriver = new Map<number, (number | null)[]>()
    if (useOfficial) {
      for (const driver of official) {
        const padded = Array.from({ length: maxLap }, (_, i) => driver.positions[i] ?? null)
        posByDriver.set(driver.driverNumber, padded)
      }
    } else {
      for (const num of cum.keys()) posByDriver.set(num, [])
      for (let i = 0; i < maxLap; i++) {
        const standing = [...cum.entries()]
          .map(([num, arr]) => ({ num, t: arr[i] }))
          .filter((x) => Number.isFinite(x.t))
          .sort((a, b) => a.t - b.t)
        const rank = new Map(standing.map((x, idx) => [x.num, idx + 1]))
        for (const [num, arr] of posByDriver) arr.push(rank.get(num) ?? null)
      }
    }
    if (posByDriver.size < 2) return null

    // Which drivers to draw: comparison > focus+favorites > top current runners.
    const tracked = new Set<number>()
    if (comparison) comparison.forEach((n) => tracked.add(n))
    if (focusDriver != null) tracked.add(focusDriver)
    favorites.forEach((n) => tracked.add(n))
    if (tracked.size === 0) {
      snapshot.timing
        .filter((t) => t.position != null)
        .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
        .slice(0, MAX_SERIES)
        .forEach((t) => tracked.add(t.driverNumber))
    }

    const meta = new Map(snapshot.drivers.map((d) => [d.number, d]))
    const seenColors = new Map<string, number>()
    const series: object[] = []
    for (const num of tracked) {
      if (series.length >= MAX_SERIES) break
      const positions = posByDriver.get(num)
      const d = meta.get(num)
      if (!positions || !d || positions.every((p) => p == null)) continue
      const color = hexColor(d.teamColour)
      const nthOfColor = seenColors.get(color) ?? 0
      seenColors.set(color, nthOfColor + 1)
      series.push({
        name: d.code,
        type: 'line',
        data: positions.map((p, i) => [i + 1, p ?? NaN]),
        itemStyle: { color },
        lineStyle: { width: 2, type: nthOfColor > 0 ? 'dashed' : 'solid' },
        showSymbol: false,
        connectNulls: false,
        endLabel: {
          show: true,
          formatter: d.code,
          color,
          fontSize: 10,
          fontWeight: 700,
          distance: 4
        },
        emphasis: { focus: 'series' }
      })
    }
    if (series.length === 0) return null

    const fieldSize = byDriver.size
    return {
      grid: { ...gridBase, left: 30, right: 40, bottom: 24 },
      tooltip: {
        ...tooltipBase,
        valueFormatter: (v: unknown) => (typeof v === 'number' && isFinite(v) ? `P${v}` : '—')
      },
      xAxis: {
        type: 'value',
        name: 'Lap',
        nameLocation: 'middle',
        nameGap: 16,
        min: 1,
        max: maxLap,
        minInterval: 1
      },
      yAxis: {
        type: 'value',
        inverse: true,
        min: 1,
        max: fieldSize,
        minInterval: 1,
        axisLabel: { formatter: (v: number) => `P${v}` }
      },
      series
    }
  }, [snapshot?.laps, snapshot?.drivers, snapshot?.availability.laps, topRunnerKey, focusDriver, comparison, favorites])

  if (!snapshot || !snapshot.availability.laps) {
    return (
      <WidgetFrame title="Position Trend" icon={<TrendingUp />}>
        <EmptyState title="No lap data" hint="Position trend appears once laps are completed." />
      </WidgetFrame>
    )
  }

  return (
    <WidgetFrame title="Position Trend" icon={<TrendingUp />} subtitle="derived from lap times">
      {option ? (
        <Chart option={option} />
      ) : (
        <EmptyState
          title="Not enough laps yet"
          hint="The trend is computed from real completed laps (cumulative race time per lap). Scrub forward or play the session."
        />
      )}
    </WidgetFrame>
  )
}
