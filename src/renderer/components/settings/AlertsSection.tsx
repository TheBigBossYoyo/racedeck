import { Bell } from 'lucide-react'
import { Slider } from '@renderer/components/ui/controls'
import { useSettingsStore } from '@renderer/store/settingsStore'
import type { AlertConfig } from '@renderer/core/engines/AlertEngine'
import { Section } from './Section'
import { Toggle } from './Toggle'

const ALERT_RULES: { key: keyof AlertConfig; label: string }[] = [
  { key: 'yellowFlag', label: 'Yellow flags' },
  { key: 'safetyCar', label: 'Safety Car / VSC' },
  { key: 'redFlag', label: 'Red flags' },
  { key: 'pitStop', label: 'Pit stops (favourites)' },
  { key: 'fastestLap', label: 'Fastest lap' },
  { key: 'weather', label: 'Weather / rain' },
  { key: 'intervalChange', label: 'Major interval change' },
  { key: 'penalty', label: 'Penalties / investigations' },
  { key: 'qualiElimination', label: 'Qualifying elimination risk' },
  { key: 'favoriteEvent', label: 'Any favourite-driver event' }
]

export function AlertsSection() {
  const { alerts, setAlerts } = useSettingsStore()

  return (
    <Section
      icon={<Bell className="h-4 w-4" />}
      title="Alerts"
      desc="Choose which events trigger alerts."
    >
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {ALERT_RULES.map((r) => (
          <Toggle
            key={r.key}
            label={r.label}
            checked={Boolean(alerts[r.key])}
            onChange={(v) => setAlerts({ [r.key]: v } as Partial<AlertConfig>)}
          />
        ))}
      </div>
      <div className="mt-2 py-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-fg">Interval change threshold</span>
          <span className="tnum text-2xs text-fg-muted">
            {alerts.intervalThresholdSec.toFixed(1)}s
          </span>
        </div>
        <Slider
          min={0.5}
          max={10}
          step={0.5}
          value={[alerts.intervalThresholdSec]}
          onValueChange={([v]) => setAlerts({ intervalThresholdSec: v })}
        />
      </div>
    </Section>
  )
}
