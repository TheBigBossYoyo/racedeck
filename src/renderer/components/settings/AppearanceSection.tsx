import { Palette } from 'lucide-react'
import { Segmented } from '@renderer/components/ui/primitives'
import { Slider } from '@renderer/components/ui/controls'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { ACCENT_PRESETS } from '@shared/constants'
import { cn } from '@renderer/lib/utils'
import { Section } from './Section'
import { Toggle } from './Toggle'

export function AppearanceSection() {
  const { theme, setTheme, voice, setVoice } = useSettingsStore()

  return (
    <Section
      icon={<Palette className="h-4 w-4" />}
      title="Appearance"
      desc="Theme, density and motion."
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-fg">Color scheme</span>
        <Segmented
          value={theme.mode}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' }
          ]}
          onChange={(v) => setTheme({ mode: v })}
        />
      </div>
      <div className="mb-3">
        <label className="text-2xs uppercase tracking-wide text-fg-subtle">Accent color</label>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {Object.entries(ACCENT_PRESETS).map(([key, rgb]) => (
            <button
              key={key}
              onClick={() => setTheme({ accent: key as keyof typeof ACCENT_PRESETS })}
              className={cn(
                'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
                theme.accent === key ? 'border-white' : 'border-transparent'
              )}
              style={{ backgroundColor: `rgb(${rgb})` }}
              title={key}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between py-1.5">
        <span className="text-xs font-medium text-fg">Density</span>
        <Segmented
          value={theme.density}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' }
          ]}
          onChange={(v) => setTheme({ density: v })}
        />
      </div>
      <Toggle
        label="Team-color highlights"
        checked={theme.teamColorMode}
        onChange={(v) => setTheme({ teamColorMode: v })}
      />
      <Toggle
        label="Reduce motion"
        hint="Disable heavy animations."
        checked={theme.reducedMotion}
        onChange={(v) => setTheme({ reducedMotion: v })}
      />
      <div className="flex items-center justify-between py-1.5">
        <div className="min-w-0 pr-2">
          <span className="text-xs font-medium text-fg">Colour vision</span>
          <p className="text-2xs text-fg-subtle">
            Colour-blind-safe tyre palettes. Compound letters always shown.
          </p>
        </div>
        <Segmented
          value={theme.colorVision}
          options={[
            { value: 'default', label: 'Default' },
            { value: 'deuteranopia', label: 'Deuter', title: 'Deuteranopia (red-green)' },
            { value: 'protanopia', label: 'Protan', title: 'Protanopia (red-green)' },
            { value: 'tritanopia', label: 'Tritan', title: 'Tritanopia (blue-yellow)' }
          ]}
          onChange={(v) => setTheme({ colorVision: v })}
        />
      </div>
      <Toggle
        label="Voice read-out"
        hint="Speak high-priority Engineer's Notes (safety car, rain) aloud while playing. Local only."
        checked={voice.enabled}
        onChange={(v) => setVoice({ enabled: v })}
      />
      <div className="py-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-fg">Font scale</span>
          <span className="tnum text-2xs text-fg-muted">{Math.round(theme.fontScale * 100)}%</span>
        </div>
        <Slider
          min={0.85}
          max={1.3}
          step={0.05}
          value={[theme.fontScale]}
          onValueChange={([v]) => setTheme({ fontScale: v })}
        />
      </div>
    </Section>
  )
}
