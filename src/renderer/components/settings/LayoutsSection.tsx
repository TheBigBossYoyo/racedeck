import { LayoutGrid, Trash2 } from 'lucide-react'
import { Button, Badge } from '@renderer/components/ui/primitives'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { LAYOUT_PRESETS } from '@renderer/core/engines/LayoutManager'
import { Section } from './Section'

export function LayoutsSection() {
  const { savedLayouts, deleteSaved, loadSaved } = useLayoutStore()

  return (
    <Section
      icon={<LayoutGrid className="h-4 w-4" />}
      title="Saved layouts"
      desc="Your custom panel arrangements."
    >
      {savedLayouts.length === 0 ? (
        <p className="text-xs text-fg-subtle">
          No saved layouts. Save one from the dashboard command bar.
        </p>
      ) : (
        <div className="space-y-1.5">
          {savedLayouts.map((l) => (
            <div
              key={l.id}
              className="flex items-center gap-2 rounded-lg border border-hairline/25 px-3 py-2"
            >
              <span className="text-xs font-medium text-fg">{l.name}</span>
              <Badge tone="neutral">{LAYOUT_PRESETS[l.base].name}</Badge>
              <div className="ml-auto flex gap-1">
                <Button size="xs" variant="outline" onClick={() => loadSaved(l.id)}>
                  Load
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => void deleteSaved(l.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}
