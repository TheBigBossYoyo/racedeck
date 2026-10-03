import { Trash2, UserCog } from 'lucide-react'
import { Button, Badge } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useProfileStore } from '@renderer/store/profileStore'
import type { SessionType } from '@shared/models'
import { Section } from './Section'
import { Toggle } from './Toggle'

const SESSION_TYPE_LABEL: Record<SessionType, string> = {
  practice: 'Practice',
  qualifying: 'Qualifying',
  'sprint-qualifying': 'Sprint Qualifying',
  sprint: 'Sprint',
  race: 'Race',
  testing: 'Testing',
  unknown: 'Unknown'
}

export function ProfilesSection() {
  const currentSession = useSessionStore((s) => s.currentSession)
  const { profiles, autoApply, saveCurrentAsProfile, applyProfile, removeProfile, setAutoApply } =
    useProfileStore()

  const currentType = currentSession?.type ?? null
  const savedTypes = (Object.keys(profiles) as SessionType[]).filter((t) => profiles[t])

  return (
    <Section
      icon={<UserCog className="h-4 w-4" />}
      title="Race-watch profiles"
      desc="Favourites, layout and alert tweaks saved per session type, applied automatically when that type loads. Critical alerts (red flag, safety car, penalties, qualifying elimination) are never affected."
    >
      <Toggle label="Auto-apply on session load" checked={autoApply} onChange={setAutoApply} />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-fg-muted">
          {currentSession
            ? `Current session: ${SESSION_TYPE_LABEL[currentSession.type]}`
            : 'Load a session to save a profile for its type.'}
        </span>
        {currentType && (
          <Button
            size="xs"
            variant="outline"
            className="ml-auto"
            onClick={() => saveCurrentAsProfile(currentType)}
          >
            Save current setup
          </Button>
        )}
      </div>
      {savedTypes.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {savedTypes.map((t) => (
            <div
              key={t}
              className="flex items-center gap-2 rounded-lg border border-hairline/25 px-3 py-2"
            >
              <span className="text-xs font-medium text-fg">{SESSION_TYPE_LABEL[t]}</span>
              <Badge tone="neutral">{profiles[t]?.favoriteDrivers.length ?? 0} favourites</Badge>
              <div className="ml-auto flex gap-1">
                <Button size="xs" variant="outline" onClick={() => applyProfile(t)}>
                  Apply now
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => removeProfile(t)}>
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
