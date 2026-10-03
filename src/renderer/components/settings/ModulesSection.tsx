import { SlidersHorizontal } from 'lucide-react'
import { Button, Badge } from '@renderer/components/ui/primitives'
import { useSettingsStore, isModuleEnabled } from '@renderer/store/settingsStore'
import { WIDGET_CATALOG, type WidgetMeta } from '@renderer/core/engines/LayoutManager'
import { Section } from './Section'
import { Toggle } from './Toggle'
import { MODULE_GROUPS, MODULE_DESC } from './moduleMeta'

export function ModulesSection() {
  const modules = useSettingsStore((s) => s.modules)
  const setModule = useSettingsStore((s) => s.setModule)
  const setAllModules = useSettingsStore((s) => s.setAllModules)

  const enabledCount = (Object.values(WIDGET_CATALOG) as WidgetMeta[]).filter(
    (w) => w.key !== 'tod-video' && isModuleEnabled(modules, w.key)
  ).length
  const total = (Object.values(WIDGET_CATALOG) as WidgetMeta[]).filter(
    (w) => w.key !== 'tod-video'
  ).length

  return (
    <Section
      icon={<SlidersHorizontal className="h-4 w-4" />}
      title="Modules"
      desc="Enable or disable any panel. Disabled panels are hidden everywhere and removed from the Widgets menu."
    >
      <div className="mb-2 flex items-center gap-1.5">
        <Badge tone="accent">
          {enabledCount}/{total} on
        </Badge>
        <div className="ml-auto flex gap-1.5">
          <Button size="xs" variant="subtle" onClick={() => setAllModules(true)}>
            Enable all
          </Button>
          <Button size="xs" variant="subtle" onClick={() => setAllModules(false)}>
            Disable all
          </Button>
        </div>
      </div>
      {MODULE_GROUPS.map(({ group, label }) => {
        const items = (Object.values(WIDGET_CATALOG) as WidgetMeta[]).filter(
          (w) => w.group === group && w.key !== 'tod-video'
        )
        if (items.length === 0) return null
        return (
          <div key={group} className="mb-2.5">
            <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
              {label}
            </div>
            <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
              {items.map((w) => (
                <Toggle
                  key={w.key}
                  label={w.title}
                  hint={MODULE_DESC[w.key]}
                  checked={isModuleEnabled(modules, w.key)}
                  onChange={(v) => setModule(w.key, v)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </Section>
  )
}
