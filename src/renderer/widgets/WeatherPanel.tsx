import { useMemo } from 'react'
import { CloudRain, Wind, Droplets, Thermometer, Gauge, Sun } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Badge, ProvenanceBadge } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { cn } from '@renderer/lib/utils'
import {
  formatTemp,
  formatWind,
  formatWindValue,
  formatPressureValue,
  pressureUnitLabel,
  windUnitLabel
} from '@renderer/lib/units'
import {
  weatherFieldTrend,
  rainTransition,
  dryingReadiness
} from '@renderer/core/engines/WeatherTrendEngine'

function Stat({
  icon,
  label,
  value,
  unit,
  tone = 'fg'
}: {
  icon: React.ReactNode
  label: string
  value: string
  unit?: string
  tone?: 'fg' | 'accent' | 'warn'
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-hairline/20 bg-white/[0.02] px-2.5 py-2">
      <span
        className={cn(
          tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-warn' : 'text-fg-subtle'
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-[10px] uppercase tracking-wide text-fg-subtle">{label}</span>
        <span className="tnum text-sm font-semibold text-fg">
          {value}
          {unit && <span className="ml-0.5 text-[10px] font-normal text-fg-muted">{unit}</span>}
        </span>
      </div>
    </div>
  )
}

/** Tiny self-contained SVG sparkline (no chart dep). */
function Spark({ values, color }: { values: number[]; color: string }) {
  const path = useMemo(() => {
    if (values.length < 2) return ''
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const w = 100
    const h = 28
    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * w
        const y = h - ((v - min) / range) * h
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }, [values])
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full">
      {/* `style`, not the stroke attribute: SVG presentation attributes cannot resolve `var()`. */}
      <path
        d={path}
        fill="none"
        style={{ stroke: color }}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export function WeatherPanel() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const tempUnit = useSettingsStore((s) => s.units.temperature)
  const windUnit = useSettingsStore((s) => s.units.wind)
  const pressureUnit = useSettingsStore((s) => s.units.pressure)
  const w = snapshot?.weather
  const history = snapshot?.weatherHistory ?? []

  const trackTrend = history.map((h) => h.trackTemp ?? 0).filter((v) => v > 0)
  const airTrend = history.map((h) => h.airTemp ?? 0).filter((v) => v > 0)
  const windTrend = history.map((h) => h.windSpeed ?? 0).filter((v) => v >= 0)

  const airDirection = weatherFieldTrend(history, 'airTemp').direction
  const windDirection = weatherFieldTrend(history, 'windSpeed').direction
  const rain = rainTransition(history)
  const readiness = dryingReadiness(history, w ?? null)

  if (!snapshot || !snapshot.availability.weather || !w) {
    return (
      <WidgetFrame title="Weather" icon={<Sun />}>
        <EmptyState title="No weather data" hint="Weather telemetry will appear here." />
      </WidgetFrame>
    )
  }

  return (
    <WidgetFrame
      title="Weather"
      icon={w.rainfall ? <CloudRain /> : <Sun />}
      actions={w.rainfall ? <Badge tone="accent">RAIN</Badge> : <Badge tone="good">DRY</Badge>}
    >
      <div className="grid grid-cols-2 gap-1.5">
        <Stat
          icon={<Thermometer className="h-4 w-4" />}
          label="Air"
          value={formatTemp(w.airTemp, tempUnit)}
        />
        <Stat
          icon={<Thermometer className="h-4 w-4" />}
          label="Track"
          value={formatTemp(w.trackTemp, tempUnit)}
          tone="warn"
        />
        <Stat
          icon={<Droplets className="h-4 w-4" />}
          label="Humidity"
          value={w.humidity?.toFixed(0) ?? '—'}
          unit="%"
        />
        <Stat
          icon={<Gauge className="h-4 w-4" />}
          label="Pressure"
          value={formatPressureValue(w.pressure, pressureUnit)}
          unit={pressureUnitLabel(pressureUnit)}
        />
        <Stat
          icon={<Wind className="h-4 w-4" />}
          label="Wind"
          value={formatWindValue(w.windSpeed, windUnit)}
          unit={windUnitLabel(windUnit)}
        />
        <Stat
          icon={<Wind className="h-4 w-4" />}
          label="Dir"
          value={w.windDirection?.toFixed(0) ?? '—'}
          unit="°"
        />
      </div>
      {trackTrend.length > 1 && (
        <div className="mt-2 rounded-lg border border-hairline/20 bg-white/[0.02] px-2.5 py-2">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-fg-subtle">
            <span>Track temp trend</span>
            <span className="tnum text-fg-muted">
              {formatTemp(trackTrend[trackTrend.length - 1], tempUnit)}
            </span>
          </div>
          <Spark values={trackTrend} color="rgb(var(--warn))" />
        </div>
      )}
      {airTrend.length > 1 && (
        <div className="mt-1.5 rounded-lg border border-hairline/20 bg-white/[0.02] px-2.5 py-2">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-fg-subtle">
            <span>Air temp trend ({airDirection})</span>
            <span className="tnum text-fg-muted">
              {formatTemp(airTrend[airTrend.length - 1], tempUnit)}
            </span>
          </div>
          <Spark values={airTrend} color="rgb(96 165 250)" />
        </div>
      )}
      {windTrend.length > 1 && (
        <div className="mt-1.5 rounded-lg border border-hairline/20 bg-white/[0.02] px-2.5 py-2">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-fg-subtle">
            <span>Wind trend ({windDirection})</span>
            <span className="tnum text-fg-muted">
              {formatWind(windTrend[windTrend.length - 1], windUnit)}
            </span>
          </div>
          <Spark values={windTrend} color="rgb(148 163 184)" />
        </div>
      )}
      {readiness !== 'unknown' && (
        <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-hairline/20 bg-white/[0.02] px-2.5 py-1.5 text-2xs">
          <span className="text-fg-muted">
            {readiness === 'raining' && rain.kind === 'onset' && rain.elapsedSec != null
              ? `Raining for ${Math.round(rain.elapsedSec / 60)}m`
              : readiness === 'raining'
                ? 'Raining'
                : readiness === 'drying' && rain.elapsedSec != null
                  ? `Rain stopped ${Math.round(rain.elapsedSec / 60)}m ago — drying`
                  : 'Track dry this session'}
          </span>
          <ProvenanceBadge
            provenance="modelled"
            detail="Read from real weather-sample history, not a forecast — no future prediction."
            className="ml-auto"
          />
        </div>
      )}
    </WidgetFrame>
  )
}
