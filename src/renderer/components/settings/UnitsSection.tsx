import { Ruler } from 'lucide-react'
import { Segmented } from '@renderer/components/ui/primitives'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { Section } from './Section'

export function UnitsSection() {
  const { units, setUnits } = useSettingsStore()

  return (
    <Section
      icon={<Ruler className="h-4 w-4" />}
      title="Units"
      desc="Temperature, speed, wind, pressure, and clock display preferences."
    >
      <div className="flex items-center justify-between py-1.5">
        <span className="text-xs font-medium text-fg">Temperature</span>
        <Segmented
          value={units.temperature}
          options={[
            { value: 'c', label: '°C' },
            { value: 'f', label: '°F' }
          ]}
          onChange={(v) => setUnits({ temperature: v })}
        />
      </div>
      <div className="flex items-center justify-between py-1.5">
        <span className="text-xs font-medium text-fg">Speed</span>
        <Segmented
          value={units.speed}
          options={[
            { value: 'kmh', label: 'km/h' },
            { value: 'mph', label: 'mph' }
          ]}
          onChange={(v) => setUnits({ speed: v })}
        />
      </div>
      <div className="flex items-center justify-between py-1.5">
        <span className="text-xs font-medium text-fg">Wind speed</span>
        <Segmented
          value={units.wind}
          options={[
            { value: 'ms', label: 'm/s' },
            { value: 'kmh', label: 'km/h' },
            { value: 'mph', label: 'mph' },
            { value: 'kn', label: 'kn' }
          ]}
          onChange={(v) => setUnits({ wind: v })}
        />
      </div>
      <div className="flex items-center justify-between py-1.5">
        <span className="text-xs font-medium text-fg">Pressure</span>
        <Segmented
          value={units.pressure}
          options={[
            { value: 'mbar', label: 'mbar' },
            { value: 'inHg', label: 'inHg' },
            { value: 'kPa', label: 'kPa' }
          ]}
          onChange={(v) => setUnits({ pressure: v })}
        />
      </div>
      <div className="flex items-center justify-between py-1.5">
        <div className="min-w-0 pr-2">
          <span className="text-xs font-medium text-fg">Clock</span>
          <p className="text-2xs text-fg-subtle">
            Race-control timestamps. No per-circuit timezone data — UTC is the feed's native time.
          </p>
        </div>
        <Segmented
          value={units.clock}
          options={[
            { value: 'local', label: 'Local' },
            { value: 'utc', label: 'UTC' }
          ]}
          onChange={(v) => setUnits({ clock: v })}
        />
      </div>
    </Section>
  )
}
