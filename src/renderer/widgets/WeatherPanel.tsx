import { useMemo } from 'react'
import { CloudRain, Wind, Droplets, Thermometer, Gauge, Sun } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Badge } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { cn } from '@renderer/lib/utils'

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
      <span className={cn(tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-warn' : 'text-fg-subtle')}>
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
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function WeatherPanel() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const w = snapshot?.weather
  const history = snapshot?.weatherHistory ?? []

  const trackTrend = history.map((h) => h.trackTemp ?? 0).filter((v) => v > 0)

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
      actions={
        w.rainfall ? <Badge tone="accent">RAIN</Badge> : <Badge tone="good">DRY</Badge>
      }
    >
      <div className="grid grid-cols-2 gap-1.5">
        <Stat icon={<Thermometer className="h-4 w-4" />} label="Air" value={w.airTemp?.toFixed(1) ?? '—'} unit="°C" />
        <Stat
          icon={<Thermometer className="h-4 w-4" />}
          label="Track"
          value={w.trackTemp?.toFixed(1) ?? '—'}
          unit="°C"
          tone="warn"
        />
        <Stat icon={<Droplets className="h-4 w-4" />} label="Humidity" value={w.humidity?.toFixed(0) ?? '—'} unit="%" />
        <Stat icon={<Gauge className="h-4 w-4" />} label="Pressure" value={w.pressure?.toFixed(0) ?? '—'} unit="mb" />
        <Stat
          icon={<Wind className="h-4 w-4" />}
          label="Wind"
          value={w.windSpeed?.toFixed(1) ?? '—'}
          unit="m/s"
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
            <span className="tnum text-fg-muted">{trackTrend[trackTrend.length - 1].toFixed(1)}°C</span>
          </div>
          <Spark values={trackTrend} color="rgb(245 158 11)" />
        </div>
      )}
    </WidgetFrame>
  )
}
