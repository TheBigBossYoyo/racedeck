import {
  ScrollText,
  Repeat,
  CircleDot,
  Timer,
  Flag,
  Crown,
  OctagonX,
  Trash2
} from 'lucide-react'
import type { ReactNode } from 'react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Badge, EmptyState } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useRaceStoryStore } from '@renderer/store/raceStoryStore'
import type { StoryEvent, StoryKind, StorySeverity } from '@renderer/core/engines/RaceStoryEngine'
import { pickDriver } from '@renderer/lib/useFocusDriver'
import { formatDuration, cn } from '@renderer/lib/utils'

const KIND_ICON: Record<StoryKind, ReactNode> = {
  overtake: <Repeat className="h-3.5 w-3.5" />,
  pit: <CircleDot className="h-3.5 w-3.5" />,
  tyres: <CircleDot className="h-3.5 w-3.5" />,
  'fastest-lap': <Timer className="h-3.5 w-3.5" />,
  'lead-change': <Crown className="h-3.5 w-3.5" />,
  retirement: <OctagonX className="h-3.5 w-3.5" />,
  flag: <Flag className="h-3.5 w-3.5" />
}

const SEV_COLOR: Record<StorySeverity, string> = {
  good: 'text-good',
  warn: 'text-warn',
  notice: 'text-accent',
  info: 'text-fg-muted'
}

export function RaceStoryPanel() {
  const events = useRaceStoryStore((s) => s.events)
  const reset = useRaceStoryStore((s) => s.reset)
  const hasSession = useSessionStore((s) => !!s.currentSession)

  return (
    <WidgetFrame
      title="Race Story"
      icon={<ScrollText />}
      actions={
        <div className="flex items-center gap-1.5">
          {events.length > 0 && <Badge tone="neutral">{events.length}</Badge>}
          <button
            onClick={reset}
            title="Clear the story"
            className="no-drag text-fg-subtle hover:text-fg"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      }
    >
      {events.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title={hasSession ? 'The story builds as you watch' : 'No session loaded'}
          hint={hasSession ? 'Play or scrub the race and key moments appear here.' : undefined}
        />
      ) : (
        <ol className="space-y-1">
          {events.map((e) => (
            <StoryRow key={e.id} e={e} />
          ))}
        </ol>
      )}
    </WidgetFrame>
  )
}

function StoryRow({ e }: { e: StoryEvent }) {
  const clickable = e.drivers.length > 0
  return (
    <li>
      <button
        onClick={() => clickable && pickDriver(e.drivers[0])}
        disabled={!clickable}
        className={cn(
          'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
          clickable ? 'hover:bg-white/[0.03]' : 'cursor-default'
        )}
      >
        <span className={cn('mt-0.5 shrink-0', SEV_COLOR[e.severity])}>{KIND_ICON[e.kind]}</span>
        <span className="min-w-0 flex-1 text-xs leading-snug text-fg">{e.text}</span>
        <span className="tnum mt-0.5 shrink-0 text-2xs text-fg-subtle">
          {e.lap != null ? `L${e.lap}` : formatDuration(e.at)}
        </span>
      </button>
    </li>
  )
}
