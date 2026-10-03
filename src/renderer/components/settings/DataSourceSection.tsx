import { Database } from 'lucide-react'
import { Segmented, Badge } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { Section } from './Section'

export function DataSourceSection() {
  const catalog = useSessionStore((s) => s.catalog)
  const providerId = useSessionStore((s) => s.providerId)
  const setProvider = useSessionStore((s) => s.setProvider)

  return (
    <Section
      icon={<Database className="h-4 w-4" />}
      title="Data source"
      desc="Where live/replay timing comes from."
    >
      <Segmented
        size="md"
        value={providerId}
        options={catalog.map((c) => ({ value: c.id, label: c.label.split(' ')[0] }))}
        onChange={(id) => void setProvider(id)}
      />
      {catalog
        .filter((c) => c.id === providerId)
        .map((c) => (
          <p key={c.id} className="mt-2 text-xs text-fg-muted">
            {c.description}
            {c.riskLevel !== 'none' && (
              <Badge tone="warn" className="ml-2">
                {c.riskLevel} risk
              </Badge>
            )}
          </p>
        ))}
    </Section>
  )
}
